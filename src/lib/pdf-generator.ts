import { PDFDocument, rgb, StandardFonts, PDFPage, PDFFont, RGB } from "pdf-lib";

interface ResumeContent {
  name: string;
  email: string;
  phone?: string;
  summary: string;
  experience: { title: string; company: string; duration: string; bullets: string[] }[];
  education: { degree: string; school: string; year: string }[];
  skills: string[];
}

export type TemplateType = "classic" | "modern" | "executive" | "minimal" | "impact";

interface DrawContext {
  doc: PDFDocument;
  page: PDFPage;
  font: PDFFont;
  boldFont: PDFFont;
  y: number;
  margin: number;
  width: number;
}

function wrapText(text: string, maxWidth: number, fontSize: number, font: PDFFont): string[] {
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
}

function ensureSpace(ctx: DrawContext, needed: number): DrawContext {
  if (ctx.y < needed) {
    const newPage = ctx.doc.addPage([612, 792]);
    return { ...ctx, page: newPage, y: 750 };
  }
  return ctx;
}

function drawTextLine(ctx: DrawContext, text: string, x: number, size: number, font?: PDFFont, color?: RGB) {
  ctx.page.drawText(text, { x, y: ctx.y, size, font: font || ctx.font, color: color || rgb(0.1, 0.1, 0.1) });
}

function drawWrappedBlock(ctx: DrawContext, text: string, fontSize: number, indent = 0, color?: RGB): DrawContext {
  const lines = wrapText(text, ctx.width - indent, fontSize, ctx.font);
  for (const line of lines) {
    ctx = ensureSpace(ctx, 50);
    drawTextLine(ctx, line, ctx.margin + indent, fontSize, ctx.font, color);
    ctx.y -= fontSize + 4;
  }
  return ctx;
}

// ─── TEMPLATE 1: CLASSIC ATS ───────────────────────────────────────────────
function renderClassic(ctx: DrawContext, content: ResumeContent): DrawContext {
  const black = rgb(0.1, 0.1, 0.1);
  const grey = rgb(0.3, 0.3, 0.3);

  // Name — centered, large
  const nameWidth = ctx.boldFont.widthOfTextAtSize(content.name, 20);
  drawTextLine(ctx, content.name, (612 - nameWidth) / 2, 20, ctx.boldFont, black);
  ctx.y -= 16;

  // Contact — centered
  const contact = `${content.email}${content.phone ? ` | ${content.phone}` : ""}`;
  const contactWidth = ctx.font.widthOfTextAtSize(contact, 9);
  drawTextLine(ctx, contact, (612 - contactWidth) / 2, 9, ctx.font, grey);
  ctx.y -= 20;

  // Divider
  ctx.page.drawLine({ start: { x: ctx.margin, y: ctx.y }, end: { x: ctx.margin + ctx.width, y: ctx.y }, thickness: 1, color: black });
  ctx.y -= 18;

  // Summary
  drawTextLine(ctx, "PROFESSIONAL SUMMARY", ctx.margin, 11, ctx.boldFont, black);
  ctx.y -= 15;
  ctx = drawWrappedBlock(ctx, content.summary, 9);
  ctx.y -= 8;

  // Experience
  if (content.experience.length > 0) {
    ctx.page.drawLine({ start: { x: ctx.margin, y: ctx.y }, end: { x: ctx.margin + ctx.width, y: ctx.y }, thickness: 0.5, color: grey });
    ctx.y -= 14;
    drawTextLine(ctx, "PROFESSIONAL EXPERIENCE", ctx.margin, 11, ctx.boldFont, black);
    ctx.y -= 16;
    for (const exp of content.experience) {
      ctx = ensureSpace(ctx, 80);
      drawTextLine(ctx, exp.title, ctx.margin, 10, ctx.boldFont, black);
      const durW = ctx.font.widthOfTextAtSize(exp.duration, 8);
      drawTextLine(ctx, exp.duration, ctx.margin + ctx.width - durW, 8, ctx.font, grey);
      ctx.y -= 13;
      drawTextLine(ctx, exp.company, ctx.margin, 9, ctx.font, grey);
      ctx.y -= 14;
      for (const bullet of exp.bullets) {
        ctx = ensureSpace(ctx, 50);
        ctx = drawWrappedBlock(ctx, `• ${bullet}`, 9, 8);
      }
      ctx.y -= 6;
    }
  }

  // Education
  if (content.education.length > 0) {
    ctx.page.drawLine({ start: { x: ctx.margin, y: ctx.y }, end: { x: ctx.margin + ctx.width, y: ctx.y }, thickness: 0.5, color: grey });
    ctx.y -= 14;
    drawTextLine(ctx, "EDUCATION", ctx.margin, 11, ctx.boldFont, black);
    ctx.y -= 16;
    for (const edu of content.education) {
      ctx = ensureSpace(ctx, 50);
      drawTextLine(ctx, edu.degree, ctx.margin, 10, ctx.boldFont, black);
      ctx.y -= 13;
      drawTextLine(ctx, `${edu.school} — ${edu.year}`, ctx.margin, 9, ctx.font, grey);
      ctx.y -= 16;
    }
  }

  // Skills
  if (content.skills.length > 0) {
    ctx.page.drawLine({ start: { x: ctx.margin, y: ctx.y }, end: { x: ctx.margin + ctx.width, y: ctx.y }, thickness: 0.5, color: grey });
    ctx.y -= 14;
    drawTextLine(ctx, "SKILLS", ctx.margin, 11, ctx.boldFont, black);
    ctx.y -= 14;
    ctx = drawWrappedBlock(ctx, content.skills.join("  |  "), 9);
  }

  return ctx;
}

