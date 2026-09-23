import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Download, Loader2 } from "lucide-react";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid, ReferenceLine } from "recharts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { CenteredSpinner, EmptyState } from "../components/B2BShell";
import { EvaluationReport } from "../components/EvaluationReport";
import { useOrgContext } from "../components/OrgContext";
import { useInterviewTranscript, useStudentDetail } from "../hooks/useDashboard";
import { formatDate } from "../lib/format";
import { READINESS_LABEL, READINESS_STYLE } from "../lib/report-style";
import type { DashEval } from "../lib/dashboard";

/** /org/:orgId/students/:userId — staff drill-down (available on every plan). */
export default function StudentDetail() {
  const { org } = useOrgContext();
  const { userId } = useParams();
  const q = useStudentDetail(org.id, userId);
  const { toast } = useToast();
  const [selected, setSelected] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);

  const scored = useMemo(
    () => (q.data?.interviews ?? []).filter((i) => q.data!.evaluations.has(i.id)),
    [q.data],
  );
  const chosenId = selected ?? scored.at(-1)?.id ?? q.data?.interviews.at(-1)?.id ?? null;
  const chosen = q.data?.interviews.find((i) => i.id === chosenId) ?? null;
  const chosenEval = chosen ? q.data?.evaluations.get(chosen.id) : undefined;
  const transcript = useInterviewTranscript(chosenId);

  const chart = scored.map((i) => ({
    date: new Date(i.started_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" }),
    score: q.data!.evaluations.get(i.id)!.overall_score,
    module: i.module_spec.name,
  }));

  const downloadPdf = async () => {
    if (!q.data?.student) return;
    setPdfBusy(true);
    try {
      const { buildStudentPdf, fetchLogo } = await import("../lib/export-pdf");
      const { downloadBlob } = await import("../lib/export-xlsx");
      const latestIv = scored.at(-1);
      const latestEval = latestIv ? q.data.evaluations.get(latestIv.id) : undefined;
      const rows: DashEval[] = scored.map((i) => {
        const e = q.data!.evaluations.get(i.id)!;
        return {
          interview_id: i.id, user_id: userId!, module_id: i.module_id, module_name: i.module_spec.name, module_type: "",
          pass_threshold: i.module_spec.pass_threshold, started_at: i.started_at, completed_at: i.completed_at ?? "",
          overall_score: e.overall_score, readiness_level: e.readiness_level, primary_gap: e.primary_gap, dimensions: {}, per_topic: {},
        };
      });
      const bytes = await buildStudentPdf({
        orgName: org.name,
        isDemo: org.is_demo,
        logo: await fetchLogo(org.logo_url),
        student: q.data.student,
        interviews: rows,
        latest: latestIv && latestEval?.result ? {
          result: latestEval.result, metrics: latestEval.audio_metrics, module_name: latestIv.module_spec.name,
          date: formatDate(latestIv.started_at), pass: latestIv.module_spec.pass_threshold,
        } : null,
      });
      const who = (q.data.student.roll_no || q.data.student.full_name || "student").replace(/[^\w-]+/g, "_");
      downloadBlob(`${org.slug}-${who}-report.pdf`, bytes, "application/pdf");
    } catch (e) {
      toast({ title: "Couldn't create the PDF", description: (e as Error).message, variant: "destructive" });
    } finally {
      setPdfBusy(false);
    }
  };

  if (q.isLoading) return <CenteredSpinner />;
  if (!q.data?.student) return <EmptyState title="Student not found" body="They may have been removed from this institution." />;
  const s = q.data.student;

  return (
    <div className="space-y-6">
      <Link to={`/org/${org.id}/dashboard`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Dashboard
      </Link>

      <div className="flex flex-wrap items-start gap-4">
        <div className="flex-1 min-w-0">
          <h2 className="text-xl font-semibold">{s.full_name ?? s.email}</h2>
          <p className="text-sm text-muted-foreground">{[s.roll_no, s.batch_name, s.department, s.email].filter(Boolean).join(" · ")}</p>
        </div>
        <Button onClick={downloadPdf} disabled={pdfBusy || !scored.length} variant="secondary">
          {pdfBusy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Download className="h-4 w-4 mr-1" />} PDF report
        </Button>
      </div>

      {chart.length >= 2 && (
        <div className="rounded-lg border border-border/60 bg-card/40 p-4">
          <p className="text-xs text-muted-foreground mb-2">Overall score over time</p>
          <div className="h-40">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chart} margin={{ left: -20, right: 8, top: 4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#9ca3af" }} />
                <YAxis domain={[0, 10]} tick={{ fontSize: 11, fill: "#9ca3af" }} />
                <ReferenceLine y={chosen?.module_spec.pass_threshold ?? 6} stroke="rgba(52,211,153,0.4)" strokeDasharray="4 4" />
                <Tooltip formatter={(v: number, _n, p) => [v, (p.payload as { module: string }).module]} contentStyle={{ background: "#111", border: "1px solid #333" }} />
                <Line type="monotone" dataKey="score" stroke="#a78bfa" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <section>
        <h3 className="font-semibold mb-2">Interviews</h3>
        {!q.data.interviews.length ? (
          <EmptyState title="No interviews yet" />
        ) : (
          <ul className="rounded-lg border border-border/60 divide-y divide-border/60">
            {[...q.data.interviews].reverse().map((i) => {
              const e = q.data!.evaluations.get(i.id);
              return (
                <li key={i.id}>
                  <button
                    onClick={() => setSelected(i.id)}
                    aria-current={i.id === chosenId}
                    className={cn("w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-white/5", i.id === chosenId && "bg-white/[0.06]")}
                  >
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm truncate">{i.module_spec.name}</span>
                      <span className="block text-xs text-muted-foreground">{formatDate(i.started_at)}{i.status !== "completed" ? ` · ${i.status.replace("_", " ")}` : ""}</span>
                    </span>
                    {e ? (
                      <>
                        <span className="text-sm tabular-nums">{e.overall_score ?? "—"}/10</span>
                        {e.readiness_level && <Badge variant="outline" className={READINESS_STYLE[e.readiness_level]}>{READINESS_LABEL[e.readiness_level]}</Badge>}
                      </>
                    ) : (
                      <span className="text-xs text-muted-foreground">{i.status === "in_progress" ? "In progress" : "Not scored yet"}</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {chosen && (
        <section className="space-y-4">
          <h3 className="font-semibold">{chosen.module_spec.name} · {formatDate(chosen.started_at)}</h3>
          {chosenEval?.result ? (
            <EvaluationReport result={chosenEval.result} metrics={chosenEval.audio_metrics} passMark={chosen.module_spec.pass_threshold} audience="staff" />
          ) : (
            <p className="text-sm text-muted-foreground">This interview hasn't been scored yet.</p>
          )}
          <details className="rounded-lg border border-border/60">
            <summary className="px-4 py-3 cursor-pointer text-sm font-medium">Transcript</summary>
            {transcript.isLoading ? <CenteredSpinner /> : (
              <ol className="px-4 pb-4 space-y-2">
                {(transcript.data ?? []).map((t) => (
                  <li key={`${t.turn_index}-${t.role}`} className="text-sm">
                    <span className={t.role === "interviewer" ? "text-violet-300" : "text-emerald-300"}>
                      {t.role === "interviewer" ? `Q${t.turn_index}` : "A"}
                      {t.role === "interviewer" && t.topic ? <span className="text-muted-foreground"> [{t.topic}{t.difficulty ? ` · ${t.difficulty}` : ""}]</span> : null}:
                    </span>{" "}
                    <span className={t.role === "student" ? "" : "text-muted-foreground"}>{t.content}</span>
                  </li>
                ))}
              </ol>
            )}
          </details>
        </section>
      )}
    </div>
  );
}
