// ─── AI-assisted answer signals (signals, never verdicts) ────────────────────
// Pure TS. From the browser's speech timings for each answer: a long pause followed by a fluent, read-out
// answer, and a flat reading cadence (steady speaking rate with almost no pauses, across several long answers).
// They are shown to reviewers next to the answer as "worth a look", never used in the score.

export interface AnswerTiming {
  turn: number;
  words: number;
  response_latency_ms: number | null;   // question finished → candidate started speaking
  speech_ms: number | null;             // first → last recognised speech
  max_pause_ms: number | null;          // longest silence inside the answer
}

export type SignalType = "long_pause_then_fluent" | "flat_cadence";
export interface AnswerSignalNote { type: SignalType; turn: number; detail: string }

export const LONG_PAUSE_MS = 8000;
export const FLUENT_MAX_PAUSE_MS = 1200;
export const FLUENT_MIN_WORDS = 40;
export const FLAT_MIN_ANSWERS = 4;
export const FLAT_MAX_CV = 0.08;

export function wordsPerMinute(t: AnswerTiming): number | null {
  if (!t.speech_ms || t.speech_ms < 3000 || t.words < 5) return null;
  return Math.round((t.words / t.speech_ms) * 60_000);
}

/** Signals for one answer on its own. */
export function turnSignals(t: AnswerTiming): AnswerSignalNote[] {
  const out: AnswerSignalNote[] = [];
  const wpm = wordsPerMinute(t);
  if ((t.response_latency_ms ?? 0) >= LONG_PAUSE_MS && t.words >= FLUENT_MIN_WORDS && t.max_pause_ms !== null
      && t.max_pause_ms <= FLUENT_MAX_PAUSE_MS && wpm !== null && wpm >= 110) {
    out.push({
      type: "long_pause_then_fluent", turn: t.turn,
      detail: `${Math.round((t.response_latency_ms ?? 0) / 1000)} s before answering, then ${t.words} words at ${wpm} wpm with no pause over ${(t.max_pause_ms / 1000).toFixed(1)} s`,
    });
  }
  return out;
}

/** Across the interview: long answers spoken at a near-constant rate with almost no pauses. */
export function cadenceSignal(all: AnswerTiming[]): AnswerSignalNote | null {
  const long = all.filter((t) => t.words >= 30 && t.max_pause_ms !== null && t.max_pause_ms < 900);
  const rates = long.map(wordsPerMinute).filter((r): r is number => r !== null);
  if (rates.length < FLAT_MIN_ANSWERS) return null;
  const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
  const sd = Math.sqrt(rates.reduce((a, r) => a + (r - mean) ** 2, 0) / rates.length);
  const cv = sd / mean;
  if (cv > FLAT_MAX_CV) return null;
  return { type: "flat_cadence", turn: long[long.length - 1].turn, detail: `${rates.length} long answers at ${Math.round(mean)} wpm ± ${Math.round(sd)} with almost no pauses` };
}

export function answerSignals(all: AnswerTiming[]): AnswerSignalNote[] {
  const out = all.flatMap(turnSignals);
  const c = cadenceSignal(all);
  if (c) out.push(c);
  return out;
}
