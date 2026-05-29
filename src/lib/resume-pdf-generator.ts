import { PDFDocument, rgb, StandardFonts, type RGB } from "pdf-lib";
import { ResumeContent, TemplateId, TEMPLATE_IDS } from "./resume-builder-types";

interface RenderConfig {
  accentColor: RGB;
  headerBg: RGB | null; // null = no colored header, just text
  twoColumn: boolean;
  sidebarWidth: number; // fraction of width (0 = no sidebar)
  fontScale: number; // multiplier on base sizes
  sectionStyle: "line" | "box" | "plain";
}

const orange = rgb(0.91, 0.35, 0.05);
const purple = rgb(0.4, 0.2, 0.8);
const blue = rgb(0.18, 0.45, 0.9);
const teal = rgb(0.1, 0.6, 0.55);
const green = rgb(0.13, 0.65, 0.4);
const charcoal = rgb(0.18, 0.18, 0.2);
const darkPurple = rgb(0.22, 0.1, 0.42);
const darkBlue = rgb(0.08, 0.2, 0.45);
const darkGreen = rgb(0.06, 0.35, 0.25);
const rose = rgb(0.78, 0.2, 0.4);
const amber = rgb(0.85, 0.6, 0.1);
const slate = rgb(0.35, 0.42, 0.5);

const BASE: RenderConfig = {
  accentColor: orange,
  headerBg: null,
  twoColumn: false,
  sidebarWidth: 0,
  fontScale: 1,
  sectionStyle: "line",
};

const CONFIGS: Record<TemplateId, RenderConfig> = {
  "minimal-ats":         { ...BASE, accentColor: charcoal, sectionStyle: "line" },
  "modern-professional": { ...BASE, accentColor: blue },
  "clean-fresher":       { ...BASE, accentColor: teal, fontScale: 0.95 },
  "tech-bold":           { ...BASE, accentColor: purple, sectionStyle: "box" },
  "compact-onepage":     { ...BASE, accentColor: slate, fontScale: 0.88 },
  "executive-clean":     { ...BASE, accentColor: charcoal, fontScale: 1.02, sectionStyle: "line" },
  "creative-minimal":    { ...BASE, accentColor: rose, sectionStyle: "plain" },
  "two-column-pro":      { ...BASE, accentColor: blue, twoColumn: true, sidebarWidth: 0.28 },
  "data-tech-focused":   { ...BASE, accentColor: darkBlue, sectionStyle: "box" },
  "ultra-compact":       { ...BASE, accentColor: slate, fontScale: 0.82 },
};

export async function generateResumePdf(content: ResumeContent, templateId: TemplateId): Promise<Uint8Array> {
  const cfg = CONFIGS[templateId] ?? CONFIGS["minimal-ats"];
  return cfg.twoColumn
    ? renderTwoColumn(content, cfg)
    : renderSingleColumn(content, cfg);
}

