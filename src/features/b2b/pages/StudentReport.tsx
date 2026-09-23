import { Link, Navigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { B2BShell, CenteredSpinner, EmptyState } from "../components/B2BShell";
import { ReportPanel } from "../components/ReportPanel";
import { useMyMemberships } from "../hooks/useB2B";
import { b2bDb } from "../lib/db";
import { formatDate } from "../lib/format";
import type { ModuleSpec } from "../lib/shared";

interface Row { id: string; module_id: string; status: string; started_at: string; module_spec: ModuleSpec }
interface Turn { turn_index: number; role: "interviewer" | "student"; content: string }

/** /learn/report/:interviewId — the student's own report + transcript (RLS: own rows only). */
export default function StudentReport() {
  const { interviewId = "" } = useParams();
  const memberships = useMyMemberships();
  const student = memberships.data?.find((m) => m.role === "student");
  const q = useQuery({
    queryKey: ["b2b", "report", interviewId],
    queryFn: async () => {
      const [{ data: iv, error }, { data: turns, error: tErr }] = await Promise.all([
        b2bDb.from("b2b_interviews").select("id, module_id, status, started_at, module_spec").eq("id", interviewId).maybeSingle(),
        b2bDb.from("b2b_interview_turns").select("turn_index, role, content").eq("interview_id", interviewId).order("turn_index"),
      ]);
      if (error) throw error;
      if (tErr) throw tErr;
      const ordered = ((turns ?? []) as Turn[]).sort((a, b) => a.turn_index - b.turn_index || (a.role === "interviewer" ? -1 : 1));
      return { iv: iv as Row | null, turns: ordered };
    },
  });

  if (memberships.isLoading || q.isLoading) return <CenteredSpinner />;
  if (!student) return <Navigate to="/dashboard" replace />;
  const org = student.organizations;
  const iv = q.data?.iv;

  return (
    <B2BShell title={org.name} subtitle="Interview report" logoUrl={org.logo_url} isDemo={org.is_demo}>
      <div className="max-w-3xl mx-auto space-y-6">
        <Link to="/learn" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Practice</Link>
        {!iv ? (
          <EmptyState title="Report not found" />
        ) : iv.status === "in_progress" ? (
          <EmptyState title="This interview is still in progress">
            <Link className="underline text-sm" to={`/learn/interview/${iv.module_id}`}>Resume it</Link>
          </EmptyState>
        ) : (
          <>
            <div>
              <h2 className="text-xl font-semibold">{iv.module_spec.name}</h2>
              <p className="text-sm text-muted-foreground">{formatDate(iv.started_at)}</p>
            </div>
            <ReportPanel interviewId={iv.id} passMark={iv.module_spec.pass_threshold} moduleName={iv.module_spec.name} />
            <details className="rounded-lg border border-border/60">
              <summary className="px-4 py-3 cursor-pointer text-sm font-medium">Full transcript</summary>
              <ol className="px-4 pb-4 space-y-3">
                {(q.data?.turns ?? []).map((t) => (
                  <li key={`${t.turn_index}-${t.role}`} className="text-sm">
                    <span className={t.role === "interviewer" ? "text-violet-300" : "text-emerald-300"}>
                      {t.role === "interviewer" ? `Q${t.turn_index}` : "You"}:
                    </span>{" "}
                    <span className={t.role === "student" ? "text-foreground" : "text-muted-foreground"}>{t.content}</span>
                  </li>
                ))}
              </ol>
              <p className="px-4 pb-4 text-xs text-muted-foreground">Your answers are shown as the speech recogniser heard them.</p>
            </details>
          </>
        )}
      </div>
    </B2BShell>
  );
}