// ─── TEMPLATE 2: MODERN TECH ───────────────────────────────────────────────
function renderModern(ctx: DrawContext, content: ResumeContent): DrawContext {
  const blue = rgb(0.1, 0.45, 0.82);
  const dark = rgb(0.12, 0.12, 0.14);
  const mid = rgb(0.4, 0.4, 0.45);

  // Bold name header with blue accent bar
  ctx.page.drawRectangle({ x: ctx.margin, y: ctx.y - 4, width: 4, height: 28, color: blue });
  drawTextLine(ctx, content.name.toUpperCase(), ctx.margin + 14, 22, ctx.boldFont, dark);
  ctx.y -= 18;

  // Contact on same line as accent
  drawTextLine(ctx, `${content.email}${content.phone ? `  •  ${content.phone}` : ""}`, ctx.margin + 14, 9, ctx.font, mid);
  ctx.y -= 20;

  // Blue accent line
  ctx.page.drawLine({ start: { x: ctx.margin, y: ctx.y }, end: { x: ctx.margin + ctx.width, y: ctx.y }, thickness: 2, color: blue });
  ctx.y -= 18;

  // Summary
  drawTextLine(ctx, "ABOUT", ctx.margin, 10, ctx.boldFont, blue);
  ctx.y -= 14;
  ctx = drawWrappedBlock(ctx, content.summary, 9, 0, mid);
  ctx.y -= 10;

  // Skills as tag-style grid
  if (content.skills.length > 0) {
    drawTextLine(ctx, "TECHNICAL SKILLS", ctx.margin, 10, ctx.boldFont, blue);
    ctx.y -= 16;
    let xPos = ctx.margin;
    for (const skill of content.skills) {
      const skillW = ctx.font.widthOfTextAtSize(skill, 8) + 14;
      if (xPos + skillW > ctx.margin + ctx.width) {
        xPos = ctx.margin;
        ctx.y -= 18;
        ctx = ensureSpace(ctx, 50);
      }
      // Tag background
      ctx.page.drawRectangle({ x: xPos, y: ctx.y - 4, width: skillW, height: 16, color: rgb(0.92, 0.95, 0.99), borderColor: rgb(0.8, 0.85, 0.92), borderWidth: 0.5 });
      ctx.page.drawText(skill, { x: xPos + 7, y: ctx.y, size: 8, font: ctx.font, color: dark });
      xPos += skillW + 6;
    }
    ctx.y -= 24;
  }

  // Experience
  if (content.experience.length > 0) {
    drawTextLine(ctx, "EXPERIENCE", ctx.margin, 10, ctx.boldFont, blue);
    ctx.y -= 16;
    for (const exp of content.experience) {
      ctx = ensureSpace(ctx, 80);
      drawTextLine(ctx, exp.title, ctx.margin, 10, ctx.boldFont, dark);
      ctx.y -= 13;
      drawTextLine(ctx, `${exp.company}  ·  ${exp.duration}`, ctx.margin, 8, ctx.font, mid);
      ctx.y -= 14;
      for (const bullet of exp.bullets) {
        ctx = ensureSpace(ctx, 50);
        ctx = drawWrappedBlock(ctx, `▸ ${bullet}`, 9, 8, mid);
      }
      ctx.y -= 8;
    }
  }

  // Education
  if (content.education.length > 0) {
    drawTextLine(ctx, "EDUCATION", ctx.margin, 10, ctx.boldFont, blue);
    ctx.y -= 16;
    for (const edu of content.education) {
      ctx = ensureSpace(ctx, 50);
      drawTextLine(ctx, `${edu.degree}  —  ${edu.school} (${edu.year})`, ctx.margin, 9, ctx.font, dark);
      ctx.y -= 14;
    }
  }

  return ctx;
}

