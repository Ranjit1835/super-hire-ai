// b2b-company — company admin, recruiter, hiring manager (track E).
// b2b-candidate — the candidate's token flow (no password account) and public share links (track E).
// Roles, hiring-manager assignment and comments are written directly through RLS (job_roles,
// role_candidate_comments); everything that needs tokens, credits, AI or aggregation goes through these actions.
import { z } from "./zod.ts";
import { ConsentPurpose, Email, IntegrityBand, NonEmpty, Ok, Page, Recommendation, Uuid } from "./common.ts";

export const SkillsMatrix = z.object({
  must_have: z.array(z.object({ skill: NonEmpty(80), weight: z.number().min(1).max(5) })).min(1).max(15),
  nice_to_have: z.array(z.object({ skill: NonEmpty(80), weight: z.number().min(1).max(5) })).max(15),
  seniority: z.enum(["intern", "junior", "mid", "senior", "lead"]),
  summary: z.string().max(600).optional(),
});
export type SkillsMatrix = z.infer<typeof SkillsMatrix>;

/** Stored in job_roles.interview_config; track C reads it to configure the role's AI interview. */
export const InterviewSection = z.enum(["intro", "technical", "problem_solving", "behavioral", "code_walkthrough", "candidate_questions", "close"]);
export const InterviewConfig = z.object({
  enabled: z.boolean(),
  duration_min: z.number().int().min(5).max(90),
  sections: z.array(InterviewSection).min(1),
  difficulty: z.enum(["easy", "medium", "hard"]),
  code_walkthrough: z.boolean(),
});
export type InterviewConfig = z.infer<typeof InterviewConfig>;
export const DEFAULT_INTERVIEW_CONFIG: InterviewConfig = {
  enabled: true, duration_min: 20, sections: ["intro", "technical", "problem_solving", "behavioral", "code_walkthrough", "close"],
  difficulty: "medium", code_walkthrough: true,
};

export const CandidateInput = z.object({ email: Email, fullName: NonEmpty(200), phone: z.string().trim().max(30).optional() });

export const Stage = z.enum(["invited", "in_progress", "completed", "shortlisted", "rejected", "hired", "withdrawn"]);
export type Stage = z.infer<typeof Stage>;
export const Decision = z.enum(["advance", "hold", "reject", "hire"]);

export const PipelineFilters = z.object({
  stages: z.array(Stage).optional(),
  scoreMin: z.number().min(0).max(100).optional(),
  scoreMax: z.number().min(0).max(100).optional(),
  integrityBands: z.array(IntegrityBand).optional(),
  search: z.string().trim().max(100).optional(),
});
export type PipelineFilters = z.infer<typeof PipelineFilters>;
export const PipelineSort = z.object({
  by: z.enum(["full_name", "stage", "match_score", "coding", "interview", "integrity", "invited_at", "completed_at"]),
  dir: z.enum(["asc", "desc"]),
});

const num = z.coerce.number();
export const PipelineRow = z.object({
  id: Uuid, full_name: z.string(), email: z.string(), phone: z.string().nullable(), stage: Stage,
  decision: Decision.nullable(), match_score: num.nullable(), recommendation: Recommendation.nullable(),
  invited_at: z.string(), started_at: z.string().nullable(), completed_at: z.string().nullable(),
  invite_expires_at: z.string().nullable(), email_sent_at: z.string().nullable(), email_error: z.string().nullable(),
  attempt_status: z.string().nullable(), coding: num.nullable(), interview: num.nullable(),
  integrity: num.nullable(), integrity_band: IntegrityBand.nullable(), credits_charged: z.boolean(),
});
export type PipelineRow = z.infer<typeof PipelineRow>;

/** The candidate report, for staff (report) and, without contacts / comments / decisions, for share links. */
export const CandidateReport = z.object({
  roleCandidateId: Uuid,
  stage: Stage,
  decision: Decision.nullable(),
  invitedAt: z.string(),
  completedAt: z.string().nullable(),
  candidate: z.object({ fullName: z.string(), email: z.string().nullable(), phone: z.string().nullable() }),
  role: z.object({ id: Uuid, title: z.string(), orgName: z.string() }),
  /** AI recommendation only; the team decides. */
  matchScore: z.number().nullable(),
  recommendation: Recommendation.nullable(),
  coverage: z.number(),
  skills: z.array(z.object({
    skill: z.string(), kind: z.enum(["must", "nice"]), weight: z.number(), score: z.number().nullable(), evidence: z.array(z.string()),
  })),
  coding: z.object({
    attemptId: Uuid, status: z.string(), score: z.number().nullable(), maxScore: z.number().nullable(), pct: z.number().nullable(),
    passed: z.number(), total: z.number(), pending: z.boolean(),
    questions: z.array(z.object({
      title: z.string(), language: z.string().nullable(), code: z.string().nullable(),
      passed: z.number().nullable(), total: z.number().nullable(), score: z.number().nullable(), maxScore: z.number().nullable(),
    })),
  }).nullable(),
  interview: z.object({
    interviewId: Uuid, status: z.string(), overall: z.number().nullable(), readiness: z.string().nullable(),
    evaluationStatus: z.string().nullable(),
    transcript: z.array(z.object({ turn: z.number(), role: z.string(), content: z.string() })),
    evidence: z.array(z.object({ label: z.string(), score: z.number().nullable(), quotes: z.array(z.string()), reason: z.string() })),
  }).nullable(),
  integrity: z.object({
    score: z.number().nullable(), band: IntegrityBand.nullable(),
    sessions: z.array(z.object({
      sessionId: Uuid.nullable(), kind: z.enum(["coding", "interview"]), score: z.number().nullable(), band: IntegrityBand.nullable(),
      flags: z.number(), review: z.string().nullable(),
    })),
  }),
  comments: z.array(z.object({ id: Uuid, author: z.string(), body: z.string(), createdAt: z.string() })),
  decisions: z.array(z.object({ decision: Decision, note: z.string().nullable(), by: z.string(), createdAt: z.string() })),
  /** Share view: integrity evidence images (snapshots) are never included. */
  evidenceIncluded: z.boolean(),
});
export type CandidateReport = z.infer<typeof CandidateReport>;

