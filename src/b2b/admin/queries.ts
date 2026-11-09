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

export interface OrgAlert {
  org_id: string; org_name: string;
  kind: "low_credits" | "plan_expired" | "plan_expiring" | "seats_full";
  detail: { credits?: number; threshold?: number; ends_at?: string; days_left?: number; seats_used?: number; seat_limit?: number };
}
/** R1.9: organisations that need attention (super_org_alerts, migration 0025). */
export function useOrgAlerts(enabled: boolean) {
  return useQuery({
    queryKey: ["b2b-v1", "org-alerts"],
    enabled,
    queryFn: () => rows<OrgAlert[]>(b2bDb.rpc("super_org_alerts")),
  });
}

export function alertText(a: OrgAlert): string {
  const d = a.detail;
  switch (a.kind) {
    case "low_credits": return `${num(d.credits)} credits left`;
    case "plan_expired": return `Plan ended ${fmtDate(d.ends_at ?? null)}; access is blocked`;
    case "plan_expiring": return `Plan ends in ${d.days_left} day${d.days_left === 1 ? "" : "s"} (${fmtDate(d.ends_at ?? null)})`;
    case "seats_full": return `${d.seats_used} of ${d.seat_limit} seats used`;
  }
}

export type CostGroup = "org" | "student" | "feature" | "day";
export interface CostRow {
  key: string | null; label: string; org_name: string | null; calls: number; input_tokens: number; output_tokens: number;
  cached_input_tokens: number; cache_hits: number; stt_seconds: number; tts_chars: number; cost_inr: number;
}
/** R6.1: AI cost grouped by college, student, feature or day (super_cost_breakdown, migration 0027). */
export function useCostBreakdown(by: CostGroup, days: number, enabled: boolean) {
  return useQuery({
    queryKey: ["b2b-v1", "cost-breakdown", by, days],
    enabled,
    queryFn: () => rows<CostRow[]>(b2bDb.rpc("super_cost_breakdown", {
      _by: by, _from: new Date(Date.now() - days * 86_400_000).toISOString(), _to: new Date().toISOString(),
    })),
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
