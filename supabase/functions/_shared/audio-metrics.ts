// ─── Audio metrics from voice timings ─────────────────────────────────────────
// Pure TS. Inputs are the per-answer timings measured in the browser (Step 5,
// _shared/interview-meta.ts) plus the transcript. No audio is recorded or stored.
//
// Caveat surfaced to the evaluator and in reports: Chrome's speech recogniser usually
// drops "um" / "uh" and often normalises other disfluencies, so filler counts are a
// lower bound and are marked low-reliability.

export type Difficulty = "beginner" | "intermediate" | "advanced";

export interface StudentTurnInput {
  content: string;
  difficulty: Difficulty | null;
  meta: {
    input_mode?: "voice" | "text" | null;
    response_latency_ms?: number | null;
    speech_ms?: number | null;
    max_pause_ms?: number | null;
  } | null;
}

export const FILLERS = ["um", "uh", "like", "basically", "actually", "you know"] as const;
export type Filler = (typeof FILLERS)[number];

export interface AudioMetrics {
  voice_answers: number;
  text_answers: number;
  words_total: number;
  /** Words per minute over recognised speech time (voice answers only). */
  words_per_minute: number | null;
  filler_counts: Record<Filler, number>;
  fillers_total: number;
  fillers_per_100_words: number | null;
  filler_reliability: "low";
  /** Pause between the question ending and the student starting to speak. */
  avg_pause_before_answer_ms: number | null;
  max_pause_before_answer_ms: number | null;
  /** Longest silence inside any single answer. */
  max_pause_within_answer_ms: number | null;
  avg_answer_words: number | null;
  avg_answer_words_by_difficulty: Record<Difficulty, number | null>;
  /** Why metrics are partly or fully unavailable, if they are. */
  notes: string[];
}

const LIKE_AS_VERB_AFTER = new Set([
  "i", "we", "you", "they", "he", "she", "would", "i'd", "we'd", "don't", "didn't", "do", "really", "also", "not", "to", "people", "students",
]);

function words(text: string): string[] {
  return text.toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, " ").split(/\s+/).filter(Boolean);
}

/** Counts fillers as whole words; "you know" as a two-word phrase. */
export function countFillers(text: string): Record<Filler, number> {
  const w = words(text);
  const counts = Object.fromEntries(FILLERS.map((f) => [f, 0])) as Record<Filler, number>;
  for (let i = 0; i < w.length; i++) {
    const t = w[i];
    if (t === "um" || t === "umm" || t === "ummm" || t === "hmm") counts.um++;
    else if (t === "uh" || t === "uhh" || t === "er" || t === "erm") counts.uh++;
    // "I like Java" / "would like to" are verbs, not fillers.
    else if (t === "like" && !LIKE_AS_VERB_AFTER.has(w[i - 1] ?? "")) counts.like++;
    else if (t === "basically") counts.basically++;
    else if (t === "actually") counts.actually++;
    else if (t === "you" && w[i + 1] === "know") { counts["you know"]++; i++; }
  }
  return counts;
}

const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
const round1 = (n: number) => Math.round(n * 10) / 10;

export function computeAudioMetrics(turns: StudentTurnInput[]): AudioMetrics {
  const notes: string[] = [];
  const voice = turns.filter((t) => t.meta?.input_mode !== "text");
  const text = turns.length - voice.length;

  const allWords = turns.flatMap((t) => words(t.content));
  const fillerCounts = Object.fromEntries(FILLERS.map((f) => [f, 0])) as Record<Filler, number>;
  for (const t of turns) {
    const c = countFillers(t.content);
    for (const f of FILLERS) fillerCounts[f] += c[f];
  }
  const fillersTotal = FILLERS.reduce((a, f) => a + fillerCounts[f], 0);

  // WPM only over voice answers with a usable speech duration (≥ 1.5 s and ≥ 3 words).
  const timed = voice.filter((t) => (t.meta?.speech_ms ?? 0) >= 1500 && words(t.content).length >= 3);
  const timedWords = timed.reduce((a, t) => a + words(t.content).length, 0);
  const timedMs = timed.reduce((a, t) => a + (t.meta!.speech_ms as number), 0);
  const wpm = timedMs > 0 ? Math.round(timedWords / (timedMs / 60000)) : null;
  if (wpm !== null && (wpm < 40 || wpm > 260)) notes.push("Speaking rate is outside the normal range; recognition timing may be unreliable for this interview.");

  const latencies = voice.map((t) => t.meta?.response_latency_ms).filter((n): n is number => typeof n === "number");
  const inner = voice.map((t) => t.meta?.max_pause_ms).filter((n): n is number => typeof n === "number");

  const byDiff: Record<Difficulty, number[]> = { beginner: [], intermediate: [], advanced: [] };
  for (const t of turns) if (t.difficulty && byDiff[t.difficulty]) byDiff[t.difficulty].push(words(t.content).length);

  if (turns.length === 0) notes.push("No answers were recorded.");
  if (text > 0 && voice.length === 0) notes.push("All answers were typed, so speaking-rate and pause metrics are unavailable.");
  else if (text > 0) notes.push(`${text} answer(s) were typed and are excluded from timing metrics.`);
  if (voice.length > 0 && timed.length === 0) notes.push("Speech timings were not captured for voice answers.");
  notes.push("Speech recognition usually drops 'um' and 'uh', so filler counts are a lower bound.");

  return {
    voice_answers: voice.length,
    text_answers: text,
    words_total: allWords.length,
    words_per_minute: wpm,
    filler_counts: fillerCounts,
    fillers_total: fillersTotal,
    fillers_per_100_words: allWords.length ? round1((fillersTotal / allWords.length) * 100) : null,
    filler_reliability: "low",
    avg_pause_before_answer_ms: avg(latencies),
    max_pause_before_answer_ms: latencies.length ? Math.max(...latencies) : null,
    max_pause_within_answer_ms: inner.length ? Math.max(...inner) : null,
    avg_answer_words: avg(turns.map((t) => words(t.content).length)),
    avg_answer_words_by_difficulty: {
      beginner: avg(byDiff.beginner),
      intermediate: avg(byDiff.intermediate),
      advanced: avg(byDiff.advanced),
    },
    notes,
  };
}
