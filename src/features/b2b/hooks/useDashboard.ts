import { useQuery } from "@tanstack/react-query";
import { b2bDb } from "../lib/db";
import type { DashEval, RosterStudent } from "../lib/dashboard";
import type { Batch } from "../types";
import type { EvaluationRow } from "../lib/api";

interface MemberRow { user_id: string; full_name: string | null; roll_no: string | null; email: string | null; batch_id: string | null }

async function loadRoster(orgId: string): Promise<{ roster: RosterStudent[]; batches: Batch[] }> {
  const [{ data: members, error }, { data: batches, error: bErr }] = await Promise.all([
    b2bDb.from("org_memberships").select("user_id, full_name, roll_no, email, batch_id").eq("org_id", orgId).eq("role", "student").order("roll_no"),
    b2bDb.from("batches").select("*").eq("org_id", orgId).order("name"),
  ]);
  if (error) throw error;
  if (bErr) throw bErr;
  const byId = new Map((batches as Batch[]).map((b) => [b.id, b]));
  return {
    batches: batches as Batch[],
    roster: (members as MemberRow[]).map((m) => ({
      ...m,
      batch_name: m.batch_id ? byId.get(m.batch_id)?.name ?? null : null,
      department: m.batch_id ? byId.get(m.batch_id)?.department ?? null : null,
    })),
  };
}

/** Roster + compact evaluation rows for the batch dashboard (plan-gated server-side). */
export function useDashboardData(orgId: string | undefined) {
  return useQuery({
    queryKey: ["b2b", "dashboard", orgId],
    enabled: !!orgId,
    staleTime: 30_000,
    retry: (n, e) => !/PLAN_FEATURE|FORBIDDEN/.test(String((e as { message?: string })?.message)) && n < 2,
    queryFn: async () => {
      const [{ roster, batches }, { data, error }] = await Promise.all([
        loadRoster(orgId!),
        b2bDb.rpc("org_dashboard_evaluations", { _org_id: orgId }),
      ]);
      if (error) throw error;
      const evals = ((data ?? []) as Array<Omit<DashEval, "overall_score" | "pass_threshold"> & { overall_score: string | number | null; pass_threshold: string | number }>)
        .map((e) => ({ ...e, overall_score: e.overall_score === null ? null : Number(e.overall_score), pass_threshold: Number(e.pass_threshold) }));
      return { roster, batches, evals: evals as DashEval[] };
    },
  });
}

export interface StudentInterviewRow {
  id: string; module_id: string; status: string; started_at: string; completed_at: string | null; end_reason: string | null;
  module_spec: { name: string; pass_threshold: number; topics: string[] };
}

/** Everything the staff drill-down needs for one student (RLS: staff of the org). Works on every plan. */
export function useStudentDetail(orgId: string | undefined, userId: string | undefined) {
  return useQuery({
    queryKey: ["b2b", "student-detail", orgId, userId],
    enabled: !!orgId && !!userId,
    queryFn: async () => {
      const [{ data: member, error: mErr }, { data: ivs, error: iErr }, { data: evs, error: eErr }, { batches }] = await Promise.all([
        b2bDb.from("org_memberships").select("user_id, full_name, roll_no, email, batch_id").eq("org_id", orgId!).eq("user_id", userId!).maybeSingle(),
        b2bDb.from("b2b_interviews").select("id, module_id, status, started_at, completed_at, end_reason, module_spec")
          .eq("org_id", orgId!).eq("user_id", userId!).neq("status", "cancelled").order("started_at"),
        b2bDb.from("b2b_latest_evaluations").select("id, interview_id, evaluator_version, status, result, audio_metrics, overall_score, readiness_level, primary_gap, completed_at")
          .eq("org_id", orgId!).eq("user_id", userId!),
        loadRoster(orgId!),
      ]);
      if (mErr) throw mErr;
      if (iErr) throw iErr;
      if (eErr) throw eErr;
      const batch = member?.batch_id ? batches.find((b) => b.id === member.batch_id) : undefined;
      return {
        student: member ? { ...(member as MemberRow), batch_name: batch?.name ?? null, department: batch?.department ?? null } as RosterStudent : null,
        interviews: (ivs ?? []) as StudentInterviewRow[],
        evaluations: new Map(((evs ?? []) as EvaluationRow[]).map((e) => [e.interview_id, { ...e, overall_score: e.overall_score === null ? null : Number(e.overall_score) }])),
      };
    },
  });
}

export function useInterviewTranscript(interviewId: string | null) {
  return useQuery({
    queryKey: ["b2b", "transcript", interviewId],
    enabled: !!interviewId,
    queryFn: async () => {
      const { data, error } = await b2bDb.from("b2b_interview_turns").select("turn_index, role, content, topic, difficulty").eq("interview_id", interviewId!).order("turn_index");
      if (error) throw error;
      return ((data ?? []) as Array<{ turn_index: number; role: "interviewer" | "student"; content: string; topic: string | null; difficulty: string | null }>)
        .sort((a, b) => a.turn_index - b.turn_index || (a.role === "interviewer" ? -1 : 1));
    },
  });
}
