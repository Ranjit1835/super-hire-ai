// ATS-friendly resume PDFs: one column, standard fonts, standard section headings, real text
// (selectable, extracts top-to-bottom in reading order), automatic page breaks, and no tables,
// text boxes, images or icons. Every template in ATS_STYLES is rendered by this one engine, and
// the builder preview (AtsTemplatePreview) reads the same style so it matches the PDF.
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import type { ResumeContent } from "./resume-builder-types";
import { safe, toBullets } from "./pdf-text";

export type AtsSection = "summary" | "experience" | "projects" | "skills" | "education" | "certifications";

export const SECTION_TITLES: Record<AtsSection, string> = {
  summary: "Summary",
  experience: "Experience",
  projects: "Projects",
  skills: "Skills",
  education: "Education",
  certifications: "Certifications",
};

export interface AtsStyle {
  font: "helvetica" | "times";
  nameAlign: "left" | "center";
  /** Heading colour as RGB 0–1, or null for black. */
  accent: [number, number, number] | null;
  headingRule: boolean;
  order: AtsSection[];
  /** Body font size in points. */
  size: number;
  /** Line height as a multiple of the font size. */
  spacing: number;
  margin: number;
}

export const ATS_TEMPLATE_IDS = ["ats-classic", "ats-modern", "ats-fresher", "ats-technical", "ats-compact"] as const;
export type AtsTemplateId = typeof ATS_TEMPLATE_IDS[number];

export const ATS_STYLES: Record<AtsTemplateId, AtsStyle> = {
  "ats-classic": { font: "times", nameAlign: "center", accent: null, headingRule: true, size: 10.5, spacing: 1.3, margin: 50,
    order: ["summary", "experience", "projects", "skills", "education", "certifications"] },
  "ats-modern": { font: "helvetica", nameAlign: "left", accent: [0.1, 0.25, 0.5], headingRule: true, size: 10, spacing: 1.35, margin: 48,
    order: ["summary", "skills", "experience", "projects", "education", "certifications"] },
  "ats-fresher": { font: "helvetica", nameAlign: "center", accent: [0.05, 0.35, 0.35], headingRule: true, size: 10, spacing: 1.35, margin: 48,
    order: ["summary", "education", "skills", "projects", "experience", "certifications"] },
  "ats-technical": { font: "helvetica", nameAlign: "left", accent: [0.2, 0.2, 0.25], headingRule: true, size: 10, spacing: 1.33, margin: 48,
    order: ["summary", "skills", "projects", "experience", "education", "certifications"] },
  "ats-compact": { font: "helvetica", nameAlign: "left", accent: null, headingRule: false, size: 9, spacing: 1.22, margin: 36,
    order: ["summary", "experience", "skills", "projects", "education", "certifications"] },
};

export const isAtsTemplate = (id: string): id is AtsTemplateId => (ATS_TEMPLATE_IDS as readonly string[]).includes(id);

const A4: [number, number] = [595.28, 841.89];

