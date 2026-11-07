// b2b-proctor — proctoring V1 (track B). Stubbed in Phase 1.
// Flags are evidence for human review; nobody is failed on AI flags alone.
import { z } from "./zod.ts";
import { ConsentPurpose, IntegrityBand, Ok, ProctoringPolicy, Uuid } from "./common.ts";

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
  // evidence: periodic screen / webcam snapshot (info, never scored)
  "snapshot",
]);
export type EventType = z.infer<typeof EventType>;

export const Severity = z.enum(["info", "low", "medium", "high"]);
export const ReviewDecision = z.enum(["no_concern", "minor_concern", "serious_concern"]);

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

/** What is proctored: exactly one of attemptId / interviewId. */
const Target = z.object({ attemptId: Uuid.optional(), interviewId: Uuid.optional() })
  .refine((t) => !!t.attemptId !== !!t.interviewId, { message: "Pass exactly one of attemptId / interviewId" });

/** One accepted consent item: the exact text shown, per purpose. */
export const ConsentItem = z.object({ purpose: ConsentPurpose, version: z.string().min(1).max(40), text: z.string().min(10).max(4000) });

export const proctorContract = {
  /** Before the system check: the effective policy and what the consent screen must say (org, retention). */
  preflight: {
    input: Target,
    output: z.object({ policy: ProctoringPolicy, orgName: z.string(), retentionDays: z.number().int(), contactEmail: z.string().nullable(),
                       strictMaxViolations: z.number().int(), snapshotIntervalS: z.number() }),
  },
  start: {
    input: z.object({ attemptId: Uuid.optional(), interviewId: Uuid.optional(), systemCheck: SystemCheck,
                      kind: z.enum(["assessment", "interview"]).default("assessment"),
                      consents: z.array(ConsentItem).max(8).default([]) }),
    output: z.object({ sessionId: Uuid, policy: ProctoringPolicy, snapshotIntervalS: z.number(), uploadPrefix: z.string(),
                       strictMaxViolations: z.number().int(), status: z.enum(["active", "paused"]), resumed: z.boolean(),
                       checks: z.object({ faces: z.boolean(), headPose: z.boolean(), vad: z.boolean() }) }),
  },
  events: {
    input: z.object({ sessionId: Uuid, events: z.array(ProctorEvent).min(1).max(200) }),
    /** pause / auto-submit instructions come back here for strict / maximum policies */
    output: z.object({ accepted: z.number(), violations: z.number(),
                       action: z.enum(["none", "warn", "final_warning", "pause", "resume", "submit"]),
                       /** Strict policy: violations allowed before auto-submit (R2.6 ladder). */
                       maxViolations: z.number().optional() }),
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
                          score_detail: z.unknown().nullable(), started_at: z.string(), ended_at: z.string().nullable(),
                          status: z.string(), violations: z.number(), context_type: z.string(),
                          subject_name: z.string().nullable(), system_check: z.unknown().nullable(),
                          /** true when the session never ended cleanly and the score was computed now, from the events so far */
                          provisional: z.boolean() }),
      events: z.array(z.object({ id: z.number(), type: z.string(), severity: Severity, confidence: z.number(), started_at: z.string(),
                                 ended_at: z.string().nullable(), evidenceUrl: z.string().url().nullable(), review_status: z.string(),
                                 review_note: z.string().nullable(), meta: z.record(z.string(), z.unknown()).nullable() })),
      reviews: z.array(z.object({ id: Uuid, decision: ReviewDecision, note: z.string().nullable(), reviewer_name: z.string().nullable(),
                                  created_at: z.string() })),
    }),
  },
  reviewEvent: {
    input: z.object({ eventId: z.number().int(), status: z.enum(["confirmed", "dismissed"]), note: z.string().max(2000).optional() }),
    output: Ok,
  },
  /** The final human decision, stored separately from the AI integrity score. */
  decide: {
    input: z.object({ sessionId: Uuid, decision: ReviewDecision, note: z.string().max(4000).optional() }),
    output: Ok,
  },
} as const;
