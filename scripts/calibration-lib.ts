// ─── AI vs human rater agreement (pure) ───────────────────────────────────────
// Used by scripts/b2b-calibrate.ts. Per dimension: n, means, bias (AI − human), MAE,
// % within ±1 point, Pearson r, quadratic-weighted kappa on 0–10 integer scores, and —
// when two or more trainers scored the same interviews — the human–human baseline, so
// you can see whether the AI disagrees with trainers more than trainers disagree with
// each other.

export const DIMENSIONS = [
  "technical_knowledge", "communication", "language", "analytical_thinking",
  "problem_solving", "confidence", "role_specific_knowledge", "resume_project_knowledge",
] as const;
export type Dimension = (typeof DIMENSIONS)[number];
export type Readiness = "not_ready" | "developing" | "ready";

export interface HumanRow {
  interview_id: string;
  rater: string;
  scores: Partial<Record<Dimension, number>>;
  readiness?: Readiness;
}
export interface AiRow {
  interview_id: string;
  scores: Partial<Record<Dimension, number | "insufficient_data">>;
  readiness?: Readiness;
}

export interface Agreement {
  n: number;
  mean_human: number | null;
  mean_ai: number | null;
  bias: number | null;
  mae: number | null;
  within_1: number | null; // fraction 0–1
  pearson: number | null;
  qwk: number | null;
}

export interface DimensionReport extends Agreement {
  dimension: Dimension;
  ai_insufficient: number;
  human_baseline: Agreement | null;
}

export interface CalibrationReport {
  interviews_matched: number;
  interviews_missing_ai: string[];
  dimensions: DimensionReport[];
  readiness: { n: number; exact: number | null; confusion: Record<Readiness, Record<Readiness, number>> };
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const meanOf = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

export function pearson(a: number[], b: number[]): number | null {
  if (a.length < 3) return null;
  const ma = meanOf(a), mb = meanOf(b);
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da === 0 || db === 0 ? null : r3(num / Math.sqrt(da * db));
}

/** Quadratic-weighted Cohen's kappa for integer ratings in [min, max]. */
export function quadraticWeightedKappa(a: number[], b: number[], min = 0, max = 10): number | null {
  if (a.length < 3) return null;
  const k = max - min + 1;
  const ai = a.map((x) => Math.min(max, Math.max(min, Math.round(x))) - min);
  const bi = b.map((x) => Math.min(max, Math.max(min, Math.round(x))) - min);
  const O = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const ha = new Array<number>(k).fill(0), hb = new Array<number>(k).fill(0);
  for (let i = 0; i < ai.length; i++) { O[ai[i]][bi[i]]++; ha[ai[i]]++; hb[bi[i]]++; }
  const n = ai.length;
  let num = 0, den = 0;
  for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) {
    const w = ((i - j) ** 2) / ((k - 1) ** 2);
    num += w * O[i][j];
    den += w * (ha[i] * hb[j]) / n;
  }
  return den === 0 ? null : r3(1 - num / den);
}

export function agreement(human: number[], ai: number[]): Agreement {
  const n = human.length;
  if (!n) return { n: 0, mean_human: null, mean_ai: null, bias: null, mae: null, within_1: null, pearson: null, qwk: null };
  const diffs = ai.map((x, i) => x - human[i]);
  return {
    n,
    mean_human: r3(meanOf(human)),
    mean_ai: r3(meanOf(ai)),
    bias: r3(meanOf(diffs)),
    mae: r3(meanOf(diffs.map(Math.abs))),
    within_1: r3(diffs.filter((d) => Math.abs(d) <= 1).length / n),
    pearson: pearson(human, ai),
    qwk: quadraticWeightedKappa(human, ai),
  };
}

export function calibrate(humans: HumanRow[], ais: AiRow[]): CalibrationReport {
  const aiById = new Map(ais.map((a) => [a.interview_id, a]));
  const byInterview = new Map<string, HumanRow[]>();
  for (const h of humans) byInterview.set(h.interview_id, [...(byInterview.get(h.interview_id) ?? []), h]);
  const matched = [...byInterview.keys()].filter((id) => aiById.has(id));
  const missing = [...byInterview.keys()].filter((id) => !aiById.has(id));

  const dimensions: DimensionReport[] = DIMENSIONS.map((d) => {
    const hs: number[] = [], as: number[] = [];
    let insufficient = 0;
    const pairA: number[] = [], pairB: number[] = [];
    for (const id of matched) {
      const raters = byInterview.get(id)!.map((r) => r.scores[d]).filter((x): x is number => typeof x === "number");
      if (raters.length >= 2) { pairA.push(raters[0]); pairB.push(raters[1]); }
      if (!raters.length) continue;
      const ai = aiById.get(id)!.scores[d];
      if (ai === "insufficient_data" || ai === undefined) { insufficient++; continue; }
      hs.push(meanOf(raters));
      as.push(ai);
    }
    return { dimension: d, ...agreement(hs, as), ai_insufficient: insufficient, human_baseline: pairA.length ? agreement(pairA, pairB) : null };
  });

  const levels: Readiness[] = ["not_ready", "developing", "ready"];
  const confusion = Object.fromEntries(levels.map((h) => [h, Object.fromEntries(levels.map((a) => [a, 0]))])) as CalibrationReport["readiness"]["confusion"];
  let rn = 0, rexact = 0;
  for (const id of matched) {
    const h = byInterview.get(id)!.find((r) => r.readiness)?.readiness;
    const a = aiById.get(id)!.readiness;
    if (!h || !a) continue;
    confusion[h][a]++;
    rn++;
    if (h === a) rexact++;
  }
  return {
    interviews_matched: matched.length,
    interviews_missing_ai: missing,
    dimensions,
    readiness: { n: rn, exact: rn ? r3(rexact / rn) : null, confusion },
  };
}

