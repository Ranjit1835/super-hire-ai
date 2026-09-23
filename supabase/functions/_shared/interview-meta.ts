// ─── Client-reported interview metadata (sanitised) ───────────────────────────
// Pure TS. Timings come from the browser's speech pipeline (Web Speech API): they are
// used as *inputs* to the Step 6 audio metrics, so they are whitelisted and clamped here.
// Anything derivable from the transcript (word counts) is computed server-side instead.

const MAX_MS = 60 * 60 * 1000;

function num(v: unknown, max = MAX_MS): number | null {
  const n = typeof v === "number" ? v : Number.NaN;
  return Number.isFinite(n) && n >= 0 ? Math.min(Math.round(n), max) : null;
}
function pick<T extends string>(v: unknown, allowed: readonly T[]): T | null {
  return allowed.includes(v as T) ? (v as T) : null;
}
function short(v: unknown, max = 60): string | null {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
}

export const INPUT_MODES = ["voice", "text"] as const;
export const ENDED_BY = ["silence", "button", "max_duration", "typed"] as const;

export function countWords(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

export interface AnswerMeta {
  input_mode: (typeof INPUT_MODES)[number] | null;
  stt_lang: string | null;
  question_tts_ms: number | null;      // how long the question took to speak
  response_latency_ms: number | null;  // question finished → student started speaking
  speech_ms: number | null;            // first → last recognised speech
  max_pause_ms: number | null;         // longest silence inside the answer
  restarts: number | null;             // recogniser restarts (Chrome ends sessions on its own)
  ended_by: (typeof ENDED_BY)[number] | null;
  avg_confidence: number | null;       // 0–1 from the recogniser, when provided
  words: number;                       // server-computed
  chars: number;                       // server-computed
}

export function sanitizeAnswerMeta(raw: unknown, answer: string): AnswerMeta {
  const m = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const conf = typeof m.avg_confidence === "number" && m.avg_confidence >= 0 && m.avg_confidence <= 1
    ? Math.round(m.avg_confidence * 1000) / 1000 : null;
  return {
    input_mode: pick(m.input_mode, INPUT_MODES),
    stt_lang: short(m.stt_lang, 10),
    question_tts_ms: num(m.question_tts_ms),
    response_latency_ms: num(m.response_latency_ms),
    speech_ms: num(m.speech_ms),
    max_pause_ms: num(m.max_pause_ms),
    restarts: num(m.restarts, 100),
    ended_by: pick(m.ended_by, ENDED_BY),
    avg_confidence: conf,
    words: countWords(answer),
    chars: answer.length,
  };
}

export function sanitizeClientMeta(raw: unknown): Record<string, unknown> {
  const m = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    browser: short(m.browser, 40),
    platform: short(m.platform, 40),
    input_mode: pick(m.input_mode, INPUT_MODES),
    stt_lang: short(m.stt_lang, 10),
    stt_supported: m.stt_supported === true,
  };
}
