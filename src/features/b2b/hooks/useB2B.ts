import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { b2bDb } from "../lib/db";
import type {
  Batch, InterviewModule, InterviewQuota, MembershipWithOrg, OrgInvite, OrgMembership, OrgUsageSummary, Organization, Plan, StudentUsage,
} from "../types";

async function unwrap<T>(p: PromiseLike<{ data: unknown; error: unknown }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw error;
  return data as T;
}

export function useIsSuperAdmin() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["b2b", "is-super-admin", user?.id],
    enabled: !!user,
    staleTime: 60_000,
    queryFn: () => unwrap<boolean>(b2bDb.rpc("is_super_admin")),
  });
}

/** The signed-in user's org memberships (empty for B2C users). */
export function useMyMemberships() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["b2b", "my-memberships", user?.id],
    enabled: !!user,
    staleTime: 60_000,
    queryFn: () =>
      unwrap<MembershipWithOrg[]>(
        b2bDb
          .from("org_memberships")
          .select("*, organizations(id, name, slug, type, logo_url, is_demo)")
          .eq("user_id", user!.id)
          .order("created_at"),
      ),
  });
}

export function useMyQuota() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["b2b", "my-quota", user?.id],
    enabled: !!user,
    staleTime: 15_000,
    queryFn: () => unwrap<InterviewQuota[]>(b2bDb.rpc("my_interview_quota")),
  });
}

export function useOrgUsageSummary(orgId: string | undefined) {
  return useQuery({
    queryKey: ["b2b", "org-usage", orgId],
    enabled: !!orgId,
    staleTime: 15_000,
    queryFn: () => unwrap<OrgUsageSummary>(b2bDb.rpc("org_usage_summary", { _org_id: orgId })),
  });
}

export interface StudentRow extends OrgMembership {
  interviews_used: number;
}

export function useOrgStudents(orgId: string | undefined) {
  return useQuery({
    queryKey: ["b2b", "org-students", orgId],
    enabled: !!orgId,
    staleTime: 15_000,
    queryFn: async (): Promise<StudentRow[]> => {
      const [members, usage] = await Promise.all([
        unwrap<OrgMembership[]>(
          b2bDb.from("org_memberships").select("*").eq("org_id", orgId!).eq("role", "student").order("roll_no"),
        ),
        unwrap<StudentUsage[]>(
          b2bDb.from("org_student_usage").select("org_id, user_id, interviews_used").eq("org_id", orgId!),
        ),
      ]);
      const used = new Map(usage.map((u) => [u.user_id, u.interviews_used]));
      return members.map((m) => ({ ...m, interviews_used: used.get(m.user_id) ?? 0 }));
    },
  });
}

export interface OrgWithCounts extends Organization {
  student_count: number;
}

export function useAllOrgs(enabled: boolean) {
  return useQuery({
    queryKey: ["b2b", "all-orgs"],
    enabled,
    queryFn: async (): Promise<OrgWithCounts[]> => {
      const [orgs, students] = await Promise.all([
        unwrap<Organization[]>(b2bDb.from("organizations").select("*").order("created_at", { ascending: false })),
        unwrap<{ org_id: string }[]>(b2bDb.from("org_memberships").select("org_id").eq("role", "student")),
      ]);
      const counts = new Map<string, number>();
      for (const s of students) counts.set(s.org_id, (counts.get(s.org_id) ?? 0) + 1);
      return orgs.map((o) => ({ ...o, student_count: counts.get(o.id) ?? 0 }));
    },
  });
}

export function usePlans(enabled: boolean) {
  return useQuery({
    queryKey: ["b2b", "plans"],
    enabled,
    staleTime: 5 * 60_000,
    queryFn: () => unwrap<Plan[]>(b2bDb.from("plans").select("*").order("interviews_per_student")),
  });
}

export function useOrgInvites(orgId: string | undefined) {
  return useQuery({
    queryKey: ["b2b", "org-invites", orgId],
    enabled: !!orgId,
    staleTime: 10_000,
    queryFn: async () => {
      const [invites, batches] = await Promise.all([
        unwrap<OrgInvite[]>(
          b2bDb
            .from("org_invites")
            .select("id, org_id, batch_id, full_name, email, roll_no, status, expires_at, accepted_at, email_sent_at, email_error, created_at")
            .eq("org_id", orgId!)
            .order("created_at", { ascending: false }),
        ),
        unwrap<Batch[]>(b2bDb.from("batches").select("*").eq("org_id", orgId!).order("name")),
      ]);
      return { invites, batches };
    },
  });
}

const MODULE_COLUMNS = "id, org_id, spec, name, type, is_active, template_id, version, public_test, created_at, updated_at";

/** Staff view: the org's own modules (incl. archived) + the HiResume library. */
export function useOrgModules(orgId: string | undefined) {
  return useQuery({
    queryKey: ["b2b", "modules", orgId],
    enabled: !!orgId,
    staleTime: 30_000,
    queryFn: async () => {
      const [own, library] = await Promise.all([
        unwrap<InterviewModule[]>(b2bDb.from("interview_modules").select(MODULE_COLUMNS).eq("org_id", orgId!).order("created_at")),
        unwrap<InterviewModule[]>(b2bDb.from("interview_modules").select(MODULE_COLUMNS).is("org_id", null).order("name")),
      ]);
      return { own, library };
    },
  });
}

/** Student view: active modules their institution enabled (RLS applies the plan's company-pack rule). */
export function useStudentModules(orgId: string | undefined) {
  return useQuery({
    queryKey: ["b2b", "student-modules", orgId],
    enabled: !!orgId,
    staleTime: 60_000,
    queryFn: () =>
      unwrap<InterviewModule[]>(
        b2bDb.from("interview_modules").select(MODULE_COLUMNS).eq("org_id", orgId!).eq("is_active", true).order("name"),
      ),
  });
}