async function renderSingleColumn(content: ResumeContent, cfg: RenderConfig): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const { width, height } = page.getSize();

  const margin = 50;
  const maxW = width - margin * 2;
  const fs = cfg.fontScale;
  const lh = 14 * fs;
  const black = rgb(0, 0, 0);
  const gray = rgb(0.4, 0.4, 0.4);
  const accent = cfg.accentColor;
  let y = height - 50;

  const drawText = (text: string, x: number, yPos: number, size: number, f = font, color = black) => {
    page.drawText(text, { x, y: yPos, size, font: f, color, maxWidth: maxW });
  };

  const drawSection = (title: string) => {
    y -= 8;
    if (cfg.sectionStyle === "box") {
      page.drawRectangle({ x: margin - 4, y: y - 2, width: maxW + 8, height: 14 * fs + 4, color: rgb(0.95, 0.95, 0.95) });
    } else if (cfg.sectionStyle === "line") {
      page.drawRectangle({ x: margin, y: y - 1, width: maxW, height: 1, color: accent });
    }
    y -= 14 * fs;
    drawText(title.toUpperCase(), margin, y, 9 * fs, fontBold, accent);
    y -= lh;
  };

  const wrapText = (text: string, size: number, f = font) => {
    const words = text.split(" ");
    const lines: string[] = [];
    let current = "";
    for (const word of words) {
      const test = current ? `${current} ${word}` : word;
      if (f.widthOfTextAtSize(test, size) > maxW && current) {
        lines.push(current);
        current = word;
      } else {
        current = test;
      }
    }
    if (current) lines.push(current);
    return lines;
  };

  const drawWrapped = (text: string, size: number, f = font, color = black) => {
    const lines = wrapText(text, size, f);
    for (const line of lines) {
      if (y < 50) return;
      drawText(line, margin, y, size, f, color);
      y -= lh;
    }
  };

  // Colored header background
  if (cfg.headerBg) {
    page.drawRectangle({ x: 0, y: height - 90, width, height: 90, color: cfg.headerBg });
  }
  const headerColor = cfg.headerBg ? rgb(1, 1, 1) : black;
  const subColor = cfg.headerBg ? rgb(0.85, 0.85, 0.85) : gray;

  const { basicInfo } = content;
  const nameW = fontBold.widthOfTextAtSize(basicInfo.fullName || "Your Name", 18 * fs);
  drawText(basicInfo.fullName || "Your Name", (width - nameW) / 2, y, 18 * fs, fontBold, headerColor);
  y -= 20 * fs;

  const contact = [basicInfo.email, basicInfo.phone, basicInfo.linkedin, basicInfo.github].filter(Boolean).join("  •  ");
  if (contact) {
    const cw = font.widthOfTextAtSize(contact, 8 * fs);
    drawText(contact, (width - cw) / 2, y, 8 * fs, font, subColor);
    y -= 18 * fs;
  }

  if (cfg.headerBg) y -= 4;

  if (content.summary) { drawSection("Summary"); drawWrapped(content.summary, 9 * fs); }

  if (content.skills.length > 0) { drawSection("Skills"); drawWrapped(content.skills.join("  •  "), 9 * fs); }

  const edu = content.education.filter((e) => e.degree);
  if (edu.length > 0) {
    drawSection("Education");
    for (const e of edu) drawWrapped(`${e.degree} — ${e.college}${e.year ? ` (${e.year})` : ""}`, 9 * fs, fontBold);
  }

  const exp = content.experience.filter((e) => e.company);
  if (exp.length > 0) {
    drawSection("Experience");
    for (const e of exp) {
      drawWrapped(`${e.role} at ${e.company}${e.duration ? ` | ${e.duration}` : ""}`, 9 * fs, fontBold);
      if (e.responsibilities) drawWrapped(e.responsibilities, 9 * fs);
      y -= 4;
    }
  }

  const proj = content.projects.filter((p) => p.name);
  if (proj.length > 0) {
    drawSection("Projects");
    for (const p of proj) {
      drawWrapped(`${p.name}${p.techStack ? ` (${p.techStack})` : ""}`, 9 * fs, fontBold);
      if (p.description) drawWrapped(p.description, 9 * fs);
      y -= 4;
    }
  }

  const certs = content.certifications.filter((c) => c.name);
  if (certs.length > 0) {
    drawSection("Certifications");
    for (const c of certs) drawWrapped(`${c.name} — ${c.issuer}${c.year ? ` (${c.year})` : ""}`, 9 * fs);
  }

  return doc.save();
}

