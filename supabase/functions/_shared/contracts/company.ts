// b2b-company — company admin, recruiter, hiring manager (track E). Stubbed in Phase 1.
// b2b-candidate — the candidate's token flow (no password account). Stubbed in Phase 1.
import { z } from "./zod.ts";
import { ConsentPurpose, Email, NonEmpty, Ok, Recommendation, Uuid } from "./common.ts";

export const SkillsMatrix = z.object({
  must_have: z.array(z.object({ skill: NonEmpty(80), weight: z.number().min(1).max(5) })).min(1).max(15),
  nice_to_have: z.array(z.object({ skill: NonEmpty(80), weight: z.number().min(1).max(5) })).max(15),
  seniority: z.enum(["intern", "junior", "mid", "senior", "lead"]),
  summary: z.string().max(600).optional(),
});
export type SkillsMatrix = z.infer<typeof SkillsMatrix>;

export const CandidateInput = z.object({ email: Email, fullName: NonEmpty(200), phone: z.string().trim().max(30).optional() });

export const companyContract = {
  skillsFromJd: {
    input: z.object({ orgId: Uuid, jd: z.string().trim().min(80).max(30000) }),
    output: z.object({ skills: SkillsMatrix, cacheHit: z.boolean() }),
  },
  inviteCandidates: {
    input: z.object({ jobRoleId: Uuid, candidates: z.array(CandidateInput).min(1).max(500), sendEmail: z.boolean().default(true) }),
    output: z.object({
      invited: z.array(z.object({ roleCandidateId: Uuid, email: Email, link: z.string().url(), emailed: z.boolean() })),
      skipped: z.array(z.object({ email: z.string(), reason: z.string() })),
    }),
  },
  resendInvite: {
    input: z.object({ roleCandidateId: Uuid }),
    output: z.object({ link: z.string().url(), emailed: z.boolean() }),
  },
  decide: {
    input: z.object({ roleCandidateId: Uuid, decision: z.enum(["advance", "hold", "reject", "hire"]), note: z.string().max(2000).optional() }),
    output: Ok,
  },
  buildReport: {
    input: z.object({ roleCandidateId: Uuid }),
    output: z.object({
      matchScore: z.number().nullable(),
      recommendation: Recommendation.nullable(),
      skills: z.array(z.object({ skill: z.string(), score: z.number().nullable(), evidence: z.array(z.string()) })),
      coding: z.object({ score: z.number().nullable(), maxScore: z.number().nullable(), passed: z.number(), total: z.number() }).nullable(),
      interview: z.object({ overall: z.number().nullable(), interviewId: Uuid }).nullable(),
      integrity: z.object({ score: z.number().nullable(), band: z.string().nullable(), sessionId: Uuid }).nullable(),
    }),
  },
  createShareLink: {
    input: z.object({ roleCandidateId: Uuid, expiresInDays: z.number().int().min(1).max(30) }),
    output: z.object({ shareId: Uuid, link: z.string().url(), expiresAt: z.string() }),
  },
} as const;

export const candidateContract = {
  /** Public: what the link is for (no session needed). */
  resolveInvite: {
    input: z.object({ token: z.string().min(20).max(200) }),
    output: z.object({
      status: z.enum(["valid", "expired", "used", "invalid"]),
      company: z.object({ name: z.string(), logoUrl: z.string().nullable() }).optional(),
      role: z.object({ title: z.string() }).optional(),
      candidate: z.object({ fullName: z.string(), emailMasked: z.string() }).optional(),
      steps: z.array(z.enum(["consent", "system_check", "coding", "interview", "done"])).optional(),
    }),
  },
  /** Called with an anonymous Supabase session: links that session to the candidate row. */
  claimInvite: {
    input: z.object({ token: z.string().min(20).max(200) }),
    output: z.object({ roleCandidateId: Uuid, attemptId: Uuid.nullable(), interviewId: Uuid.nullable() }),
  },
  consent: {
    input: z.object({ roleCandidateId: Uuid, purposes: z.array(ConsentPurpose).min(1), version: z.string().max(40) }),
    output: Ok,
  },
  /** Public: an expiring, view-only report link for outside hiring managers. */
  viewShare: {
    input: z.object({ token: z.string().min(20).max(200) }),
    output: z.object({ status: z.enum(["ok", "expired", "revoked", "invalid"]), report: z.unknown().optional() }),
  },
} as const;
