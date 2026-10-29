// Reads go straight to the tables (RLS scopes them to the caller's college); writes that need server logic go
// through collegeApi (b2b-college). Manual student add/edit and drive create/edit use RLS-guarded table writes.
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { b2bDb } from "@/features/b2b/lib/db";
import type { Eligibility } from "../../../supabase/functions/_shared/contracts/college";
import type { CreditLedgerRow, InviteRow, ProctoringPolicyV1, ResultsReleaseV1 } from "../types";

export async function rows<T>(p: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data as T;
}

export type StudentStatus = "imported" | "invited" | "active" | "deactivated" | "held_minor";
export interface StudentRecord {
  id: string; org_id: string; roll_no: string; full_name: string; email: string; phone: string | null;
  department: string | null; batch_year: number | null; section: string | null; cgpa: number | string | null;
  active_backlogs: number | null; tenth_pct: number | string | null; twelfth_pct: number | string | null; dob: string | null;
  status: StudentStatus; user_id: string | null; created_at: string;
}
export interface DriveRecord {
  id: string; org_id: string; name: string; description: string | null; assessment_id: string | null;
  interview_module_id: string | null; resume_task: boolean; eligibility: Eligibility; window_start: string | null;
  window_end: string | null; proctoring_policy: ProctoringPolicyV1; results_release: ResultsReleaseV1;
  results_released_at: string | null; status: "draft" | "scheduled" | "live" | "closed"; created_at: string;
}
export interface OrgSummary { id: string; name: string; type: string; credits_balance: number | string; seat_limit: number | null; status: string }
export interface StaffRow { id: string; user_id: string; role: string; full_name: string | null; email: string | null; created_at: string }

export const STATUS_TEXT: Record<StudentStatus, string> = {
  imported: "Not invited", invited: "Invited", active: "Active", deactivated: "Deactivated", held_minor: "Held (under 18)",
};

export function useCollegeAccess(orgId: string | undefined) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["b2b-college", "access", orgId, user?.id],
    enabled: !!orgId && !!user,
    staleTime: 60_000,
    queryFn: async () => {
      const [isSuper, member] = await Promise.all([
        rows<boolean>(b2bDb.rpc("is_super_admin")),
        rows<{ role: string }[]>(b2bDb.from("org_memberships").select("role").eq("org_id", orgId!).eq("user_id", user!.id)),
      ]);
      const role = member[0]?.role ?? null;
      const staff = isSuper || role === "org_admin" || role === "trainer";
      return { role, isSuper, staff, isAdmin: isSuper || role === "org_admin" };
    },
  });
}

/** Colleges where I'm TPO admin or trainer (for /c). */
export function useMyColleges() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["b2b-college", "mine", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const m = await rows<{ org_id: string; role: string }[]>(
        b2bDb.from("org_memberships").select("org_id, role").eq("user_id", user!.id).in("role", ["org_admin", "trainer"]));
      if (!m.length) return [];
      return rows<OrgSummary[]>(b2bDb.from("organizations").select("id, name, type, credits_balance, seat_limit, status")
        .in("id", m.map((x) => x.org_id)).neq("type", "company").order("name"));
    },
  });
}

export function useOrg(orgId: string | undefined) {
  return useQuery({
    queryKey: ["b2b-college", "org", orgId],
    enabled: !!orgId,
    queryFn: () => rows<OrgSummary>(b2bDb.from("organizations").select("id, name, type, credits_balance, seat_limit, status").eq("id", orgId!).single()),
  });
}

export interface StudentQuery { search: string; department: string; batchYear: string; status: string; page: number }
export const STUDENT_PAGE = 50;

export function useStudents(orgId: string, q: StudentQuery) {
  return useQuery({
    queryKey: ["b2b-college", "students", orgId, q],
    queryFn: async () => {
      let req = b2bDb.from("students").select("*", { count: "exact" }).eq("org_id", orgId);
      const s = q.search.trim().replace(/[%,()]/g, " ");
      if (s) req = req.or(`full_name.ilike.%${s}%,roll_no.ilike.%${s}%,email.ilike.%${s}%`);
      if (q.department) req = req.eq("department", q.department);
      if (q.batchYear) req = req.eq("batch_year", Number(q.batchYear));
      if (q.status) req = req.eq("status", q.status);
      const from = (q.page - 1) * STUDENT_PAGE;
      const { data, error, count } = await req.order("roll_no").range(from, from + STUDENT_PAGE - 1);
      if (error) throw new Error(error.message);
      return { rows: (data ?? []) as StudentRecord[], total: count ?? 0 };
    },
  });
}

