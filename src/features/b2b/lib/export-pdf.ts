// Per-student PDF report with the institution's logo (pdf-lib, already used by B2C).
// Standard PDF fonts only cover Latin-1 (WinAnsi); other characters are transliterated
// or replaced so a name in another script never breaks the export.
import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import type { DashEval } from "./dashboard";
import { DIMENSIONS, DIMENSION_LABEL, type AudioMetrics, type EvaluationResult } from "./shared";

const READINESS_TEXT = { ready: "Ready", developing: "Developing", not_ready: "Not ready yet" } as const;
const COMBINING_MARKS = new RegExp(`[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`, "g");
const INK = rgb(0.12, 0.12, 0.16);
const MUTED = rgb(0.42, 0.42, 0.48);
const ACCENT = rgb(0.43, 0.16, 0.85);
const BAR_BG = rgb(0.92, 0.92, 0.95);

export interface StudentPdfInput {
  orgName: string;
  /** Watermarks every page "DEMO - fictional data". */
  isDemo?: boolean;
  logo?: { bytes: Uint8Array; type: "png" | "jpg" } | null;
  student: { full_name: string | null; roll_no: string | null; batch_name: string | null; department: string | null };
  interviews: DashEval[];               // oldest first
  latest: { result: EvaluationResult; metrics: AudioMetrics | null; module_name: string; date: string; pass: number } | null;
  generatedAt?: Date;
}

/** Map to WinAnsi-safe text: common punctuation → ASCII, other non-Latin-1 → "?". */
export function pdfSafe(s: string | null | undefined): string {
  return (s ?? "")
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/…/g, "...").replace(/[•·]/g, "-")
    .normalize("NFKD").replace(COMBINING_MARKS, "")
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const words = pdfSafe(text).split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(next, size) > width && line) { lines.push(line); line = w; }
    else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

function scoreColor(score: number, pass: number) {
  if (score >= pass) return rgb(0.2, 0.66, 0.43);
  if (score >= pass - 2) return rgb(0.93, 0.62, 0.15);
  return rgb(0.86, 0.3, 0.3);
}

export async function fetchLogo(url: string | null | undefined): Promise<StudentPdfInput["logo"]> {
  if (!url) return null;
  try {
    const res = await fetch(url, { mode: "cors" });
    if (!res.ok) return null;
    const type = res.headers.get("content-type") ?? "";
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (/png/.test(type) || (bytes[0] === 0x89 && bytes[1] === 0x50)) return { bytes, type: "png" };
    if (/jpe?g/.test(type) || (bytes[0] === 0xff && bytes[1] === 0xd8)) return { bytes, type: "jpg" };
    return null; // SVG/WebP aren't embeddable by pdf-lib
  } catch {
    return null; // CORS or network: fall back to the name only
  }
}

