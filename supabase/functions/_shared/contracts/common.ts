// Shared vocabulary for the B2B V1 API contracts. Mirrors the CHECK constraints in the V1 migrations
// (supabase/migrations/20261021*), so the browser, the edge functions and the database agree.
import { z } from "./zod.ts";

export const Uuid = z.string().uuid();
export const Email = z.string().trim().toLowerCase().email().max(254);
export const NonEmpty = (max: number) => z.string().trim().min(1).max(max);

export const OrgType = z.enum(["college", "company"]);
export const OrgStatus = z.enum(["active", "suspended"]);
export const StaffRole = z.enum(["org_admin", "trainer", "recruiter", "hiring_manager"]);
export const MemberRole = z.enum(["org_admin", "trainer", "student", "recruiter", "hiring_manager"]);
export const ProctoringPolicy = z.enum(["off", "standard", "strict", "maximum"]);
export const ResultsRelease = z.enum(["immediate", "manual", "never"]);
export const ContextType = z.enum(["practice", "drive", "job_role"]);
export const Difficulty = z.enum(["easy", "medium", "hard"]);
export const QuestionType = z.enum(["coding", "mcq"]);
export const Language = z.enum(["python", "java", "cpp", "c", "javascript"]);
export const IntegrityBand = z.enum(["high", "medium", "low"]);
export const Recommendation = z.enum(["strong", "good", "borderline", "not_yet"]);
export const ConsentPurpose = z.enum([
  "account", "assessment", "proctoring_screen", "proctoring_camera", "proctoring_audio", "interview_audio", "recording",
]);

/** Every B2B function answers errors as { error, code } with a real HTTP status. */
export const ApiError = z.object({ error: z.string(), code: z.string(), details: z.unknown().optional() });
export type ApiError = z.infer<typeof ApiError>;

/** A contract: action name → input and output schemas. */
export type Contract = Record<string, { input: z.ZodTypeAny; output: z.ZodTypeAny }>;
export type ContractInput<C extends Contract, A extends keyof C> = z.input<C[A]["input"]>;
export type ContractOutput<C extends Contract, A extends keyof C> = z.output<C[A]["output"]>;

export const Ok = z.object({ ok: z.literal(true) });
export const Page = z.object({ page: z.number().int().min(1).default(1), pageSize: z.number().int().min(1).max(200).default(50) });
