// The candidate report body, shared by the staff report page and the public share page (view-only).
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Stat } from "../layout/V1Shell";
import type { CandidateReport } from "../../../supabase/functions/_shared/contracts/company";
import { STAGE_LABEL } from "../../../supabase/functions/_shared/company-logic";

const REC_TEXT: Record<string, string> = { strong: "Strong", good: "Good", borderline: "Borderline", not_yet: "Not yet" };
const BAND_TEXT: Record<string, string> = { high: "High integrity", medium: "Medium integrity", low: "Low integrity" };
const REVIEW_TEXT: Record<string, string> = { no_concern: "Reviewed: no concern", minor_concern: "Reviewed: minor concern", serious_concern: "Reviewed: serious concern" };

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="space-y-3"><h3 className="font-semibold">{title}</h3>{children}</section>;
}

export function ReportView({ report: r, staff }: { report: CandidateReport; staff: boolean }) {
  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="AI match score" value={r.matchScore ?? "—"} hint={r.recommendation ? `AI recommendation: ${REC_TEXT[r.recommendation]}` : "Not enough results yet"} />
        <Stat label="Coding" value={r.coding?.pct != null ? `${r.coding.pct}%` : "—"} hint={r.coding ? `${r.coding.passed}/${r.coding.total} tests passed` : "No coding test"} />
        <Stat label="Interview" value={r.interview?.overall ?? "—"} hint={r.interview ? (r.interview.evaluationStatus === "completed" ? "out of 100" : "Evaluation pending") : "No interview yet"} />
        <Stat label="Integrity" value={r.integrity.score ?? "—"} hint={r.integrity.band ? BAND_TEXT[r.integrity.band] : "No proctoring data"} />
      </div>
      <p className="rounded-md border border-border bg-muted/40 p-3 text-sm">
        AI does not pass or fail candidates; your team decides. Scores and flags are evidence for your review.
      </p>
      <p className="text-sm text-muted-foreground">Stage: {STAGE_LABEL[r.stage] ?? r.stage}{r.decision ? ` · Decision: ${r.decision}` : ""}</p>

      <Section title="Skills">
        {r.skills.length === 0 ? <p className="text-sm text-muted-foreground">No skills matrix on this role.</p> : (
          <>
            <ul className="space-y-2">
              {r.skills.map((s) => (
                <li key={s.skill} className="rounded-md border border-border p-3">
                  <div className="flex items-center gap-2">
                    <span className="font-medium flex-1">{s.skill}</span>
                    <Badge variant="secondary">{s.kind === "must" ? "Must-have" : "Nice-to-have"} · weight {s.weight}</Badge>
                    <span className="tabular-nums w-14 text-right">{s.score ?? "—"}</span>
                  </div>
                  {s.evidence.length > 0
                    ? <ul className="mt-1 text-xs text-muted-foreground list-disc pl-5">{s.evidence.map((e) => <li key={e}>{e}</li>)}</ul>
                    : <p className="mt-1 text-xs text-muted-foreground">No direct evidence yet.</p>}
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">Evidence covers {Math.round(r.coverage * 100)}% of the skill weight.</p>
          </>
        )}
      </Section>

      <Section title="Coding test">
        {!r.coding ? <p className="text-sm text-muted-foreground">No coding results yet.</p> : (
          <div className="space-y-3">
            <p className="text-sm">
              Score {r.coding.score ?? "—"} / {r.coding.maxScore ?? "—"} · {r.coding.passed}/{r.coding.total} tests passed · status {r.coding.status}
              {r.coding.pending ? " · grading in progress" : ""}
            </p>
            {r.coding.questions.map((q, i) => (
              <div key={i} className="rounded-md border border-border">
                <div className="flex flex-wrap gap-2 px-3 py-2 text-sm border-b border-border">
                  <span className="font-medium flex-1">{q.title}</span>
                  <span>{q.language ?? "—"}</span>
                  <span>{q.passed ?? 0}/{q.total ?? 0} tests</span>
                </div>
                <pre aria-label={`Submitted code for ${q.title}`} className="max-h-80 overflow-auto p-3 text-xs bg-muted/30"><code>{q.code ?? "No code submitted."}</code></pre>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="AI interview">
        {!r.interview ? <p className="text-sm text-muted-foreground">No interview yet.</p> : (
          <div className="space-y-3">
            <p className="text-sm">
              Status {r.interview.status}{r.interview.overall != null ? ` · overall ${r.interview.overall}/100` : ""}
              {r.interview.evaluationStatus && r.interview.evaluationStatus !== "completed" ? " · evaluation pending" : ""}
            </p>
            {r.interview.evidence.length > 0 && (
              <ul className="space-y-2">
                {r.interview.evidence.map((e) => (
                  <li key={e.label} className="text-sm">
                    <span className="font-medium capitalize">{e.label}</span>: {e.score ?? "not enough data"}{e.reason ? ` · ${e.reason}` : ""}
                    {e.quotes.length > 0 && <ul className="text-xs text-muted-foreground list-disc pl-5">{e.quotes.map((q) => <li key={q}>“{q}”</li>)}</ul>}
                  </li>
                ))}
              </ul>
            )}
            {r.interview.transcript.length > 0 ? (
              <details>
                <summary className="cursor-pointer text-sm">Transcript ({r.interview.transcript.length} turns)</summary>
                <ol className="mt-2 space-y-2 text-sm">
                  {r.interview.transcript.map((t, i) => (
                    <li key={i}><span className="font-medium">{t.role === "interviewer" ? "Interviewer" : "Candidate"}:</span> {t.content}</li>
                  ))}
                </ol>
              </details>
            ) : <p className="text-sm text-muted-foreground">No transcript.</p>}
          </div>
        )}
      </Section>

      <Section title="Integrity">
        {r.integrity.sessions.length === 0 ? <p className="text-sm text-muted-foreground">No proctoring sessions.</p> : (
          <ul className="space-y-2 text-sm">
            {r.integrity.sessions.map((s, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2">
                <span className="capitalize">{s.kind}</span>: score {s.score ?? "pending"} {s.band && <Badge variant={s.band === "low" ? "destructive" : "secondary"}>{BAND_TEXT[s.band]}</Badge>}
                · {s.flags} flag{s.flags === 1 ? "" : "s"}{s.review ? ` · ${REVIEW_TEXT[s.review] ?? s.review}` : ""}
                {staff && s.sessionId && <a className="underline" href={`/proctor/review/${s.sessionId}`}>Review timeline and evidence</a>}
              </li>
            ))}
          </ul>
        )}
        {!staff && <p className="text-xs text-muted-foreground">This shared view shows integrity scores only; evidence images are not included.</p>}
      </Section>
    </div>
  );
}