export async function buildStudentPdf(input: StudentPdfInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(pdfSafe(`${input.student.full_name ?? "Student"} - interview report`));
  pdf.setProducer("HiResume");
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let logo: PDFImage | null = null;
  if (input.logo) {
    try { logo = input.logo.type === "png" ? await pdf.embedPng(input.logo.bytes) : await pdf.embedJpg(input.logo.bytes); } catch { logo = null; }
  }

  const W = 595.28, H = 841.89, M = 48, CW = W - 2 * M;
  let page: PDFPage = pdf.addPage([W, H]);
  let y = H - M;

  const newPage = () => { page = pdf.addPage([W, H]); y = H - M; };
  const need = (h: number) => { if (y - h < M + 30) newPage(); };
  const text = (t: string, opts: { x?: number; size?: number; font?: PDFFont; color?: ReturnType<typeof rgb> } = {}) => {
    page.drawText(pdfSafe(t), { x: opts.x ?? M, y, size: opts.size ?? 10, font: opts.font ?? regular, color: opts.color ?? INK });
  };
  const para = (t: string, size = 10, color = INK, indent = 0) => {
    for (const line of wrap(t, regular, size, CW - indent)) { need(size + 4); text(line, { x: M + indent, size, color }); y -= size + 4; }
  };
  const heading = (t: string) => { need(28); y -= 8; text(t, { size: 12, font: bold, color: ACCENT }); y -= 18; };

  // Header
  if (logo) {
    const h = 40, w = Math.min(120, (logo.width / logo.height) * h);
    page.drawImage(logo, { x: M, y: y - h + 8, width: w, height: h });
    text(input.orgName, { x: M + w + 12, size: 14, font: bold });
    y -= 16;
    text("Interview readiness report", { x: M + w + 12, size: 10, color: MUTED });
    y -= 34;
  } else {
    text(input.orgName, { size: 16, font: bold }); y -= 16;
    text("Interview readiness report", { size: 10, color: MUTED }); y -= 24;
  }
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.8, color: BAR_BG });
  y -= 20;

  const s = input.student;
  text(s.full_name ?? "Student", { size: 14, font: bold }); y -= 16;
  text([s.roll_no && `Roll no ${s.roll_no}`, s.batch_name, s.department].filter(Boolean).join("  |  "), { color: MUTED }); y -= 22;

  if (!input.latest) {
    para("No scored interviews yet.", 11, MUTED);
  } else {
    const L = input.latest, r = L.result;
    // Headline
    text(`Latest: ${L.module_name}  (${L.date})`, { color: MUTED }); y -= 18;
    text(`Readiness: ${READINESS_TEXT[r.readiness_level]}`, { size: 13, font: bold });
    text(`Overall ${r.overall_score ?? "-"} / 10   (pass mark ${L.pass})`, { x: M + 240, size: 11 });
    y -= 22;
    para(`Main gap: ${r.primary_gap}`, 10);
    y -= 2;
    text("Practise next:", { font: bold }); y -= 14;
    for (const f of r.recommended_focus) para(`- ${f}`, 10, INK, 10);

    heading("Skills");
    for (const d of DIMENSIONS) {
      const item = r.dimensions[d];
      need(18);
      text(DIMENSION_LABEL[d], { size: 10 });
      const bx = M + 170, bw = 220;
      page.drawRectangle({ x: bx, y: y - 1, width: bw, height: 7, color: BAR_BG });
      if (typeof item.score === "number") {
        page.drawRectangle({ x: bx, y: y - 1, width: (bw * item.score) / 10, height: 7, color: scoreColor(item.score, L.pass) });
        text(String(item.score), { x: bx + bw + 10, size: 10, font: bold });
      } else {
        text("not enough evidence", { x: bx + bw + 10, size: 8, color: MUTED });
      }
      y -= 14;
      for (const line of wrap(item.reason, regular, 8, CW - 10).slice(0, 2)) { need(11); text(line, { x: M + 10, size: 8, color: MUTED }); y -= 10; }
      if (item.evidence[0]) {
        for (const line of wrap(`"${item.evidence[0]}"`, regular, 8, CW - 20).slice(0, 2)) { need(11); text(line, { x: M + 20, size: 8, color: ACCENT }); y -= 10; }
      }
      y -= 4;
    }

    heading("Topics");
    for (const [t, item] of Object.entries(r.per_topic)) {
      need(14);
      text(t, { size: 10 });
      text(typeof item.score === "number" ? `${item.score} / 10` : "not assessed", { x: W - M - 80, size: 10, color: typeof item.score === "number" ? INK : MUTED });
      y -= 14;
    }

    if (L.metrics) {
      const m = L.metrics;
      heading("How the student spoke");
      const sec = (ms: number | null) => (ms === null ? "-" : `${(ms / 1000).toFixed(1)} s`);
      for (const [k, v] of [
        ["Speaking rate", m.words_per_minute === null ? "-" : `${m.words_per_minute} words per minute`],
        ["Pause before answering", `average ${sec(m.avg_pause_before_answer_ms)}, longest ${sec(m.max_pause_before_answer_ms)}`],
        ["Filler words", `${m.fillers_total}${m.fillers_per_100_words !== null ? ` (${m.fillers_per_100_words} per 100 words; lower bound)` : ""}`],
        ["Average answer length", m.avg_answer_words === null ? "-" : `${m.avg_answer_words} words`],
      ] as const) {
        need(14);
        text(k, { size: 10, color: MUTED });
        text(v, { x: M + 170, size: 10 });
        y -= 14;
      }
    }
  }

  if (input.interviews.length) {
    heading(`Progress (${input.interviews.length} interview${input.interviews.length === 1 ? "" : "s"})`);
    const first = input.interviews[0], last = input.interviews.at(-1)!;
    if (input.interviews.length >= 2 && first.overall_score !== null && last.overall_score !== null) {
      const d = Math.round((last.overall_score - first.overall_score) * 10) / 10;
      para(`First ${first.overall_score} -> latest ${last.overall_score} (${d >= 0 ? "+" : ""}${d}).`, 10);
    }
    for (const iv of input.interviews) {
      need(13);
      text(new Date(iv.started_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }), { size: 9, color: MUTED });
      text(iv.module_name, { x: M + 90, size: 9 });
      text(iv.overall_score === null ? "-" : `${iv.overall_score} / 10`, { x: M + 330, size: 9 });
      text(iv.readiness_level ? READINESS_TEXT[iv.readiness_level] : "-", { x: M + 400, size: 9 });
      y -= 13;
    }
  }

  // Footer on every page
  const when = (input.generatedAt ?? new Date()).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  const pages = pdf.getPages();
  if (input.isDemo) {
    for (const p of pages) {
      p.drawText("DEMO - fictional student and scores", { x: 120, y: 420, size: 34, font: bold, color: rgb(0.93, 0.62, 0.15), opacity: 0.18, rotate: degrees(35) });
      p.drawText("DEMO - fictional data", { x: W - M - 110, y: H - 30, size: 8, font: bold, color: rgb(0.85, 0.5, 0.1) });
    }
  }
  pages.forEach((p, i) => {
    p.drawText(pdfSafe(`Generated by HiResume on ${when}. AI-assisted assessment; scores are indicative and based on quoted evidence.  Page ${i + 1} of ${pages.length}`), {
      x: M, y: 24, size: 7, font: regular, color: MUTED,
    });
  });
  return pdf.save();
}
