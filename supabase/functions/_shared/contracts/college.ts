// b2b-college — TPO admin and trainers (track D). Stubbed in Phase 1.
// Drives, assessments and students are also editable directly through RLS; these actions cover the
// work that needs server-side logic (dedupe, eligibility, release, aggregation, exports).
import { z } from "./zod.ts";
import { Email, IntegrityBand, NonEmpty, Ok, Page, Uuid } from "./common.ts";

const InviteLink = z.object({
  studentId: Uuid, link: z.string().url(),
  rollNo: z.string().optional(), fullName: z.string().optional(), email: z.string().optional(),
});

export const StudentRow = z.object({
  row: z.number().int().min(1),
  roll_no: NonEmpty(60),
  full_name: NonEmpty(200),
  email: Email,
  phone: z.string().trim().max(30).optional(),
  department: z.string().trim().max(120).optional(),
  batch_year: z.coerce.number().int().min(2000).max(2100).optional(),
  section: z.string().trim().max(40).optional(),
  cgpa: z.coerce.number().min(0).max(10).optional(),
  active_backlogs: z.coerce.number().int().min(0).optional(),
  tenth_pct: z.coerce.number().min(0).max(100).optional(),
  twelfth_pct: z.coerce.number().min(0).max(100).optional(),
  dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export type StudentRow = z.infer<typeof StudentRow>;

export const Eligibility = z.object({
  departments: z.array(z.string()).optional(),
  batch_years: z.array(z.number().int()).optional(),
  sections: z.array(z.string()).optional(),
  min_cgpa: z.number().min(0).max(10).optional(),
  max_backlogs: z.number().int().min(0).optional(),
  min_tenth_pct: z.number().min(0).max(100).optional(),
  min_twelfth_pct: z.number().min(0).max(100).optional(),
}).strict();
export type Eligibility = z.infer<typeof Eligibility>;

export const AnalyticsFilters = z.object({
  driveId: Uuid.optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  departments: z.array(z.string()).optional(),
  batchYears: z.array(z.number().int()).optional(),
  sections: z.array(z.string()).optional(),
  cgpa: z.tuple([z.number(), z.number()]).optional(),
  maxBacklogs: z.number().int().optional(),
  integrityBands: z.array(IntegrityBand).optional(),
  scoreRange: z.tuple([z.number(), z.number()]).optional(),
  status: z.array(z.enum(["assigned", "in_progress", "completed", "absent"])).optional(),
  search: z.string().max(100).optional(),
});
export type AnalyticsFilters = z.infer<typeof AnalyticsFilters>;

const DuplicateRow = z.object({ row: z.number(), reason: z.enum(["roll_no", "email", "both", "in_file"]), existingStudentId: Uuid.nullable() });

export const collegeContract = {
  importStudents: {
    input: z.object({
      orgId: Uuid,
      mode: z.enum(["preview", "commit"]),
      rows: z.array(StudentRow).min(1).max(5000),
      /** For rows that duplicate an existing student: merge (update fields) or skip. */
      onDuplicate: z.enum(["merge", "skip"]).default("skip"),
      sendInvites: z.boolean().default(false),
    }),
    output: z.object({
      created: z.number(), merged: z.number(), skipped: z.number(), heldMinors: z.number(),
      duplicates: z.array(DuplicateRow),
      errors: z.array(z.object({ row: z.number(), message: z.string() })),
      /** sendInvites on commit: activation links for the new (and merged, not yet active) students. */
      invites: z.array(InviteLink).optional(),
      emailed: z.number().optional(),
    }),
  },
  inviteStudents: {
    input: z.object({ orgId: Uuid, studentIds: z.array(Uuid).min(1).max(5000) }),
    /** queued = emails accepted by the provider; links are always returned (for WhatsApp / CSV when email is off). */
    output: z.object({
      queued: z.number(), links: z.array(InviteLink),
      skipped: z.array(z.object({ studentId: Uuid, reason: z.string() })).default([]),
      emailConfigured: z.boolean().default(false),
    }),
  },
  /** TPO admin invites another TPO admin or a trainer (b2b_invite_staff). */
  inviteStaff: {
    input: z.object({ orgId: Uuid, email: Email, fullName: z.string().trim().max(200).optional(), role: z.enum(["org_admin", "trainer"]) }),
    output: z.object({ inviteId: Uuid, link: z.string().url(), emailed: z.boolean() }),
  },
  previewEligibility: {
    input: z.object({ orgId: Uuid, eligibility: Eligibility }),
    output: z.object({ count: z.number(), sample: z.array(z.object({ id: Uuid, full_name: z.string(), roll_no: z.string() })) }),
  },
  assignDrive: {
    input: z.object({ driveId: Uuid }),
    output: z.object({ assigned: z.number(), alreadyAssigned: z.number(), ineligible: z.number() }),
  },
  releaseResults: {
    input: z.object({ driveId: Uuid }),
    output: Ok,
  },
  analytics: {
    input: z.object({ orgId: Uuid, filters: AnalyticsFilters, ...Page.shape,
                      sort: z.object({ by: z.string(), dir: z.enum(["asc", "desc"]) }).optional() }),
    output: z.object({
      total: z.number(),
      rows: z.array(z.object({
        student_id: Uuid, drive_id: Uuid, drive_name: z.string(), full_name: z.string(), roll_no: z.string(),
        email: z.string(), department: z.string().nullable(),
        batch_year: z.number().nullable(), section: z.string().nullable(), cgpa: z.number().nullable(),
        active_backlogs: z.number().nullable(),
        status: z.string(), coding: z.number().nullable(), mcq: z.number().nullable(), interview: z.number().nullable(),
        overall: z.number().nullable(), integrity_band: IntegrityBand.nullable(), integrity_score: z.number().nullable(),
      })),
      summary: z.object({
        funnel: z.object({ invited: z.number(), activated: z.number(), started: z.number(), completed: z.number() }),
        byStatus: z.object({ assigned: z.number(), in_progress: z.number(), completed: z.number(), absent: z.number() }),
        byDepartment: z.array(z.object({ department: z.string(), students: z.number(), avg: z.number().nullable() })),
        dimensions: z.array(z.object({ dimension: z.string(), avg: z.number().nullable() })),
      }),
    }),
  },
  exportTable: {
    input: z.object({ orgId: Uuid, filters: AnalyticsFilters, format: z.enum(["csv", "xlsx"]) }),
    /** The file is built in the browser from these rows (no server file storage). */
    output: z.object({ columns: z.array(z.string()), rows: z.array(z.array(z.union([z.string(), z.number(), z.null()]))) }),
  },
} as const;
