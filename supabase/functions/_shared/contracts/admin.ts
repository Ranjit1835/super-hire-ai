// b2b-admin — super admin (platform). Implemented in Phase 1.
// Credits are changed with the super_adjust_credits RPC; usage comes from the super_org_usage RPC.
import { z } from "./zod.ts";
import { Email, NonEmpty, Ok, OrgStatus, OrgType, ProctoringPolicy, ResultsRelease, StaffRole, Uuid } from "./common.ts";

const Slug = z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/, "3–50 lowercase letters, digits or hyphens");

export const OrgSettings = z.object({
  enabled_modules: z.object({ coding: z.boolean(), mcq: z.boolean(), interview: z.boolean(), resume: z.boolean() }).partial().optional(),
  quotas: z.record(z.string(), z.number().int().min(0)).optional(),
  proctoring_default: ProctoringPolicy.optional(),
  results_release_default: ResultsRelease.optional(),
  retention_days: z.number().int().min(7).max(730).optional(),
  video_enabled: z.boolean().optional(),
}).strict();

const OrgFields = {
  name: NonEmpty(200),
  planId: z.string().regex(/^[a-z][a-z0-9_]{1,30}$/),
  seatLimit: z.number().int().positive().nullable().optional(),
  validFrom: z.string().datetime({ offset: true }).optional(),
  validTo: z.string().datetime({ offset: true }).nullable().optional(),
  contactName: z.string().trim().max(200).nullable().optional(),
  contactEmail: Email.nullable().optional(),
  contactPhone: z.string().trim().max(30).nullable().optional(),
  address: z.string().trim().max(500).nullable().optional(),
  logoUrl: z.string().url().max(500).nullable().optional(),
  settings: OrgSettings.optional(),
};

export const adminContract = {
  createOrg: {
    input: z.object({
      ...OrgFields,
      slug: Slug,
      type: OrgType,
      /** Opening credit pool; for colleges defaults to seatLimit × plan.credits_per_student. */
      initialCredits: z.number().min(0).max(1_000_000).optional(),
      /** First org admin (TPO admin / company admin): an invite is created and emailed. */
      admin: z.object({ email: Email, fullName: z.string().trim().max(200).optional() }).optional(),
    }),
    output: z.object({
      orgId: Uuid,
      credits: z.number(),
      invite: z.object({ inviteId: Uuid, link: z.string().url(), emailed: z.boolean() }).nullable(),
    }),
  },
  updateOrg: {
    input: z.object({ orgId: Uuid, status: OrgStatus.optional(), ...Object.fromEntries(
      Object.entries(OrgFields).map(([k, v]) => [k, (v as z.ZodTypeAny).optional()])) }),
    output: Ok,
  },
  inviteStaff: {
    input: z.object({ orgId: Uuid, email: Email, fullName: z.string().trim().max(200).optional(), role: StaffRole }),
    output: z.object({ inviteId: Uuid, link: z.string().url(), emailed: z.boolean() }),
  },
  revokeInvite: {
    input: z.object({ inviteId: Uuid }),
    output: Ok,
  },
} as const;

export const OrgUsageRow = z.object({
  org_id: Uuid, org_name: z.string(), org_type: z.string(), status: z.string(), plan_id: z.string(),
  credits_balance: z.coerce.number(), credits_used_month: z.coerce.number(), students: z.number(), students_active: z.number(),
  candidates: z.number(), members: z.number(), ai_calls_month: z.number(), ai_cost_inr_month: z.coerce.number(),
  ai_cost_inr_total: z.coerce.number(), cache_hits_month: z.number(), cache_hit_rate_month: z.coerce.number().nullable(),
});
export type OrgUsageRow = z.infer<typeof OrgUsageRow>;