// ─── TEMPLATE 3: EXECUTIVE PROFESSIONAL ─────────────────────────────────────
function renderExecutive(ctx: DrawContext, content: ResumeContent): DrawContext {
  const navy = rgb(0.1, 0.15, 0.3);
  const gold = rgb(0.55, 0.45, 0.25);
  const body = rgb(0.2, 0.2, 0.22);

  // Large name block
  drawTextLine(ctx, content.name.toUpperCase(), ctx.margin, 26, ctx.boldFont, navy);
  ctx.y -= 18;

  // Role/title line if available from first experience
  if (content.experience.length > 0) {
    drawTextLine(ctx, content.experience[0].title, ctx.margin, 12, ctx.font, gold);
    ctx.y -= 16;
  }

  // Contact
  drawTextLine(ctx, `${content.email}${content.phone ? `  |  ${content.phone}` : ""}`, ctx.margin, 9, ctx.font, body);
  ctx.y -= 14;

  // Double line separator
  ctx.page.drawLine({ start: { x: ctx.margin, y: ctx.y }, end: { x: ctx.margin + ctx.width, y: ctx.y }, thickness: 1.5, color: navy });
  ctx.y -= 3;
  ctx.page.drawLine({ start: { x: ctx.margin, y: ctx.y }, end: { x: ctx.margin + ctx.width, y: ctx.y }, thickness: 0.5, color: gold });
  ctx.y -= 20;

  // Executive Summary
  drawTextLine(ctx, "Executive Summary", ctx.margin, 12, ctx.boldFont, navy);
  ctx.y -= 16;
  ctx = drawWrappedBlock(ctx, content.summary, 9.5, 0, body);
  ctx.y -= 14;

  // Experience with premium spacing
  if (content.experience.length > 0) {
    ctx.page.drawLine({ start: { x: ctx.margin, y: ctx.y }, end: { x: ctx.margin + 120, y: ctx.y }, thickness: 0.5, color: gold });
    ctx.y -= 14;
    drawTextLine(ctx, "Professional Experience", ctx.margin, 12, ctx.boldFont, navy);
    ctx.y -= 18;
    for (const exp of content.experience) {
      ctx = ensureSpace(ctx, 90);
      drawTextLine(ctx, exp.title.toUpperCase(), ctx.margin, 10, ctx.boldFont, navy);
      ctx.y -= 14;
      drawTextLine(ctx, exp.company, ctx.margin, 9, ctx.boldFont, gold);
      const durW = ctx.font.widthOfTextAtSize(exp.duration, 8);
      drawTextLine(ctx, exp.duration, ctx.margin + ctx.width - durW, 8, ctx.font, body);
      ctx.y -= 15;
      for (const bullet of exp.bullets) {
        ctx = ensureSpace(ctx, 50);
        ctx = drawWrappedBlock(ctx, `— ${bullet}`, 9, 10, body);
      }
      ctx.y -= 10;
    }
  }

  // Education
  if (content.education.length > 0) {
    ctx.page.drawLine({ start: { x: ctx.margin, y: ctx.y }, end: { x: ctx.margin + 120, y: ctx.y }, thickness: 0.5, color: gold });
    ctx.y -= 14;
    drawTextLine(ctx, "Education", ctx.margin, 12, ctx.boldFont, navy);
    ctx.y -= 16;
    for (const edu of content.education) {
      ctx = ensureSpace(ctx, 50);
      drawTextLine(ctx, edu.degree, ctx.margin, 10, ctx.boldFont, navy);
      ctx.y -= 13;
      drawTextLine(ctx, `${edu.school}  •  ${edu.year}`, ctx.margin, 9, ctx.font, body);
      ctx.y -= 18;
    }
  }

  // Skills
  if (content.skills.length > 0) {
    ctx.page.drawLine({ start: { x: ctx.margin, y: ctx.y }, end: { x: ctx.margin + 120, y: ctx.y }, thickness: 0.5, color: gold });
    ctx.y -= 14;
    drawTextLine(ctx, "Core Competencies", ctx.margin, 12, ctx.boldFont, navy);
    ctx.y -= 14;
    ctx = drawWrappedBlock(ctx, content.skills.join("  •  "), 9, 0, body);
  }

  return ctx;
}