export const companyContract = {
  skillsFromJd: {
    input: z.object({ orgId: Uuid, jd: z.string().trim().min(80).max(30000) }),
    output: z.object({ skills: SkillsMatrix, cacheHit: z.boolean() }),
  },
  inviteCandidates: {
    input: z.object({
      jobRoleId: Uuid, candidates: z.array(CandidateInput).min(1).max(500), sendEmail: z.boolean().default(true),
      source: z.enum(["invite", "csv"]).default("invite"),
    }),
    output: z.object({
      invited: z.array(z.object({ roleCandidateId: Uuid, email: Email, fullName: z.string(), link: z.string().url(), emailed: z.boolean() })),
      skipped: z.array(z.object({ email: z.string(), reason: z.string() })),
      emailConfigured: z.boolean(),
    }),
  },
  resendInvite: {
    input: z.object({ roleCandidateId: Uuid }),
    output: z.object({ link: z.string().url(), emailed: z.boolean() }),
  },
  pipeline: {
    input: z.object({ jobRoleId: Uuid, filters: PipelineFilters.default({}), ...Page.shape, sort: PipelineSort.optional() }),
    output: z.object({
      access: z.enum(["editor", "viewer"]), total: z.number(), counts: z.record(z.number()), rows: z.array(PipelineRow),
    }),
  },
  exportPipeline: {
    input: z.object({ jobRoleId: Uuid, filters: PipelineFilters.default({}), format: z.enum(["csv", "xlsx"]) }),
    output: z.object({ columns: z.array(z.string()), rows: z.array(z.array(z.union([z.string(), z.number(), z.null()]))) }),
  },
  decide: {
    input: z.object({ roleCandidateIds: z.array(Uuid).min(1).max(500), decision: Decision, note: z.string().max(2000).optional() }),
    output: z.object({ updated: z.number(), skipped: z.array(z.object({ id: Uuid, reason: z.string() })) }),
  },
  report: {
    input: z.object({ roleCandidateId: Uuid }),
    output: z.object({ access: z.enum(["editor", "viewer"]), report: CandidateReport }),
  },
  createShareLink: {
    input: z.object({ roleCandidateId: Uuid, expiresInDays: z.number().int().min(1).max(30) }),
    output: z.object({ shareId: Uuid, link: z.string().url(), expiresAt: z.string() }),
  },
  revokeShareLink: {
    input: z.object({ shareId: Uuid }),
    output: Ok,
  },
  /** Company admin invites a recruiter, hiring manager or another admin (b2b_invite_staff). */
  inviteStaff: {
    input: z.object({ orgId: Uuid, email: Email, fullName: z.string().trim().max(200).optional(), role: z.enum(["org_admin", "recruiter", "hiring_manager"]) }),
    output: z.object({ inviteId: Uuid, link: z.string().url(), emailed: z.boolean() }),
  },
} as const;

export const StepStatus = z.enum(["todo", "in_progress", "done"]);
export const CandidateState = z.object({
  roleCandidateId: Uuid,
  jobRoleId: Uuid,
  attemptId: Uuid.nullable(),
  interviewId: Uuid.nullable(),
  completed: z.boolean(),
  steps: z.object({
    consent: StepStatus, system_check: StepStatus, coding: StepStatus.nullable(), interview: StepStatus.nullable(), done: StepStatus,
  }),
});
export type CandidateState = z.infer<typeof CandidateState>;

const Token = z.string().min(20).max(200);

export const candidateContract = {
  /** Public: what the link is for (no session needed). */
  resolveInvite: {
    input: z.object({ token: Token }),
    output: z.object({
      status: z.enum(["valid", "expired", "revoked", "closed", "invalid"]),
      company: z.object({ name: z.string(), logoUrl: z.string().nullable() }).optional(),
      role: z.object({ title: z.string() }).optional(),
      candidate: z.object({ fullName: z.string(), emailMasked: z.string() }).optional(),
      steps: z.array(z.enum(["consent", "system_check", "coding", "interview", "done"])).optional(),
      /** Purposes the consent step asks for (itemised). */
      purposes: z.array(ConsentPurpose).optional(),
      proctored: z.boolean().optional(),
    }),
  },
  /** Anonymous session: links it to the candidate on first use; refuses another session later. */
  startCandidate: {
    input: z.object({ token: Token }),
    output: CandidateState,
  },
  state: {
    input: z.object({ token: Token }),
    output: CandidateState,
  },
  /** Itemised consent; the server stores its own copy of the exact text for each purpose and version. */
  recordConsent: {
    input: z.object({ token: Token, purposes: z.array(ConsentPurpose).min(1), version: z.string().max(40) }),
    output: CandidateState,
  },
  markSystemCheck: {
    input: z.object({ token: Token }),
    output: CandidateState,
  },
  /** Public: an expiring, view-only report link for outside hiring managers. */
  viewShare: {
    input: z.object({ token: Token }),
    output: z.object({
      status: z.enum(["ok", "expired", "revoked", "invalid"]),
      expiresAt: z.string().optional(),
      report: CandidateReport.optional(),
    }),
  },
} as const;