export async function renderAtsPdf(content: ResumeContent, style: AtsStyle): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(safe(content.basicInfo.fullName) ? `${safe(content.basicInfo.fullName)} - Resume` : "Resume");
  doc.setProducer("HiResume");
  const regular = await doc.embedFont(style.font === "times" ? StandardFonts.TimesRoman : StandardFonts.Helvetica);
  const bold = await doc.embedFont(style.font === "times" ? StandardFonts.TimesRomanBold : StandardFonts.HelveticaBold);
  const black = rgb(0, 0, 0);
  const muted = rgb(0.3, 0.3, 0.3);
  const accent = style.accent ? rgb(...style.accent) : black;
  const [W, H] = A4;
  const left = style.margin;
  const right = W - style.margin;
  const width = right - left;
  const lh = style.size * style.spacing;

  let page: PDFPage = doc.addPage(A4);
  let y = H - style.margin;

  const ensure = (needed: number) => {
    if (y - needed < style.margin) {
      page = doc.addPage(A4);
      y = H - style.margin;
    }
  };

  const wrap = (text: string, font: PDFFont, size: number, maxW: number): string[] => {
    const words = text.split(" ").filter(Boolean);
    const lines: string[] = [];
    let cur = "";
    for (const w of words) {
      const test = cur ? `${cur} ${w}` : w;
      if (cur && font.widthOfTextAtSize(test, size) > maxW) { lines.push(cur); cur = w; }
      else cur = test;
    }
    if (cur) lines.push(cur);
    return lines;
  };

  /** Wrapped paragraph at x, continuing on new pages as needed. */
  const paragraph = (text: string, opts: { x?: number; font?: PDFFont; size?: number; color?: ReturnType<typeof rgb> } = {}) => {
    const x = opts.x ?? left;
    const font = opts.font ?? regular;
    const size = opts.size ?? style.size;
    for (const line of wrap(safe(text), font, size, right - x)) {
      ensure(lh);
      y -= lh;
      page.drawText(line, { x, y, size, font, color: opts.color ?? black });
    }
  };

  /** "Title" on the left and a date on the right of the same line (right text optional). */
  const titleLine = (title: string, rightText?: string) => {
    const t = safe(title);
    const r = safe(rightText);
    const rw = r ? regular.widthOfTextAtSize(r, style.size) : 0;
    const lines = wrap(t, bold, style.size, width - (rw ? rw + 12 : 0));
    lines.forEach((line, i) => {
      ensure(lh);
      y -= lh;
      page.drawText(line, { x: left, y, size: style.size, font: bold, color: black });
      if (i === 0 && r) page.drawText(r, { x: right - rw, y, size: style.size, font: regular, color: muted });
    });
  };

  const bullets = (items: string[]) => {
    const dot = String.fromCodePoint(0x2022);
    const indent = style.size * 1.1;
    for (const item of items) {
      const lines = wrap(safe(item), regular, style.size, width - indent);
      lines.forEach((line, i) => {
        ensure(lh);
        y -= lh;
        if (i === 0) page.drawText(dot, { x: left + 2, y, size: style.size, font: regular, color: black });
        page.drawText(line, { x: left + indent, y, size: style.size, font: regular, color: black });
      });
    }
  };

  /** One item's details: a bullet list when there are several lines, else a paragraph. */
  const details = (text: string) => {
    const items = toBullets(text);
    if (items.length > 1) bullets(items);
    else if (items.length === 1) paragraph(items[0]);
  };

  const heading = (title: string) => {
    const size = style.size * 1.15;
    ensure(lh * 3); // keep a heading with at least a couple of lines of its section
    y -= style.size * 0.9;
    y -= size * 1.2;
    page.drawText(title.toUpperCase(), { x: left, y, size, font: bold, color: accent });
    if (style.headingRule) {
      page.drawLine({ start: { x: left, y: y - 3 }, end: { x: right, y: y - 3 }, thickness: 0.6, color: accent });
      y -= 3;
    }
    y -= style.size * 0.2;
  };

  // ── Header ──
  const { basicInfo } = content;
  const name = safe(basicInfo.fullName) || "Your Name";
  const nameSize = style.size * 2.1;
  const nameW = bold.widthOfTextAtSize(name, nameSize);
  y -= nameSize;
  page.drawText(name, { x: style.nameAlign === "center" ? (W - nameW) / 2 : left, y, size: nameSize, font: bold, color: black });
  const contact = [basicInfo.email, basicInfo.phone, basicInfo.linkedin, basicInfo.github].map(safe).filter(Boolean).join("  |  ");
  if (contact) {
    const size = style.size * 0.95;
    for (const line of wrap(contact, regular, size, width)) {
      const lw = regular.widthOfTextAtSize(line, size);
      y -= size * 1.5;
      page.drawText(line, { x: style.nameAlign === "center" ? (W - lw) / 2 : left, y, size, font: regular, color: muted });
    }
  }

  // ── Sections, in the template's order ──
  const sections: Record<AtsSection, () => void> = {
    summary: () => {
      if (!safe(content.summary)) return;
      heading(SECTION_TITLES.summary);
      paragraph(content.summary);
    },
    skills: () => {
      const skills = content.skills.map(safe).filter(Boolean);
      if (!skills.length) return;
      heading(SECTION_TITLES.skills);
      paragraph(skills.join(", "));
    },
    experience: () => {
      const items = content.experience.filter((e) => safe(e.company) || safe(e.role));
      if (!items.length) return;
      heading(SECTION_TITLES.experience);
      for (const e of items) {
        y -= style.size * 0.3;
        titleLine([safe(e.role), safe(e.company)].filter(Boolean).join(", "), e.duration);
        details(e.responsibilities);
      }
    },
    projects: () => {
      const items = content.projects.filter((p) => safe(p.name));
      if (!items.length) return;
      heading(SECTION_TITLES.projects);
      for (const p of items) {
        y -= style.size * 0.3;
        titleLine(p.name);
        if (safe(p.techStack)) paragraph(`Technologies: ${p.techStack}`, { color: muted });
        details(p.description);
      }
    },
    education: () => {
      const items = content.education.filter((e) => safe(e.degree) || safe(e.college));
      if (!items.length) return;
      heading(SECTION_TITLES.education);
      for (const e of items) {
        y -= style.size * 0.3;
        titleLine(safe(e.degree) || safe(e.college), e.year);
        if (safe(e.degree) && safe(e.college)) paragraph(e.college);
      }
    },
    certifications: () => {
      const items = content.certifications.filter((c) => safe(c.name));
      if (!items.length) return;
      heading(SECTION_TITLES.certifications);
      bullets(items.map((c) => [safe(c.name), safe(c.issuer), safe(c.year)].filter(Boolean).join(", ")));
    },
  };
  for (const s of style.order) sections[s]();

  return doc.save();
}
