import { Quote, Target, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { DIMENSIONS, DIMENSION_LABEL, type AudioMetrics, type EvaluationResult, type ScoredItem } from "../lib/shared";
import { READINESS_LABEL, READINESS_STYLE, scoreTone } from "../lib/report-style";

function ScoreRow({ label, item, pass }: { label: string; item: ScoredItem; pass: number }) {
  const numeric = typeof item.score === "number";
  return (
    <details className="group rounded-lg border border-border/60 px-4 py-3 open:bg-white/[0.02]">
      <summary className="flex items-center gap-3 cursor-pointer list-none">
        <span className="text-sm flex-1">{label}</span>
        {numeric ? (
          <>
            <div className="w-28 h-1.5 rounded-full bg-white/10 overflow-hidden" aria-hidden>
              <div className={cn("h-full rounded-full", scoreTone(item.score as number, pass))} style={{ width: `${(item.score as number) * 10}%` }} />
            </div>
            <span className="text-sm tabular-nums w-10 text-right">{item.score}</span>
          </>
        ) : (
          <span className="text-xs text-muted-foreground">Not enough to judge</span>
        )}
      </summary>
      <div className="mt-3 space-y-2 text-sm">
        <p className="text-muted-foreground">{item.reason}</p>
        {item.evidence.map((q) => (
          <blockquote key={q} className="flex gap-2 text-xs italic text-foreground/80 border-l-2 border-violet-400/40 pl-3">
            <Quote className="h-3 w-3 shrink-0 mt-0.5 text-violet-300" />“{q}”
          </blockquote>
        ))}
      </div>
    </details>
  );
}

function seconds(ms: number | null) {
  return ms === null ? "—" : `${(ms / 1000).toFixed(1)} s`;
}

export function AudioMetricsPanel({ m }: { m: AudioMetrics }) {
  const rows: Array<[string, string, string]> = [
    ["Speaking rate", m.words_per_minute === null ? "—" : `${m.words_per_minute} words/min`, "Clear interview speech is usually 110–160."],
    ["Pause before answering", `avg ${seconds(m.avg_pause_before_answer_ms)} · longest ${seconds(m.max_pause_before_answer_ms)}`, "A short pause to think is fine; long pauses on every question read as hesitation."],
    ["Longest pause mid-answer", seconds(m.max_pause_within_answer_ms), ""],
    ["Filler words", `${m.fillers_total}${m.fillers_per_100_words !== null ? ` (${m.fillers_per_100_words} per 100 words)` : ""}`,
      Object.entries(m.filler_counts).filter(([, n]) => n > 0).map(([f, n]) => `${f} ×${n}`).join(", ") || "None detected"],
    ["Average answer length", m.avg_answer_words === null ? "—" : `${m.avg_answer_words} words`,
      (["beginner", "intermediate", "advanced"] as const).filter((d) => m.avg_answer_words_by_difficulty[d] !== null)
        .map((d) => `${d} ${m.avg_answer_words_by_difficulty[d]}`).join(" · ")],
  ];
  return (
    <div className="rounded-lg border border-border/60 divide-y divide-border/60">
      {rows.map(([k, v, hint]) => (
        <div key={k} className="px-4 py-2.5 grid sm:grid-cols-[180px,1fr] gap-x-4 gap-y-0.5">
          <span className="text-sm text-muted-foreground">{k}</span>
          <div>
            <span className="text-sm tabular-nums">{v}</span>
            {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
          </div>
        </div>
      ))}
      {m.notes.length > 0 && <p className="px-4 py-2.5 text-xs text-muted-foreground">{m.notes.join(" ")}</p>}
    </div>
  );
}

export function EvaluationReport({
  result, metrics, passMark, moduleName,
}: { result: EvaluationResult; metrics: AudioMetrics | null; passMark: number; moduleName?: string }) {
  const r = result;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-4">
        <div className={cn("rounded-xl border px-4 py-3", READINESS_STYLE[r.readiness_level])}>
          <p className="text-xs opacity-80">Readiness{moduleName ? ` · ${moduleName}` : ""}</p>
          <p className="text-lg font-semibold">{READINESS_LABEL[r.readiness_level]}</p>
        </div>
        <div className="rounded-xl border border-border/60 px-4 py-3">
          <p className="text-xs text-muted-foreground">Overall</p>
          <p className="text-lg font-semibold tabular-nums">{r.overall_score ?? "—"}<span className="text-sm text-muted-foreground"> / 10</span></p>
        </div>
        {r.passed !== null && (
          <Badge variant="outline" className={r.passed ? "border-emerald-500/40 text-emerald-300" : "border-border text-muted-foreground"}>
            {r.passed ? `Above pass mark (${passMark})` : `Pass mark ${passMark}`}
          </Badge>
        )}
      </div>

      <div className="rounded-xl border border-violet-500/25 bg-violet-500/5 p-4 space-y-3">
        <p className="text-sm flex gap-2"><Target className="h-4 w-4 mt-0.5 text-violet-300 shrink-0" /><span><strong>Main gap:</strong> {r.primary_gap}</span></p>
        <div className="text-sm flex gap-2">
          <TrendingUp className="h-4 w-4 mt-0.5 text-violet-300 shrink-0" />
          <div>
            <strong>Practise next:</strong>
            <ul className="list-disc pl-4 mt-1 space-y-0.5">{r.recommended_focus.map((f) => <li key={f}>{f}</li>)}</ul>
          </div>
        </div>
      </div>

      <section>
        <h3 className="font-semibold mb-2">Skills</h3>
        <p className="text-xs text-muted-foreground mb-2">Tap a skill to see why, with quotes from your answers.</p>
        <div className="space-y-2">
          {DIMENSIONS.map((d) => <ScoreRow key={d} label={DIMENSION_LABEL[d]} item={r.dimensions[d]} pass={passMark} />)}
        </div>
      </section>

      <section>
        <h3 className="font-semibold mb-2">Topics</h3>
        <div className="space-y-2">
          {Object.entries(r.per_topic).map(([t, item]) => <ScoreRow key={t} label={t} item={item} pass={passMark} />)}
        </div>
      </section>

      {metrics && (
        <section>
          <h3 className="font-semibold mb-2">How you spoke</h3>
          <AudioMetricsPanel m={metrics} />
        </section>
      )}
    </div>
  );
}