// ─── TEMPLATE 4: MINIMAL CLEAN ──────────────────────────────────────────────
function renderMinimal(ctx: DrawContext, content: ResumeContent): DrawContext {
  const dark = rgb(0.15, 0.15, 0.15);
  const light = rgb(0.55, 0.55, 0.55);
  const lineColor = rgb(0.85, 0.85, 0.85);

  // Name — lowercase elegant
  drawTextLine(ctx, content.name, ctx.margin, 20, ctx.boldFont, dark);
  ctx.y -= 15;
  drawTextLine(ctx, `${content.email}${content.phone ? `  ·  ${content.phone}` : ""}`, ctx.margin, 8.5, ctx.font, light);
  ctx.y -= 16;

  // Thin full-width line
  ctx.page.drawLine({ start: { x: ctx.margin, y: ctx.y }, end: { x: ctx.margin + ctx.width, y: ctx.y }, thickness: 0.3, color: lineColor });
  ctx.y -= 20;

  // Summary — no header, just text
  ctx = drawWrappedBlock(ctx, content.summary, 9, 0, dark);
  ctx.y -= 16;

  // Experience
  if (content.experience.length > 0) {
    ctx.page.drawLine({ start: { x: ctx.margin, y: ctx.y }, end: { x: ctx.margin + ctx.width, y: ctx.y }, thickness: 0.3, color: lineColor });
    ctx.y -= 14;
    drawTextLine(ctx, "Experience", ctx.margin, 9, ctx.boldFont, light);
    ctx.y -= 16;
    for (const exp of content.experience) {
      ctx = ensureSpace(ctx, 80);
      drawTextLine(ctx, exp.title, ctx.margin, 10, ctx.boldFont, dark);
      ctx.y -= 12;
      drawTextLine(ctx, `${exp.company}`, ctx.margin, 8.5, ctx.font, light);
      const durW = ctx.font.widthOfTextAtSize(exp.duration, 8);
      drawTextLine(ctx, exp.duration, ctx.margin + ctx.width - durW, 8, ctx.font, light);
      ctx.y -= 14;
      for (const bullet of exp.bullets) {
        ctx = ensureSpace(ctx, 50);
        ctx = drawWrappedBlock(ctx, `· ${bullet}`, 8.5, 6, dark);
      }
      ctx.y -= 8;
    }
  }

  // Education
  if (content.education.length > 0) {
    ctx.page.drawLine({ start: { x: ctx.margin, y: ctx.y }, end: { x: ctx.margin + ctx.width, y: ctx.y }, thickness: 0.3, color: lineColor });
    ctx.y -= 14;
    drawTextLine(ctx, "Education", ctx.margin, 9, ctx.boldFont, light);
    ctx.y -= 16;
    for (const edu of content.education) {
      ctx = ensureSpace(ctx, 50);
      drawTextLine(ctx, `${edu.degree}, ${edu.school} — ${edu.year}`, ctx.margin, 9, ctx.font, dark);
      ctx.y -= 14;
    }
  }

  // Skills — inline, no header emphasis
  if (content.skills.length > 0) {
    ctx.page.drawLine({ start: { x: ctx.margin, y: ctx.y }, end: { x: ctx.margin + ctx.width, y: ctx.y }, thickness: 0.3, color: lineColor });
    ctx.y -= 14;
    drawTextLine(ctx, "Skills", ctx.margin, 9, ctx.boldFont, light);
    ctx.y -= 14;
    ctx = drawWrappedBlock(ctx, content.skills.join(", "), 8.5, 0, dark);
  }

  return ctx;
}

