// ─── Evidence quotes: verify verbatim against the transcript ─────────────────
// Pure TS. Every quote the evaluator returns must occur in the candidate's own answers (after normalising
// whitespace, case and punctuation). The timestamp comes from the turn where the quote really is, never from the
// model. Quotes that can't be found are dropped and counted; a score left without any verified quote is
// withdrawn by the caller ("not enough evidence").

export interface AnswerTurn { turn: number; text: string; offsetS: number }
export interface QuoteIn { quote: string; turn?: number | null }
export interface VerifiedQuote { quote: string; turn: number; offsetS: number; at: string; relocated: boolean }

export function normalizeQuote(s: string): string {
  return (s ?? "").toLowerCase().replace(/[‘’`´]/g, "'").replace(/[^\p{L}\p{N}' ]+/gu, " ").replace(/\s+/g, " ").trim();
}

export function mmss(totalS: number): string {
  const s = Math.max(0, Math.round(totalS));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** Minimum words for a quote to count as evidence (shorter fragments match almost anything). */
export const MIN_QUOTE_WORDS = 3;

/**
 * Find the turn a quote comes from. "…"-separated parts must all occur, in the same turn. The model's turn number
 * is preferred when it matches; otherwise the first matching turn is used (marked relocated).
 */
export function verifyQuote(q: QuoteIn, answers: AnswerTurn[]): VerifiedQuote | null {
  const parts = (q.quote ?? "").split(/\.\.\.|…/).map(normalizeQuote).filter(Boolean);
  if (!parts.length) return null;
  if (parts.reduce((a, p) => a + p.split(" ").length, 0) < MIN_QUOTE_WORDS) return null;
  if (parts.some((p) => p.split(" ").length < 2)) return null;
  const has = (a: AnswerTurn) => {
    const n = normalizeQuote(a.text);
    return parts.every((p) => ` ${n} `.includes(` ${p} `));
  };
  const claimed = answers.find((a) => a.turn === q.turn);
  const hit = claimed && has(claimed) ? claimed : answers.find(has);
  if (!hit) return null;
  return { quote: q.quote.trim().slice(0, 300), turn: hit.turn, offsetS: hit.offsetS, at: mmss(hit.offsetS), relocated: hit !== claimed };
}

export function verifyQuotes(quotes: QuoteIn[], answers: AnswerTurn[]): { kept: VerifiedQuote[]; dropped: string[] } {
  const kept: VerifiedQuote[] = [];
  const dropped: string[] = [];
  const seen = new Set<string>();
  for (const q of quotes) {
    const v = verifyQuote(q, answers);
    if (!v) { dropped.push((q.quote ?? "").slice(0, 300)); continue; }
    const key = normalizeQuote(v.quote);
    if (!seen.has(key)) { seen.add(key); kept.push(v); }
  }
  return { kept, dropped };
}
