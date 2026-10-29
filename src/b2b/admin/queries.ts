import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { b2bDb } from "@/features/b2b/lib/db";
import { OrgUsageRow } from "../../../supabase/functions/_shared/contracts/admin";
import type { CreditLedgerRow, InviteRow, OrgRow, PlanRow } from "../types";

async function rows<T>(p: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data as T;
}

export function useIsSuperAdmin() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["b2b-v1", "is-super", user?.id],
    enabled: !!user,
    staleTime: 60_000,
    queryFn: () => rows<boolean>(b2bDb.rpc("is_super_admin")),
  });
}

export function useOrgs(enabled: boolean) {
  return useQuery({
    queryKey: ["b2b-v1", "orgs"],
    enabled,
    // super_orgs(): full rows incl. plan_id, which signed-in users can't select directly (R3.1, migration 0016).
    queryFn: () => rows<OrgRow[]>(b2bDb.rpc("super_orgs")),
  });
}

export function usePlans(enabled: boolean) {
  return useQuery({
    queryKey: ["b2b-v1", "plans"],
    enabled,
    staleTime: 5 * 60_000,
    queryFn: () => rows<PlanRow[]>(b2bDb.from("plans").select("*").eq("is_active", true).order("price_inr_per_student")),
  });
}

export function useStaffInvites(enabled: boolean) {
  return useQuery({
    queryKey: ["b2b-v1", "staff-invites"],
    enabled,
    queryFn: () => rows<InviteRow[]>(
      b2bDb.from("org_invites").select("id, org_id, email, full_name, role, status, expires_at, email_sent_at, email_error, created_at")
        .neq("role", "student").eq("status", "pending").order("created_at", { ascending: false })),
  });
}

export function useLedger(orgId: string | null) {
  return useQuery({
    queryKey: ["b2b-v1", "ledger", orgId],
    enabled: !!orgId,
    queryFn: () => rows<CreditLedgerRow[]>(
      b2bDb.from("org_credit_ledger").select("*").eq("org_id", orgId!).order("created_at", { ascending: false }).limit(50)),
  });
}

export function useOrgUsage(enabled: boolean) {
  return useQuery({
    queryKey: ["b2b-v1", "usage"],
    enabled,
    queryFn: async () => OrgUsageRow.array().parse(await rows<unknown[]>(b2bDb.rpc("super_org_usage"))),
  });
}

export async function adjustCredits(orgId: string, delta: number, reason: "grant" | "top_up" | "adjust", note: string | null) {
  return rows<number>(b2bDb.rpc("super_adjust_credits", { _org_id: orgId, _delta: delta, _reason: reason, _note: note }));
}

export const ORG_TYPE_LABEL: Record<string, string> = { college: "College", company: "Company", coaching_institute: "Coaching institute" };
export const ROLE_LABEL: Record<string, string> = {
  org_admin: "Admin", trainer: "Trainer", recruiter: "Recruiter", hiring_manager: "Hiring manager", student: "Student",
};

export function friendly(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/FORBIDDEN|permission/i.test(m)) return "You don't have permission to do that.";
  if (/INSUFFICIENT_CREDITS/.test(m)) return "That would make the credit balance negative.";
  return m;
}

export const inr = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
export const num = (v: string | number | null | undefined) => (v === null || v === undefined ? 0 : Number(v));
export const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "–";
