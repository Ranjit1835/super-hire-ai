// Interview V1 (track C), served by b2b-interview next to the pilot's untyped actions
// (current / start / resume / answer / end, unchanged). V1 covers drive and job-role interviews: adaptive sections,
// code walkthrough, injection defence, blind evaluation. Voice only (owner decision 2026-09-29): there is no typed
// answer mode; when voice fails the room re-checks audio and resumes from the server's state.
import { z } from "./zod.ts";
import { ProctoringPolicy, Recommendation, Uuid } from "./common.ts";

export const InterviewSection = z.enum(["intro", "technical", "problem_solving", "behavioral", "code_walkthrough", "candidate_questions"]);
export type InterviewSection = z.infer<typeof InterviewSection>;

export const InterviewStatus = z.enum(["in_progress", "completed", "abandoned", "cancelled"]);

/** Timings from the browser's speech pipeline (whitelisted and clamped again on the server). */
export const AnswerMetaInput = z.object({
  input_mode: z.literal("voice").optional(),
  stt_lang: z.string().max(10).optional(),
  question_tts_ms: z.number().min(0).max(3_600_000).nullable().optional(),
  response_latency_ms: z.number().min(0).max(3_600_000).nullable().optional(),
  speech_ms: z.number().min(0).max(3_600_000).nullable().optional(),
  max_pause_ms: z.number().min(0).max(3_600_000).nullable().optional(),
  restarts: z.number().int().min(0).max(1000).optional(),
  ended_by: z.enum(["silence", "button", "max_duration"]).optional(),
  avg_confidence: z.number().min(0).max(1).nullable().optional(),
});

/** Previous turn's latency: candidate stopped speaking → interviewer audio started (src/lib/turn-latency.ts). */
export const ClientLatency = z.object({
  turn_end_to_first_audio_ms: z.number().min(0).max(300_000),
  silence_wait_ms: z.number().min(0).max(300_000).nullable(),
  request_ms: z.number().min(0).max(300_000).nullable(),
  audio_start_ms: z.number().min(0).max(300_000).nullable(),
});

export const TranscriptLine = z.object({
  turn: z.number().int(),
  role: z.enum(["interviewer", "candidate"]),
  text: z.string(),
  offsetS: z.number(),          // seconds since the interview started
  at: z.string(),               // "mm:ss"
});

export const RoomState = z.object({
  interviewId: Uuid,
  context: z.enum(["drive", "job_role"]),
  contextId: Uuid,
  title: z.string(),
  status: InterviewStatus,
  endReason: z.string().nullable(),
  policy: ProctoringPolicy,
  startedAt: z.string(),
  deadlineAt: z.string(),
  serverNow: z.string(),
  durationMin: z.number(),
  sections: z.array(z.object({ key: InterviewSection, label: z.string(), minutes: z.number() })),
  section: InterviewSection.nullable(),
  turnCount: z.number().int(),
  /** Question awaiting an answer (null when finished). */
  question: z.string().nullable(),
  closing: z.string().nullable(),
  transcript: z.array(TranscriptLine),
  codeWalkthrough: z.boolean(),
  resultsVisible: z.boolean(),
  /** Only when the organisation has made results visible to the candidate. AI recommendation; people decide. */
  result: z.object({
    recommendation: Recommendation.nullable(),
    overall: z.number().nullable(),
    dimensions: z.array(z.object({ label: z.string(), score: z.number().nullable() })),
  }).nullable(),
  duplicate: z.boolean().optional(),
  /** Phase 3 voice: which side the server handles; "browser" = the browser's own speech (fallback). */
  voice: z.object({ stt: z.enum(["groq", "sarvam", "browser"]), tts: z.enum(["google", "sarvam", "browser"]) }).optional(),
  /** The interviewer's next line already voiced (turn with speak: true), so the room needn't ask again. */
  speech: z.object({ text: z.string(), audio: z.string(), mime: z.string() }).optional(),
});
export type RoomState = z.infer<typeof RoomState>;

export const AudioIssueKind = z.enum([
  "tts_blocked", "tts_error", "no_voices", "tts_unsupported", "mic_denied", "mic_missing", "mic_busy", "stt_unsupported",
  "stt_error", "no_speech", "recheck_passed", "resumed",
]);

export const interviewContract = {
  /** Start (or resume) the interview step of a drive or job role, optionally walking through a coding attempt. */
  startContext: {
    input: z.object({ kind: z.enum(["drive", "job_role"]), contextId: Uuid, attemptId: Uuid.optional() }),
    output: z.object({ interviewId: Uuid, resumed: z.boolean() }),
  },
  /** The room's view of the caller's own interview (closes it first if its time ran out). */
  room: {
    input: z.object({ interviewId: Uuid }),
    output: RoomState,
  },
  /** One spoken answer. Idempotent per clientTurnId; turnCount must match the server (else 409 TURN_CONFLICT). */
  turn: {
    input: z.object({
      interviewId: Uuid, clientTurnId: Uuid, turnCount: z.number().int().min(0),
      answer: z.string().trim().min(1).max(4500), meta: AnswerMetaInput.default({}), clientLatency: ClientLatency.nullable().optional(),
      /** Also voice the next line on the server (cloud TTS) and return it in `speech`. */
      speak: z.boolean().optional(),
    }),
    output: RoomState,
  },
  /** Phase 3: one recorded answer (base64), transcribed on the server. Only the interview's own candidate, while live. */
  transcribe: {
    input: z.object({ interviewId: Uuid, audio: z.string().min(100).max(6_000_000), mime: z.string().min(5).max(80),
                      durationMs: z.number().min(0).max(200_000) }),
    output: z.object({ text: z.string() }),
  },
  /** Phase 3: voice one of this interview's own interviewer lines (the server refuses any other text). */
  speak: {
    input: z.object({ interviewId: Uuid, text: z.string().min(1).max(2500) }),
    output: z.object({ audio: z.string(), mime: z.string() }),
  },
  /** The candidate ends the interview early. With no answers yet it is cancelled and can be started again. */
  finish: {
    input: z.object({ interviewId: Uuid }),
    output: RoomState,
  },
  /** Voice problems and their recovery (logged for staff; the interview state stays on the server). */
  audioIssue: {
    input: z.object({ interviewId: Uuid, kind: AudioIssueKind, detail: z.string().max(200).optional() }),
    output: z.object({ ok: z.literal(true) }),
  },
  /** Latency summary the room measured (p50 / p95 of speech end → interviewer audio). */
  latency: {
    input: z.object({ interviewId: Uuid, samples: z.array(z.number().min(0).max(300_000)).max(100) }),
    output: z.object({ ok: z.literal(true), p50: z.number().nullable(), p95: z.number().nullable() }),
  },
  /**
   * Gemini Live spike: a short-lived token for a direct browser↔Gemini session (time-boxed experiment).
   * With interviewId: the caller's own live interview. Without: staff / super admin (the dev spike page).
   */
  liveToken: {
    input: z.object({ interviewId: Uuid.optional() }),
    output: z.object({ token: z.string(), expiresAt: z.string(), model: z.string() }),
  },
} as const;
