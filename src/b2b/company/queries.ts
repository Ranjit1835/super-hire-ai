// Startup portal data. Reads go straight to the tables (RLS scopes them: hiring managers see only assigned
// roles); roles and comments are written through RLS; everything else goes through companyApi (b2b-company).
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { b2bDb } from "@/features/b2b/lib/db";
import type { InterviewConfig, SkillsMatrix } from "../../../supabase/functions/_shared/contracts/company";
import type { CreditLedgerRow, InviteRow, ProctoringPolicyV1 } from "../types";
import { rows } from "../college/queries";

export { rows };

export type CompanyRole = "org_admin" | "recruiter" | "hiring_manager";
export interface JobRoleRecord {
  id: string; org_id: string; title: string; jd_text: string | null; skills_matrix: SkillsMatrix | Record<string, never>;
  seniority: string | null; assessment_id: string | null; interview_config: InterviewConfig; proctoring_policy: ProctoringPolicyV1;
  invite_expiry_days: number; status: "draft" | "open" | "closed"; hiring_manager_ids: string[]; created_at: string;
}
export interface CompanyOrg { id: string; name: string; type: string; credits_balance: number | string; status: string; settings: Record<string, unknown> }
export interface TeamMember { id: string; user_id: string; role: CompanyRole; full_name: string | null; email: string | null; created_at: string }
export interface ShareLinkRow { id: string; expires_at: string; revoked_at: string | null; view_count: number; last_viewed_at: string | null; created_at: string }

export function useCompanyAccess(orgId: string | undefined) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["b2b-company", "access", orgId, user?.id],
    enabled: !!orgId && !!user,
    staleTime: 60_000,
    queryFn: async () => {
      const [isSuper, member] = await Promise.all([
        rows<boolean>(b2bDb.rpc("is_super_admin")),
        rows<{ role: string }[]>(b2bDb.from("org_memberships").select("role").eq("org_id", orgId!).eq("user_id", user!.id)),
      ]);
      const role = (member[0]?.role ?? null) as CompanyRole | null;
      const staff = isSuper || role === "org_admin" || role === "recruiter" || role === "hiring_manager";
      return { role, isSuper, staff, isAdmin: isSuper || role === "org_admin", isEditor: isSuper || role === "org_admin" || role === "recruiter" };
    },
  });
}

export function useMyCompanies() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["b2b-company", "mine", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const m = await rows<{ org_id: string }[]>(b2bDb.from("org_memberships").select("org_id").eq("user_id", user!.id)
        .in("role", ["org_admin", "recruiter", "hiring_manager"]));
      if (!m.length) return [];
      return rows<CompanyOrg[]>(b2bDb.from("organizations").select("id, name, type, credits_balance, status, settings")
        .in("id", m.map((x) => x.org_id)).eq("type", "company").order("name"));
    },
  });
}

export function useCompanyOrg(orgId: string | undefined) {
  return useQuery({
    queryKey: ["b2b-company", "org", orgId],
    enabled: !!orgId,
    queryFn: () => rows<CompanyOrg>(b2bDb.from("organizations").select("id, name, type, credits_balance, status, settings").eq("id", orgId!).single()),
  });
}

export function useRoles(orgId: string) {
  return useQuery({
    queryKey: ["b2b-company", "roles", orgId],
    queryFn: async () => {
      const [roles, rcs] = await Promise.all([
        rows<JobRoleRecord[]>(b2bDb.from("job_roles").select("*").eq("org_id", orgId).order("created_at", { ascending: false })),
        rows<{ job_role_id: string; stage: string }[]>(b2bDb.from("role_candidates").select("job_role_id, stage").eq("org_id", orgId).limit(10000)),
      ]);
      const counts = new Map<string, { total: number; completed: number }>();
      for (const r of rcs) {
        const c = counts.get(r.job_role_id) ?? { total: 0, completed: 0 };
        c.total++;
        if (!["invited", "in_progress", "withdrawn"].includes(r.stage)) c.completed++;
        counts.set(r.job_role_id, c);
      }
      return roles.map((r) => ({ ...r, counts: counts.get(r.id) ?? { total: 0, completed: 0 } }));
    },
  });
}

export function useRole(roleId: string | undefined) {
  return useQuery({
    queryKey: ["b2b-company", "role", roleId],
    enabled: !!roleId,
    queryFn: () => rows<JobRoleRecord>(b2bDb.from("job_roles").select("*").eq("id", roleId!).single()),
  });
}

export function useCompanyAssessments(orgId: string) {
  return useQuery({
    queryKey: ["b2b-company", "assessments", orgId],
    queryFn: () => rows<{ id: string; title: string; status: string; duration_min: number }[]>(
      b2bDb.from("assessments").select("id, title, status, duration_min").eq("org_id", orgId).neq("status", "archived").order("title")),
  });
}

export function useTeam(orgId: string) {
  return useQuery({
    queryKey: ["b2b-company", "team", orgId],
    queryFn: async () => {
      const [members, invites] = await Promise.all([
        rows<TeamMember[]>(b2bDb.from("org_memberships").select("id, user_id, role, full_name, email, created_at").eq("org_id", orgId)
          .in("role", ["org_admin", "recruiter", "hiring_manager"]).order("created_at")),
        rows<InviteRow[]>(b2bDb.from("org_invites").select("id, org_id, email, full_name, role, status, expires_at, email_sent_at, email_error, created_at")
          .eq("org_id", orgId).neq("role", "student").eq("status", "pending").order("created_at", { ascending: false })),
      ]);
      return { members, invites };
    },
  });
}

export function useCompanyLedger(orgId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["b2b-company", "ledger", orgId],
    enabled,
    queryFn: () => rows<CreditLedgerRow[]>(b2bDb.from("org_credit_ledger").select("*").eq("org_id", orgId).order("created_at", { ascending: false }).limit(200)),
  });
}

export function useShareLinks(rcId: string | undefined) {
  return useQuery({
    queryKey: ["b2b-company", "shares", rcId],
    enabled: !!rcId,
    queryFn: () => rows<ShareLinkRow[]>(b2bDb.from("share_links").select("id, expires_at, revoked_at, view_count, last_viewed_at, created_at")
      .eq("target_id", rcId!).order("created_at", { ascending: false })),
  });
}

export function friendlyError(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/ROLE_INCOMPLETE/.test(m)) return "An open role needs a skills matrix and a coding test or an AI interview.";
  if (/NOT_A_HIRING_MANAGER/.test(m)) return "Only hiring managers of this company can be assigned.";
  if (/INVALID_SKILLS_MATRIX/.test(m)) return "The skills matrix needs at least one must-have skill.";
  if (/INVALID_INTERVIEW_CONFIG/.test(m)) return "The interview settings aren't valid.";
  if (/FORBIDDEN|permission|row-level security/i.test(m)) return "You don't have permission to do that.";
  return m;
}

export const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—";
export const fmtDateTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
