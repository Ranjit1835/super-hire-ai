// Student-facing reads: SECURITY DEFINER functions scoped to auth.uid() (b2b_my_drives, b2b_my_practice).
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { b2bDb } from "@/features/b2b/lib/db";

export interface MyDrive {
  drive_id: string; org_id: string; org_name: string; name: string; description: string | null;
  window_start: string | null; window_end: string | null; proctoring_policy: string; results_release: "immediate" | "manual" | "never";
  has_assessment: boolean; has_interview: boolean; resume_task: boolean;
  status: "assigned" | "in_progress" | "completed" | "absent";
  attempt_status: string | null;
  results_visible: boolean;
  results: { coding: number | null; mcq: number | null; assessment: number | null; interview: number | null; overall: number | null } | null;
}
export interface MyPractice {
  org_id: string; org_name: string; credits_balance: number;
  /** state: one practice run per test (migration 0020); "done" can't be started again. */
  assessments: { id: string; title: string; duration_min: number; state?: "available" | "in_progress" | "done" }[];
}

async function rpc<T>(fn: string): Promise<T> {
  const { data, error } = await b2bDb.rpc(fn);
  if (error) throw new Error(error.message);
  return data as T;
}

export function useMyDrives() {
  const { user } = useAuth();
  return useQuery({ queryKey: ["b2b-student", "drives", user?.id], enabled: !!user, queryFn: () => rpc<MyDrive[]>("b2b_my_drives") });
}
export function useMyPractice() {
  const { user } = useAuth();
  return useQuery({ queryKey: ["b2b-student", "practice", user?.id], enabled: !!user, queryFn: () => rpc<MyPractice[]>("b2b_my_practice") });
}

export type WindowState = "upcoming" | "open" | "closed";
export function windowState(d: Pick<MyDrive, "window_start" | "window_end">, now = new Date()): WindowState {
  if (d.window_start && new Date(d.window_start) > now) return "upcoming";
  if (d.window_end && new Date(d.window_end) <= now) return "closed";
  return "open";
}

export const STATUS_TEXT: Record<MyDrive["status"], string> = {
  assigned: "Not started", in_progress: "In progress", completed: "Finished", absent: "Missed",
};

export const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : null;

export function windowText(d: Pick<MyDrive, "window_start" | "window_end">): string {
  const s = when(d.window_start);
  const e = when(d.window_end);
  if (s && e) return `${s} – ${e}`;
  if (s) return `Opens ${s}`;
  if (e) return `Closes ${e}`;
  return "Open now";
}
