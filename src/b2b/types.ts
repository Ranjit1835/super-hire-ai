// Row types for the V1 B2B tables (supabase/migrations/20261021*). Hand-written until the generated
// Supabase types are regenerated from a database that has the V1 migrations.
import type { z } from "zod";
import type { MemberRole, OrgStatus, OrgType, ProctoringPolicy, ResultsRelease } from "../../supabase/functions/_shared/contracts/common";
import type { OrgSettings } from "../../supabase/functions/_shared/contracts/admin";

export type OrgTypeV1 = z.infer<typeof OrgType> | "coaching_institute";
export type MemberRoleV1 = z.infer<typeof MemberRole>;

export interface OrgRow {
  id: string;
  name: string;
  slug: string;
  type: OrgTypeV1;
  status: z.infer<typeof OrgStatus>;
  plan_id: string;
  plan_starts_at: string;
  plan_ends_at: string | null;
  seat_limit: number | null;
  credits_balance: string | number;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  address: string | null;
  logo_url: string | null;
  settings: z.infer<typeof OrgSettings>;
  is_demo: boolean;
  created_at: string;
}

export interface PlanRow {
  id: string;
  name: string;
  org_type: "college" | "company" | null;
  price_inr_per_student: string | number;
  drives_included: number;
  credits_per_student: string | number;
  credits_included: string | number;
  is_active: boolean;
}

export interface InviteRow {
  id: string;
  org_id: string;
  email: string;
  full_name: string;
  role: MemberRoleV1;
  status: "pending" | "accepted" | "revoked";
  expires_at: string;
  email_sent_at: string | null;
  email_error: string | null;
  created_at: string;
}

export interface CreditLedgerRow {
  id: number;
  org_id: string;
  delta: string | number;
  balance_after: string | number;
  reason: "grant" | "top_up" | "consume" | "refund" | "adjust" | "expire";
  feature: string | null;
  note: string | null;
  created_at: string;
}

export type ProctoringPolicyV1 = z.infer<typeof ProctoringPolicy>;
export type ResultsReleaseV1 = z.infer<typeof ResultsRelease>;
