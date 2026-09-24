import { Loader2 } from "lucide-react";
import { useEvaluation } from "../hooks/useEvaluation";
import { EvaluationReport } from "./EvaluationReport";

/** Evaluates (or waits for) an interview's report, then renders it. */
export function ReportPanel({
  interviewId, passMark, moduleName, compact,
}: { interviewId: string; passMark: number; moduleName?: string; compact?: boolean }) {
  const s = useEvaluation(interviewId);
  if (s.phase === "working") {
    return (
      <div className="rounded-xl border border-border/60 p-6 text-center" role="status">
        <Loader2 className="h-6 w-6 animate-spin text-violet-400 mx-auto mb-2" />
        <p className="text-sm">Scoring your answers…</p>
        <p className="text-xs text-muted-foreground mt-1">This usually takes under a minute. You can leave this page — the report will be saved.</p>
      </div>
    );
  }
  if (s.phase !== "ready") return <p className="text-sm text-muted-foreground rounded-xl border border-border/60 p-4">{s.message}</p>;
  if (!s.evaluation.result) return <p className="text-sm text-muted-foreground">Report unavailable.</p>;
  return <EvaluationReport result={s.evaluation.result} metrics={s.evaluation.audio_metrics} passMark={passMark} moduleName={moduleName} compact={compact} />;
}