async function renderTwoColumn(content: ResumeContent, cfg: RenderConfig): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const { width, height } = page.getSize();

  const marginX = 40;
  const marginTop = 50;
  const fs = cfg.fontScale;
  const lh = 13 * fs;
  const sideW = Math.floor((width - marginX * 2) * cfg.sidebarWidth);
  const mainX = marginX + sideW + 16;
  const mainW = width - mainX - marginX;
  const sideMaxW = sideW - 8;
  const black = rgb(0, 0, 0);
  const white = rgb(1, 1, 1);
  const gray = rgb(0.45, 0.45, 0.45);
  const accent = cfg.accentColor;

  // Sidebar background
  page.drawRectangle({ x: marginX - 8, y: 0, width: sideW + 16, height, color: rgb(0.95, 0.95, 0.97) });

  let yMain = height - marginTop;
  let ySide = height - marginTop;

  const drawMain = (text: string, x: number, yPos: number, size: number, f = font, color = black) => {
    page.drawText(text, { x, y: yPos, size, font: f, color, maxWidth: mainW });
  };
  const drawSide = (text: string, yPos: number, size: number, f = font, color = black) => {
    page.drawText(text, { x: marginX, y: yPos, size, font: f, color, maxWidth: sideMaxW });
  };

  const wrapSide = (text: string, size: number, f = font) => {
    const words = text.split(" ");
    const lines: string[] = [];
    let cur = "";
    for (const w of words) {
      const test = cur ? `${cur} ${w}` : w;
      if (f.widthOfTextAtSize(test, size) > sideMaxW && cur) { lines.push(cur); cur = w; }
      else cur = test;
    }
    if (cur) lines.push(cur);
    return lines;
  };
  const drawSideWrapped = (text: string, size: number, f = font, color = black) => {
    for (const line of wrapSide(text, size, f)) {
      if (ySide < 50) return;
      drawSide(line, ySide, size, f, color);
      ySide -= lh;
    }
  };

  const wrapMain = (text: string, size: number, f = font) => {
    const words = text.split(" ");
    const lines: string[] = [];
    let cur = "";
    for (const w of words) {
      const test = cur ? `${cur} ${w}` : w;
      if (f.widthOfTextAtSize(test, size) > mainW && cur) { lines.push(cur); cur = w; }
      else cur = test;
    }
    if (cur) lines.push(cur);
    return lines;
  };
  const drawMainWrapped = (text: string, size: number, f = font, color = black) => {
    for (const line of wrapMain(text, size, f)) {
      if (yMain < 50) return;
      drawMain(line, mainX, yMain, size, f, color);
      yMain -= lh;
    }
  };

  // Full-width name header
  if (cfg.headerBg) {
    page.drawRectangle({ x: 0, y: height - 80, width, height: 80, color: cfg.headerBg });
  }
  const { basicInfo } = content;
  const headerColor = cfg.headerBg ? white : black;
  const nameW = fontBold.widthOfTextAtSize(basicInfo.fullName || "Your Name", 16 * fs);
  page.drawText(basicInfo.fullName || "Your Name", { x: (width - nameW) / 2, y: yMain, size: 16 * fs, font: fontBold, color: headerColor });
  yMain -= 18 * fs;
  ySide = yMain;

  const contact = [basicInfo.email, basicInfo.phone].filter(Boolean);
  const social = [basicInfo.linkedin, basicInfo.github].filter(Boolean);

  // Sidebar: contact, social, skills
  ySide -= 8;
  drawSide("CONTACT", ySide, 8 * fs, fontBold, accent);
  ySide -= lh;
  for (const c of contact) { drawSideWrapped(c, 7.5 * fs, font, gray); }
  for (const s of social) { drawSideWrapped(s, 7.5 * fs, font, gray); }

  if (content.skills.length > 0) {
    ySide -= 6;
    drawSide("SKILLS", ySide, 8 * fs, fontBold, accent);
    ySide -= lh;
    for (const sk of content.skills) { drawSideWrapped(`• ${sk}`, 7.5 * fs); }
  }

  const edu = content.education.filter((e) => e.degree);
  if (edu.length > 0) {
    ySide -= 6;
    drawSide("EDUCATION", ySide, 8 * fs, fontBold, accent);
    ySide -= lh;
    for (const e of edu) {
      drawSideWrapped(e.degree, 7.5 * fs, fontBold);
      drawSideWrapped(e.college, 7.5 * fs, font, gray);
      if (e.year) drawSideWrapped(e.year, 7 * fs, font, gray);
      ySide -= 3;
    }
  }

  // Main column: summary, experience, projects, certs
  const drawMainSection = (title: string) => {
    yMain -= 8;
    page.drawRectangle({ x: mainX, y: yMain - 1, width: mainW, height: 1, color: accent });
    yMain -= 12 * fs;
    drawMain(title.toUpperCase(), mainX, yMain, 8.5 * fs, fontBold, accent);
    yMain -= lh;
  };

  if (content.summary) { drawMainSection("Summary"); drawMainWrapped(content.summary, 8.5 * fs); }

  const exp = content.experience.filter((e) => e.company);
  if (exp.length > 0) {
    drawMainSection("Experience");
    for (const e of exp) {
      drawMainWrapped(`${e.role} at ${e.company}${e.duration ? ` | ${e.duration}` : ""}`, 9 * fs, fontBold);
      if (e.responsibilities) drawMainWrapped(e.responsibilities, 8.5 * fs);
      yMain -= 4;
    }
  }

  const proj = content.projects.filter((p) => p.name);
  if (proj.length > 0) {
    drawMainSection("Projects");
    for (const p of proj) {
      drawMainWrapped(`${p.name}${p.techStack ? ` (${p.techStack})` : ""}`, 9 * fs, fontBold);
      if (p.description) drawMainWrapped(p.description, 8.5 * fs);
      yMain -= 4;
    }
  }

  const certs = content.certifications.filter((c) => c.name);
  if (certs.length > 0) {
    drawMainSection("Certifications");
    for (const c of certs) drawMainWrapped(`${c.name} — ${c.issuer}${c.year ? ` (${c.year})` : ""}`, 8.5 * fs);
  }

  return doc.save();
}
