import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { ResumeContent, TemplateId } from "./resume-builder-types";

export async function generateResumePdf(content: ResumeContent, _templateId: TemplateId): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]); // A4
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const { width, height } = page.getSize();

  let y = height - 50;
  const margin = 50;
  const maxW = width - margin * 2;
  const lineHeight = 14;
  const black = rgb(0, 0, 0);
  const gray = rgb(0.4, 0.4, 0.4);
  const accent = rgb(0.91, 0.35, 0.05); // primary orange

  const drawText = (text: string, x: number, yPos: number, size: number, f = font, color = black) => {
    page.drawText(text, { x, y: yPos, size, font: f, color, maxWidth: maxW });
  };

  const drawSection = (title: string) => {
    y -= 8;
    page.drawRectangle({ x: margin, y: y - 1, width: maxW, height: 1, color: accent });
    y -= 14;
    drawText(title.toUpperCase(), margin, y, 9, fontBold, accent);
    y -= lineHeight;
  };

  const wrapText = (text: string, size: number, f = font) => {
    const words = text.split(" ");
    const lines: string[] = [];
    let current = "";
    for (const word of words) {
      const test = current ? `${current} ${word}` : word;
      const w = f.widthOfTextAtSize(test, size);
      if (w > maxW && current) {
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
      y -= lineHeight;
    }
  };

  // Header
  const { basicInfo } = content;
  const nameW = fontBold.widthOfTextAtSize(basicInfo.fullName || "Your Name", 18);
  drawText(basicInfo.fullName || "Your Name", (width - nameW) / 2, y, 18, fontBold);
  y -= 18;

  const contact = [basicInfo.email, basicInfo.phone, basicInfo.linkedin, basicInfo.github].filter(Boolean).join("  •  ");
  if (contact) {
    const cw = font.widthOfTextAtSize(contact, 8);
    drawText(contact, (width - cw) / 2, y, 8, font, gray);
    y -= 16;
  }

  // Summary
  if (content.summary) {
    drawSection("Summary");
    drawWrapped(content.summary, 9);
  }

  // Skills
  if (content.skills.length > 0) {
    drawSection("Skills");
    drawWrapped(content.skills.join("  •  "), 9);
  }

  // Education
  const edu = content.education.filter((e) => e.degree);
  if (edu.length > 0) {
    drawSection("Education");
    for (const e of edu) {
      drawWrapped(`${e.degree} — ${e.college}${e.year ? ` (${e.year})` : ""}`, 9, fontBold);
    }
  }

  // Experience
  const exp = content.experience.filter((e) => e.company);
  if (exp.length > 0) {
    drawSection("Experience");
    for (const e of exp) {
      drawWrapped(`${e.role} at ${e.company}${e.duration ? ` | ${e.duration}` : ""}`, 9, fontBold);
      if (e.responsibilities) drawWrapped(e.responsibilities, 9);
      y -= 4;
    }
  }

  // Projects
  const proj = content.projects.filter((p) => p.name);
  if (proj.length > 0) {
    drawSection("Projects");
    for (const p of proj) {
      drawWrapped(`${p.name}${p.techStack ? ` (${p.techStack})` : ""}`, 9, fontBold);
      if (p.description) drawWrapped(p.description, 9);
      y -= 4;
    }
  }

  // Certifications
  const certs = content.certifications.filter((c) => c.name);
  if (certs.length > 0) {
    drawSection("Certifications");
    for (const c of certs) {
      drawWrapped(`${c.name} — ${c.issuer}${c.year ? ` (${c.year})` : ""}`, 9);
    }
  }

  return doc.save();
}