// ── CSV ──────────────────────────────────────────────────────────────────────
export function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [], field = "", q = false;
  const s = text.replace(new RegExp("^" + String.fromCharCode(0xfeff)), "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c;
    } else if (c === '"' && field === "") q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field); field = ""; out.push(row); row = [];
    } else field += c;
  }
  if (field || row.length) { row.push(field); out.push(row); }
  return out.filter((r) => r.some((v) => v.trim()));
}

/** Header: interview_id, rater?, <dimension columns…>, readiness_level? — blank cells = not scored. */
export function parseHumanCsv(text: string): { rows: HumanRow[]; errors: string[] } {
  const table = parseCsv(text);
  const errors: string[] = [];
  if (!table.length) return { rows: [], errors: ["empty file"] };
  const header = table[0].map((h) => h.trim().toLowerCase());
  const idCol = header.indexOf("interview_id");
  if (idCol < 0) return { rows: [], errors: ["missing interview_id column"] };
  const raterCol = header.indexOf("rater");
  const readyCol = header.indexOf("readiness_level");
  const dimCols = DIMENSIONS.map((d) => [d, header.indexOf(d)] as const).filter(([, i]) => i >= 0);
  if (!dimCols.length) errors.push("no dimension columns found");
  const rows: HumanRow[] = [];
  table.slice(1).forEach((cells, i) => {
    const line = i + 2;
    const id = cells[idCol]?.trim();
    if (!id) { errors.push(`line ${line}: missing interview_id`); return; }
    const scores: HumanRow["scores"] = {};
    for (const [d, col] of dimCols) {
      const v = cells[col]?.trim();
      if (!v) continue;
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0 || n > 10) { errors.push(`line ${line}: ${d} must be 0–10 (got "${v}")`); continue; }
      scores[d] = n;
    }
    const r = readyCol >= 0 ? cells[readyCol]?.trim().toLowerCase().replace(/\s+/g, "_") : "";
    if (r && !["not_ready", "developing", "ready"].includes(r)) errors.push(`line ${line}: readiness_level must be not_ready, developing or ready`);
    rows.push({
      interview_id: id,
      rater: raterCol >= 0 ? cells[raterCol]?.trim() || "trainer" : "trainer",
      scores,
      readiness: ["not_ready", "developing", "ready"].includes(r) ? (r as Readiness) : undefined,
    });
  });
  return { rows, errors };
}

export function formatReport(r: CalibrationReport): string {
  const f = (n: number | null, pct = false) => (n === null ? "  –  " : pct ? `${Math.round(n * 100)}%`.padStart(5) : n.toFixed(2).padStart(5));
  const lines = [
    `Interviews matched: ${r.interviews_matched}${r.interviews_missing_ai.length ? ` (no AI score for ${r.interviews_missing_ai.length})` : ""}`,
    "",
    "dimension                   n  human    ai  bias   MAE  ±1pt  pearson  QWK   | trainer↔trainer MAE  ±1pt",
  ];
  for (const d of r.dimensions) {
    const b = d.human_baseline;
    lines.push(
      `${d.dimension.padEnd(26)} ${String(d.n).padStart(2)} ${f(d.mean_human)} ${f(d.mean_ai)} ${f(d.bias)} ${f(d.mae)} ${f(d.within_1, true)}   ${f(d.pearson)} ${f(d.qwk)}` +
      `  | ${b ? `${f(b.mae)}  ${f(b.within_1, true)} (n=${b.n})` : "      –"}${d.ai_insufficient ? `   [AI insufficient: ${d.ai_insufficient}]` : ""}`,
    );
  }
  lines.push("", `Readiness exact agreement: ${r.readiness.exact === null ? "–" : `${Math.round(r.readiness.exact * 100)}%`} (n=${r.readiness.n})`);
  lines.push("  human \\ AI     not_ready  developing  ready");
  for (const h of ["not_ready", "developing", "ready"] as Readiness[]) {
    const c = r.readiness.confusion[h];
    lines.push(`  ${h.padEnd(13)} ${String(c.not_ready).padStart(9)} ${String(c.developing).padStart(11)} ${String(c.ready).padStart(6)}`);
  }
  lines.push("", "Guide: QWK ≥ 0.6 and MAE ≤ 1.0 is good agreement for a 0–10 rubric; compare with the trainer↔trainer baseline.");
  return lines.join("\n");
}
