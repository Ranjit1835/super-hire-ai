export type OrgType = "college" | "coaching_institute";
export type OrgMemberRole = "org_admin" | "trainer" | "student";

export interface Plan {
  id: string;
  name: string;
  interviews_per_student: number;
  company_packs_enabled: boolean;
  dashboard_enabled: boolean;
  max_students: number | null;
  price_inr_per_student?: number;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  type: OrgType;
  logo_url: string | null;
  is_demo: boolean;
  plan_id: string;
  plan_starts_at: string;
  plan_ends_at: string | null;
  created_at: string;
}

export interface Batch {
  id: string;
  org_id: string;
  name: string;
  department: string | null;
  course: string | null;
  start_date: string | null;
}

export interface OrgMembership {
  id: string;
  org_id: string;
  user_id: string;
  role: OrgMemberRole;
  batch_id: string | null;
  full_name: string | null;
  email: string | null;
  roll_no: string | null;
  created_at: string;
}

export interface MembershipWithOrg extends OrgMembership {
  organizations: Pick<Organization, "id" | "name" | "slug" | "type" | "logo_url" | "is_demo">;
}

export interface StudentUsage {
  org_id: string;
  user_id: string;
  interviews_used: number;
}

export interface InterviewQuota {
  org_id: string;
  org_name: string;
  plan_id: string;
  interviews_used: number;
  interviews_limit: number;
  interviews_remaining: number;
  plan_ends_at: string | null;
}

export interface OrgUsageSummary {
  org_id: string;
  plan: Plan;
  plan_starts_at: string;
  plan_ends_at: string | null;
  students: number;
  interviews_used: number;
  students_exhausted: number;
}

export type OrgInviteStatus = "pending" | "accepted" | "revoked";

export interface OrgInvite {
  id: string;
  org_id: string;
  batch_id: string | null;
  full_name: string;
  email: string;
  roll_no: string;
  status: OrgInviteStatus;
  expires_at: string;
  accepted_at: string | null;
  email_sent_at: string | null;
  email_error: string | null;
  created_at: string;
}
