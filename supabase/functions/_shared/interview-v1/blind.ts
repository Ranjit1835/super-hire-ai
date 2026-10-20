// ─── Blind scoring: strip name, college and gender cues ──────────────────────
// Pure TS. Applied to every line of the transcript before the evaluator sees it. Names and institution names
// come from the database (student / candidate / membership / organisation); gendered words are neutralised by
// a fixed list. Removing cues can't make an evaluation fair on its own, but it keeps the obvious ones out.

export interface BlindContext {
  /** Full names (any order); every part of 3+ letters is removed as a whole word. */
  names?: (string | null | undefined)[];
  /** College / company / institution names; removed as phrases (and their acronyms when given). */
  institutions?: (string | null | undefined)[];
}

const GENDER: [RegExp, string][] = [
  [/\b(he|she)\b/gi, "they"],
  [/\b(him|her)\b/gi, "them"],
  [/\b(his|hers)\b/gi, "their"],
  [/\b(himself|herself)\b/gi, "themself"],
  [/\b(mr|mrs|ms|miss|mister|madam|ma'am|sir)\b\.?/gi, ""],
  [/\b(boy|girl|man|woman|gentleman|lady)\b/gi, "person"],
  [/\b(boys|girls|men|women|ladies|gentlemen)\b/gi, "people"],
  [/\b(male|female)\b/gi, ""],
  [/\b(son|daughter)\b/gi, "child"],
  [/\b(brother|sister)\b/gi, "sibling"],
  [/\b(husband|wife)\b/gi, "spouse"],
];

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function blindScrub(text: string, ctx: BlindContext = {}): string {
  let out = text ?? "";
  for (const inst of ctx.institutions ?? []) {
    const n = (inst ?? "").trim();
    if (n.length < 3) continue;
    out = out.replace(new RegExp(`\\b${esc(n).replace(/\s+/g, "\\s+")}\\b`, "gi"), "[institution]");
    // Common short forms: "SVR Engineering College" → "SVR" when it is an uppercase acronym-like first word.
    const first = n.split(/\s+/)[0];
    if (/^[A-Z]{2,6}$/.test(first)) out = out.replace(new RegExp(`\\b${esc(first)}\\b`, "g"), "[institution]");
  }
  const parts = new Set<string>();
  for (const name of ctx.names ?? []) {
    for (const p of (name ?? "").split(/[\s.,]+/)) if (p.length >= 3) parts.add(p);
  }
  for (const p of parts) out = out.replace(new RegExp(`\\b${esc(p)}\\b`, "gi"), "[candidate]");
  for (const [re, rep] of GENDER) {
    out = out.replace(re, (m) => (rep && m[0] === m[0].toUpperCase() ? rep[0].toUpperCase() + rep.slice(1) : rep));
  }
  return out.replace(/\[candidate\](\s+\[candidate\])+/g, "[candidate]").replace(/[ \t]{2,}/g, " ").trim();
}