// ─── TEMPLATE 5: IMPACT-FOCUSED ─────────────────────────────────────────────
function renderImpact(ctx: DrawContext, content: ResumeContent): DrawContext {
  const dark = rgb(0.1, 0.1, 0.1);
  const accent = rgb(0.15, 0.5, 0.35);
  const mid = rgb(0.35, 0.35, 0.38);

  // Name + accent block
  ctx.page.drawRectangle({ x: ctx.margin, y: ctx.y - 8, width: ctx.width, height: 36, color: rgb(0.96, 0.97, 0.96) });
  drawTextLine(ctx, content.name.toUpperCase(), ctx.margin + 10, 22, ctx.boldFont, dark);
  ctx.y -= 18;
  drawTextLine(ctx, `${content.email}${content.phone ? `  |  ${content.phone}` : ""}`, ctx.margin + 10, 9, ctx.font, mid);
  ctx.y -= 24;

  // Summary as "Value Proposition"
  drawTextLine(ctx, "VALUE PROPOSITION", ctx.margin, 10, ctx.boldFont, accent);
  ctx.y -= 14;
  ctx = drawWrappedBlock(ctx, content.summary, 9.5, 0, dark);
  ctx.y -= 10;

  // Key achievements extracted from first few bullets
  const topAchievements = content.experience.flatMap(e => e.bullets).slice(0, 3);
  if (topAchievements.length > 0) {
    ctx.page.drawRectangle({ x: ctx.margin, y: ctx.y - (topAchievements.length * 16) - 8, width: ctx.width, height: topAchievements.length * 16 + 20, color: rgb(0.95, 0.97, 0.95) });
    drawTextLine(ctx, "KEY ACHIEVEMENTS", ctx.margin + 8, 10, ctx.boldFont, accent);
    ctx.y -= 16;
    for (const ach of topAchievements) {
      ctx = ensureSpace(ctx, 50);
      // Bold numbers in achievement by rendering the whole line with bold font
      drawTextLine(ctx, `★  ${ach}`, ctx.margin + 8, 9, ctx.boldFont, dark);
      ctx.y -= 15;
    }
    ctx.y -= 10;
  }

  // Experience — results-first formatting
  if (content.experience.length > 0) {
    ctx.page.drawLine({ start: { x: ctx.margin, y: ctx.y }, end: { x: ctx.margin + ctx.width, y: ctx.y }, thickness: 1, color: accent });
    ctx.y -= 14;
    drawTextLine(ctx, "CAREER PROGRESSION", ctx.margin, 10, ctx.boldFont, accent);
    ctx.y -= 18;
    for (const exp of content.experience) {
      ctx = ensureSpace(ctx, 80);
      drawTextLine(ctx, exp.title, ctx.margin, 10, ctx.boldFont, dark);
      const durW = ctx.font.widthOfTextAtSize(exp.duration, 8);
      drawTextLine(ctx, exp.duration, ctx.margin + ctx.width - durW, 8, ctx.font, mid);
      ctx.y -= 13;
      drawTextLine(ctx, exp.company, ctx.margin, 9, ctx.font, accent);
      ctx.y -= 14;
      for (const bullet of exp.bullets) {
        ctx = ensureSpace(ctx, 50);
        ctx = drawWrappedBlock(ctx, `▶ ${bullet}`, 9, 8, dark);
      }
      ctx.y -= 8;
    }
  }

  // Education
  if (content.education.length > 0) {
    ctx.page.drawLine({ start: { x: ctx.margin, y: ctx.y }, end: { x: ctx.margin + ctx.width, y: ctx.y }, thickness: 0.5, color: accent });
    ctx.y -= 14;
    drawTextLine(ctx, "EDUCATION", ctx.margin, 10, ctx.boldFont, accent);
    ctx.y -= 16;
    for (const edu of content.education) {
      ctx = ensureSpace(ctx, 50);
      drawTextLine(ctx, edu.degree, ctx.margin, 10, ctx.boldFont, dark);
      ctx.y -= 12;
      drawTextLine(ctx, `${edu.school} — ${edu.year}`, ctx.margin, 9, ctx.font, mid);
      ctx.y -= 16;
    }
  }

  // Skills
  if (content.skills.length > 0) {
    ctx.page.drawLine({ start: { x: ctx.margin, y: ctx.y }, end: { x: ctx.margin + ctx.width, y: ctx.y }, thickness: 0.5, color: accent });
    ctx.y -= 14;
    drawTextLine(ctx, "CORE SKILLS", ctx.margin, 10, ctx.boldFont, accent);
    ctx.y -= 14;
    ctx = drawWrappedBlock(ctx, content.skills.join("  ·  "), 9, 0, dark);
  }

  return ctx;
}

// ─── MAIN EXPORT ────────────────────────────────────────────────────────────
export async function generateResumePdf(content: ResumeContent, template: TemplateType): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([612, 792]);

  let ctx: DrawContext = { doc, page, font, boldFont, y: 750, margin: 50, width: 512 };

  switch (template) {
    case "classic": ctx = renderClassic(ctx, content); break;
    case "modern": ctx = renderModern(ctx, content); break;
    case "executive": ctx = renderExecutive(ctx, content); break;
    case "minimal": ctx = renderMinimal(ctx, content); break;
    case "impact": ctx = renderImpact(ctx, content); break;
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