/** Distinct departments / batch years / sections in the roster (filters and eligibility pickers). */
export function useStudentFacets(orgId: string) {
  return useQuery({
    queryKey: ["b2b-college", "facets", orgId],
    staleTime: 60_000,
    // Distinct values computed in the database (b2b_student_facets): reading rows would stop at 1000 students.
    queryFn: () => rows<{ departments: string[]; batchYears: number[]; sections: string[] }>(
      b2bDb.rpc("b2b_student_facets", { _org_id: orgId })),
  });
}

export function useStudentStatusCounts(orgId: string) {
  return useQuery({
    queryKey: ["b2b-college", "student-status-counts", orgId],
    queryFn: async () => {
      // One head-only count per status: fetching rows would stop at PostgREST's max_rows (1000) and undercount.
      const statuses = Object.keys(STATUS_TEXT) as StudentStatus[];
      const totals = await Promise.all(statuses.map(async (s) => {
        const { count, error } = await b2bDb.from("students").select("*", { count: "exact", head: true }).eq("org_id", orgId).eq("status", s);
        if (error) throw new Error(error.message);
        return count ?? 0;
      }));
      return Object.fromEntries(statuses.map((s, i) => [s, totals[i]])) as Record<StudentStatus, number>;
    },
  });
}

export function useDrives(orgId: string) {
  return useQuery({
    queryKey: ["b2b-college", "drives", orgId],
    queryFn: () => rows<DriveRecord[]>(b2bDb.from("drives").select("*").eq("org_id", orgId).order("created_at", { ascending: false })),
  });
}

export function useDrive(driveId: string | undefined) {
  return useQuery({
    queryKey: ["b2b-college", "drive", driveId],
    enabled: !!driveId,
    queryFn: () => rows<DriveRecord>(b2bDb.from("drives").select("*").eq("id", driveId!).single()),
  });
}

export function useAssessments(orgId: string) {
  return useQuery({
    queryKey: ["b2b-college", "assessments", orgId],
    queryFn: () => rows<{ id: string; title: string; status: string; practice_enabled?: boolean }[]>(
      b2bDb.from("assessments").select("id, title, status, practice_enabled").eq("org_id", orgId).neq("status", "archived").order("title")),
  });
}

export function useInterviewModules(orgId: string) {
  return useQuery({
    queryKey: ["b2b-college", "modules", orgId],
    queryFn: () => rows<{ id: string; name: string; org_id: string | null }[]>(
      b2bDb.from("interview_modules").select("id, name, org_id").or(`org_id.eq.${orgId},org_id.is.null`).eq("is_active", true).order("name")),
  });
}

export function useCollegeLedger(orgId: string) {
  return useQuery({
    queryKey: ["b2b-college", "ledger", orgId],
    queryFn: () => rows<CreditLedgerRow[]>(b2bDb.from("org_credit_ledger").select("*").eq("org_id", orgId).order("created_at", { ascending: false }).limit(200)),
  });
}

export function useStaff(orgId: string) {
  return useQuery({
    queryKey: ["b2b-college", "staff", orgId],
    queryFn: async () => {
      const [members, invites] = await Promise.all([
        rows<StaffRow[]>(b2bDb.from("org_memberships").select("id, user_id, role, full_name, email, created_at").eq("org_id", orgId)
          .in("role", ["org_admin", "trainer"]).order("created_at")),
        rows<InviteRow[]>(b2bDb.from("org_invites").select("id, org_id, email, full_name, role, status, expires_at, email_sent_at, email_error, created_at")
          .eq("org_id", orgId).neq("role", "student").eq("status", "pending").order("created_at", { ascending: false })),
      ]);
      return { members, invites };
    },
  });
}

/** Credits consumed since the 1st of this month (ledger consumes minus refunds). */
export function usedThisMonth(ledger: CreditLedgerRow[], now = new Date()): number {
  const start = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  return ledger
    .filter((l) => new Date(l.created_at).getTime() >= start && (l.reason === "consume" || l.reason === "refund"))
    .reduce((sum, l) => sum - Number(l.delta), 0);
}

export function friendly(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/FORBIDDEN|permission|row-level security/i.test(m)) return "You don't have permission to do that.";
  if (/idx_students_roll|students_org_id_lower/i.test(m)) return "Another student already has that roll number.";
  if (/idx_students_email/i.test(m)) return "Another student already has that email.";
  return m;
}

export const fmtDateTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "–";
export const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "–";
export const numOrNull = (v: number | string | null | undefined) => (v === null || v === undefined || v === "" ? null : Number(v));
