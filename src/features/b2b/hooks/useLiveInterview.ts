import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { b2bDb } from "../lib/db";

export interface InterviewSummary {
  id: string;
  module_id: string;
  status: "in_progress" | "completed" | "abandoned" | "cancelled";
  end_reason: string | null;
  started_at: string;
  completed_at: string | null;
  module_name: string;
  turn_count: number;
}

/** The student's own interviews (RLS: user_id = auth.uid()), newest first. */
export function useMyInterviews(orgId: string | undefined) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["b2b", "my-interviews", user?.id, orgId],
    enabled: !!user && !!orgId,
    staleTime: 10_000,
    queryFn: async (): Promise<InterviewSummary[]> => {
      const { data, error } = await b2bDb
        .from("b2b_interviews")
        .select("id, module_id, status, end_reason, started_at, completed_at, module_name:module_spec->>name, turn_count:state->turn_count")
        .eq("user_id", user!.id)
        .eq("org_id", orgId!)
        .neq("status", "cancelled")
        .order("started_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as unknown as InterviewSummary[];
    },
  });
}
