// b2b-assess — question bank (staff) and the test runner (students and candidates) (track A).
// Stubbed in Phase 1. The server owns the clock: every runner response carries deadline_at and
// server_now so a refresh or reconnect resumes with the right remaining time.
import { z } from "./zod.ts";
import { ContextType, Difficulty, Language, Ok, Uuid } from "./common.ts";

export const GeneratedQuestion = z.object({
  title: z.string().min(3).max(200),
  statement: z.string().min(10).max(20000),
  difficulty: Difficulty,
  topics: z.array(z.string()).max(10),
  constraints: z.string().max(2000),
  starter_code: z.record(Language, z.string().max(5000)),
  tests: z.array(z.object({ input: z.string().max(100000), output: z.string().max(100000), sample: z.boolean() })).min(5).max(40),
  reference_solution: z.object({ language: Language, code: z.string().max(20000) }),
  params: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
});
export type GeneratedQuestion = z.infer<typeof GeneratedQuestion>;

export const GeneratedMcq = z.object({
  title: z.string().min(3).max(200),
  statement: z.string().min(10).max(4000),
  difficulty: Difficulty,
  category: z.enum(["aptitude", "cs_fundamentals", "technical"]),
  topics: z.array(z.string()).max(10),
  options: z.array(z.object({ id: z.string().max(4), text: z.string().max(500) })).min(2).max(6),
  answer: z.array(z.string().max(4)).min(1),
  explanation: z.string().max(2000),
});
export type GeneratedMcq = z.infer<typeof GeneratedMcq>;

/** What the runner shows: never answers, hidden tests or reference solutions. */
export const RunnerQuestion = z.object({
  id: Uuid,
  type: z.enum(["coding", "mcq"]),
  title: z.string(),
  statement: z.string(),
  difficulty: Difficulty,
  points: z.number(),
  section: z.string().optional(),       // section title
  constraints: z.string().nullable().optional(),
  languages: z.array(Language).optional(),
  starter_code: z.record(z.string(), z.string()).optional(),
  samples: z.array(z.object({ input: z.string(), output: z.string() })).optional(),
  options: z.array(z.object({ id: z.string(), text: z.string() })).optional(),   // shuffled per subject
  multi_select: z.boolean().optional(),
  saved: z.object({ language: z.string().nullable(), code: z.string().nullable(), mcq_choice: z.array(z.string()).nullable(), seq: z.number() }).nullable(),
});

export type RunnerQuestion = z.infer<typeof RunnerQuestion>;

export const AttemptState = z.object({
  attemptId: Uuid,
  status: z.enum(["not_started", "in_progress", "submitted", "expired", "terminated"]),
  deadline_at: z.string().nullable(),
  server_now: z.string(),
  paused: z.boolean(),
  sessionId: Uuid,                      // this tab's single-session token
  title: z.string().optional(),
  watermark: z.string().optional(),     // subject email/id, drawn faintly over the runner
  questions: z.array(RunnerQuestion),   // empty once the attempt has ended
  /** Only when the subject may see results (practice; drives once released). */
  result: z.object({ score: z.number().nullable(), max_score: z.number().nullable(), grading: z.enum(["pending", "complete"]),
                     section_scores: z.array(z.object({ title: z.string(), type: z.string(), score: z.number(), max_score: z.number() })) }).nullable().optional(),
  proctoring: z.object({ policy: z.string(), sessionId: Uuid.nullable() }),
});
export type AttemptState = z.infer<typeof AttemptState>;

export const JudgeResult = z.object({
  submissionId: Uuid,
  status: z.enum(["queued", "running", "done", "error"]),
  compile_output: z.string().nullable().optional(),
  tests: z.array(z.object({ sample: z.boolean(), passed: z.boolean(), time_ms: z.number().nullable(), status: z.string(),
                            stdout: z.string().optional(), expected: z.string().optional() })),   // stdout/expected for samples only
  passed: z.number(), total: z.number(),
  /** The run with the subject's own input (run action only). */
  custom: z.object({ stdout: z.string(), stderr: z.string(), status: z.string(), time_ms: z.number().nullable() }).optional(),
});

export type JudgeResult = z.infer<typeof JudgeResult>;

export const assessContract = {
  // ── Bank (staff) ──
  generateQuestions: {
    input: z.object({ orgId: Uuid.nullable(), type: z.enum(["coding", "mcq"]), topic: z.string().min(2).max(80),
                      difficulty: Difficulty, role: z.string().max(80).optional(), count: z.number().int().min(1).max(10) }),
    output: z.object({ created: z.array(z.object({ questionId: Uuid, status: z.enum(["verified", "draft"]), reason: z.string().optional() })) }),
  },
  verifyQuestion: {
    input: z.object({ questionId: Uuid }),
    output: z.object({ status: z.enum(["verified", "draft"]), failures: z.array(z.object({ testId: Uuid, status: z.string() })) }),
  },
  // ── Runner (subject) ──
  start: {
    // practice: assessmentId (contextId null); drive / job_role: contextId. sessionId: this tab's token, if it has one.
    input: z.object({ context: ContextType, contextId: Uuid.nullable(), assessmentId: Uuid.optional(), sessionId: Uuid.optional() }),
    output: AttemptState,
  },
  state: { input: z.object({ attemptId: Uuid, sessionId: Uuid.optional() }), output: AttemptState },
  autosave: {
    input: z.object({ attemptId: Uuid, sessionId: Uuid, questionId: Uuid, seq: z.number().int().min(0),
                      language: Language.optional(), code: z.string().max(100000).optional(), mcq_choice: z.array(z.string()).optional(),
                      edits: z.array(z.object({ t: z.number(), op: z.string(), at: z.number().optional(), text: z.string().max(20000).optional(), len: z.number().optional() })).max(2000).optional() }),
    output: z.object({ ok: z.literal(true), seq: z.number(), deadline_at: z.string(), server_now: z.string() }),
  },
  run: {
    input: z.object({ attemptId: Uuid, sessionId: Uuid, questionId: Uuid, language: Language, code: z.string().max(100000),
                      customInput: z.string().max(100000).optional() }),
    output: JudgeResult,
  },
  submitQuestion: {
    input: z.object({ attemptId: Uuid, sessionId: Uuid, questionId: Uuid, language: Language.optional(),
                      code: z.string().max(100000).optional(), mcq_choice: z.array(z.string()).optional() }),
    output: z.object({ submissionId: Uuid, status: z.enum(["queued", "done"]) }),   // no score shown here
  },
  // reason "violations": the strict proctoring policy hit its limit (ProctoredSession onAutoSubmit).
  finish: { input: z.object({ attemptId: Uuid, sessionId: Uuid, reason: z.enum(["submitted", "violations"]).optional() }), output: Ok },
  heartbeat: {
    input: z.object({ attemptId: Uuid, sessionId: Uuid }),
    output: z.object({ ok: z.boolean(), deadline_at: z.string().nullable(), server_now: z.string(), paused: z.boolean(),
                       status: z.string(), reason: z.enum(["OTHER_SESSION", "ENDED"]).optional() }),
  },
} as const;
