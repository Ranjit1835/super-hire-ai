import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

interface ResumeContent {
  name: string;
  email: string;
  phone?: string;
  summary: string;
  experience: { title: string; company: string; duration: string; bullets: string[] }[];
  education: { degree: string; school: string; year: string }[];
  skills: string[];
}

export async function generateResumePdf(content: ResumeContent, template: "classic" | "modern" | "executive"): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);

  let page = doc.addPage([612, 792]);
  let y = 750;
  const margin = 50;
  const width = 512;

  const textColor = rgb(0.1, 0.1, 0.1);
  const accentColor = template === "modern" ? rgb(0.1, 0.6, 0.4) : template === "executive" ? rgb(0.15, 0.2, 0.35) : rgb(0.2, 0.2, 0.2);

  const drawText = (text: string, x: number, yPos: number, size: number, f = font, color = textColor) => {
    page.drawText(text, { x, y: yPos, size, font: f, color });
  };

  const drawLine = (yPos: number) => {
    page.drawLine({ start: { x: margin, y: yPos }, end: { x: margin + width, y: yPos }, thickness: 0.5, color: accentColor });
  };

  const wrapText = (text: string, maxWidth: number, fontSize: number): string[] => {
    const words = text.split(" ");
    const lines: string[] = [];
    let current = "";
    for (const word of words) {
      const test = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(test, fontSize) > maxWidth) {
        if (current) lines.push(current);
        current = word;
      } else {
        current = test;
      }
    }
    if (current) lines.push(current);
    return lines;
  };

  // Header
  drawText(content.name, margin, y, 22, boldFont, accentColor);
  y -= 18;
  drawText(`${content.email}${content.phone ? ` | ${content.phone}` : ""}`, margin, y, 9);
  y -= 14;
  drawLine(y);
  y -= 18;

  // Summary
  drawText("PROFESSIONAL SUMMARY", margin, y, 11, boldFont, accentColor);
  y -= 14;
  const summaryLines = wrapText(content.summary, width, 9);
  for (const line of summaryLines) {
    if (y < 50) { page = doc.addPage([612, 792]); y = 750; }
    drawText(line, margin, y, 9);
    y -= 13;
  }
  y -= 8;
  drawLine(y);
  y -= 18;

  // Experience
  if (content.experience.length > 0) {
    drawText("EXPERIENCE", margin, y, 11, boldFont, accentColor);
    y -= 16;
    for (const exp of content.experience) {
      if (y < 80) { page = doc.addPage([612, 792]); y = 750; }
      drawText(exp.title, margin, y, 10, boldFont);
      drawText(exp.duration, margin + width - font.widthOfTextAtSize(exp.duration, 8), y, 8);
      y -= 13;
      drawText(exp.company, margin, y, 9);
      y -= 14;
      for (const bullet of exp.bullets) {
        const bulletLines = wrapText(`• ${bullet}`, width - 10, 9);
        for (const line of bulletLines) {
          if (y < 50) { page = doc.addPage([612, 792]); y = 750; }
          drawText(line, margin + 5, y, 9);
          y -= 13;
        }
      }
      y -= 6;
    }
    drawLine(y);
    y -= 18;
  }

  // Education
  if (content.education.length > 0) {
    if (y < 80) { page = doc.addPage([612, 792]); y = 750; }
    drawText("EDUCATION", margin, y, 11, boldFont, accentColor);
    y -= 16;
    for (const edu of content.education) {
      drawText(edu.degree, margin, y, 10, boldFont);
      y -= 13;
      drawText(`${edu.school} — ${edu.year}`, margin, y, 9);
      y -= 16;
    }
    drawLine(y);
    y -= 18;
  }

  // Skills
  if (content.skills.length > 0) {
    if (y < 80) { page = doc.addPage([612, 792]); y = 750; }
    drawText("SKILLS", margin, y, 11, boldFont, accentColor);
    y -= 14;
    const skillLines = wrapText(content.skills.join(" • "), width, 9);
    for (const line of skillLines) {
      if (y < 50) { page = doc.addPage([612, 792]); y = 750; }
      drawText(line, margin, y, 9);
      y -= 13;
    }
  }

  return doc.save();
}

export function downloadPdf(bytes: Uint8Array, filename: string) {
  const blob = new Blob([bytes as unknown as BlobPart], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
