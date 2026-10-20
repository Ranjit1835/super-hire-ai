// b2b-proctor — proctoring V1 (track B). Stubbed in Phase 1.
// Flags are evidence for human review; nobody is failed on AI flags alone.
import { z } from "./zod.ts";
import { IntegrityBand, Ok, ProctoringPolicy, Uuid } from "./common.ts";

export const EventType = z.enum([
  // browser
  "tab_hidden", "window_blur", "fullscreen_exit", "screen_share_stopped", "extra_display", "copy_attempt", "paste_attempt",
  "cut_attempt", "right_click", "devtools_suspected", "page_reload", "second_session",
  // camera
  "no_face", "multiple_faces", "looking_away", "camera_off", "camera_frozen", "virtual_camera_suspected",
  // audio
  "speech_detected",
  // runner / interview
  "large_paste", "typing_burst", "prompt_injection",
  // lifecycle
  "session_paused", "session_resumed", "auto_submitted",
]);
export type EventType = z.infer<typeof EventType>;

export const Severity = z.enum(["info", "low", "medium", "high"]);

export const SystemCheck = z.object({
  browser: z.string().max(40), version: z.number().int(), chromium: z.boolean(), mobile: z.boolean(),
  camera: z.boolean(), mic: z.boolean(), speakers: z.boolean().optional(),
  screen: z.enum(["monitor", "window", "browser", "none"]), displays: z.number().int().min(0).max(8),
  bandwidth_kbps: z.number().nullable(), cores: z.number().int().nullable(), memory_gb: z.number().nullable(),
  tier: z.enum(["full", "lite", "minimal"]),
});

export const ProctorEvent = z.object({
  clientEventId: Uuid,
  type: EventType,
  severity: Severity,
  confidence: z.number().min(0).max(1).default(1),
  startedAt: z.string().datetime({ offset: true }),
  endedAt: z.string().datetime({ offset: true }).optional(),
  evidencePath: z.string().max(300).optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
});

export const proctorContract = {
  start: {
    input: z.object({ attemptId: Uuid.optional(), interviewId: Uuid.optional(), systemCheck: SystemCheck }),
    output: z.object({ sessionId: Uuid, policy: ProctoringPolicy, snapshotIntervalS: z.number(), uploadPrefix: z.string(),
                       checks: z.object({ faces: z.boolean(), headPose: z.boolean(), vad: z.boolean() }) }),
  },
  events: {
    input: z.object({ sessionId: Uuid, events: z.array(ProctorEvent).min(1).max(200) }),
    /** pause / auto-submit instructions come back here for strict / maximum policies */
    output: z.object({ accepted: z.number(), violations: z.number(), action: z.enum(["none", "warn", "pause", "resume", "submit"]) }),
  },
  snapshotUploadUrl: {
    input: z.object({ sessionId: Uuid, kind: z.enum(["screen", "camera"]), contentType: z.enum(["image/jpeg", "image/webp"]) }),
    output: z.object({ path: z.string(), signedUrl: z.string().url(), token: z.string() }),
  },
  end: { input: z.object({ sessionId: Uuid }), output: z.object({ integrityScore: z.number(), band: IntegrityBand }) },
  // ── Review (staff) ──
  timeline: {
    input: z.object({ sessionId: Uuid }),
    output: z.object({
      session: z.object({ id: Uuid, policy: ProctoringPolicy, integrity_score: z.number().nullable(), integrity_band: IntegrityBand.nullable(),
                          score_detail: z.unknown().nullable(), started_at: z.string(), ended_at: z.string().nullable() }),
      events: z.array(z.object({ id: z.number(), type: z.string(), severity: Severity, confidence: z.number(), started_at: z.string(),
                                 ended_at: z.string().nullable(), evidenceUrl: z.string().url().nullable(), review_status: z.string(),
                                 review_note: z.string().nullable() })),
    }),
  },
  reviewEvent: {
    input: z.object({ eventId: z.number().int(), status: z.enum(["confirmed", "dismissed"]), note: z.string().max(2000).optional() }),
    output: Ok,
  },
} as const;
