// The candidate report body, shared by the staff report page and the public share page (view-only). One
// synchronized evidence view: a scorebug for the state, skill evidence as stat strips, the submitted code in a
// mono panel, the interview transcript with its evaluation, and the integrity timeline.
import type { ReactNode } from "react";
import { Chip, Numeral, StatStrip } from "../ui/broadcast";
import type { CandidateReport } from "../../../supabase/functions/_shared/contracts/company";
import { STAGE_LABEL } from "../../../supabase/functions/_shared/company-logic";

const REC_TEXT: Record<string, string> = { strong: "Strong", good: "Good", borderline: "Borderline", not_yet: "Not yet" };
const BAND_TEXT: Record<string, string> = { high: "High", medium: "Medium", low: "Low" };
const REVIEW_TEXT: Record<string, string> = { no_concern: "Reviewed: no concern", minor_concern: "Reviewed: minor concern", serious_concern: "Reviewed: serious concern" };
const DECISION_TEXT: Record<string, string> = { advance: "Advance", hold: "Hold", reject: "Reject", hire: "Hire" };
const STAGE_TONE: Record<string, "muted" | "blue" | "gold"> = {
  invited: "muted", in_progress: "blue", completed: "gold", shortlisted: "muted", rejected: "muted", hired: "muted", withdrawn: "muted",
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="space-y-3 hr-rule-t pt-6"><h3 className="hr-display text-lg">{title}</h3>{children}</section>;
}

export function ReportView({ report: r, staff }: { report: CandidateReport; staff: boolean }) {
  return (
    <div className="space-y-6">
      {/* Decision D1: the report opens with the person (name is on the page header above) on an unframed header,
          the role, and the AI suggestion as a headline numeral; never a framed stat row. */}
      <header className="space-y-2.5">
        <div className="flex flex-wrap items-center gap-2.5">
          <Chip tone={STAGE_TONE[r.stage] ?? "muted"}>{STAGE_LABEL[r.stage] ?? r.stage}</Chip>
          {r.decision && <Chip tone="muted">Decision: {DECISION_TEXT[r.decision] ?? r.decision}</Chip>}
        </div>
        <p className="text-sm text-[var(--hr-muted)]">{r.role.title} · {r.role.orgName}</p>
        <div>
          <p className="hr-label">AI suggestion</p>
          <p className="text-[56px] leading-none"><Numeral value={r.matchScore ?? "–"} tone="gold" /></p>
          <p className="text-xs text-[var(--hr-muted)]">{r.recommendation ? `AI recommendation: ${REC_TEXT[r.recommendation]}` : "Not enough results yet"}</p>
        </div>
      </header>

      <p className="hr-rule-b pb-5 text-sm text-[var(--hr-muted)]">
        AI does not pass or fail candidates; your team decides. Scores and flags are evidence for your review.
      </p>

      <section className="space-y-3">
        <h3 className="hr-display text-lg">Skills</h3>
        {r.skills.length === 0 ? <p className="text-sm text-[var(--hr-muted)]">No skills matrix on this role.</p> : (
          <>
            <ul className="space-y-2">
              {r.skills.map((s) => (
                <li key={s.skill} className="hr-rule-b pb-3">
                  <div className="flex items-center gap-3">
                    <span className="font-medium flex-1">{s.skill}</span>
                    <Chip tone="muted">{s.kind === "must" ? "Must-have" : "Nice-to-have"} · weight {s.weight}</Chip>
                    <span className="hr-data text-sm w-10 text-right">{s.score ?? "–"}</span>
                    <StatStrip value={s.score} series="overall" />
                  </div>
                  {s.evidence.length > 0
                    ? <ul className="mt-1.5 text-xs text-[var(--hr-muted)] list-disc pl-5">{s.evidence.map((e) => <li key={e}>{e}</li>)}</ul>
                    : <p className="mt-1.5 text-xs text-[var(--hr-muted)]">No direct evidence yet.</p>}
                </li>
              ))}
            </ul>
            <p className="text-xs text-[var(--hr-muted)]">Evidence covers {Math.round(r.coverage * 100)}% of the skill weight.</p>
          </>
        )}
      </section>

      <Section title="Coding test">
        {!r.coding ? <p className="text-sm text-[var(--hr-muted)]">No coding results yet.</p> : (
          <div className="space-y-3">
            <p className="text-sm">
              Score {r.coding.score ?? "–"} / {r.coding.maxScore ?? "–"} · {r.coding.passed}/{r.coding.total} tests passed · status {r.coding.status}
              {r.coding.pending ? " · grading in progress" : ""}
            </p>
            {r.coding.questions.map((q, i) => (
              <div key={i} className="shadow-[inset_0_0_0_1px_var(--hr-rule)]">
                <div className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm hr-rule-b bg-[var(--hr-surface)]">
                  <span className="font-medium flex-1">{q.title}</span>
                  <Chip tone="muted">{q.language ?? "–"}</Chip>
                  <span className="hr-data text-xs">{q.passed ?? 0}/{q.total ?? 0} tests</span>
                </div>
                <pre aria-label={`Submitted code for ${q.title}`} className="max-h-80 overflow-auto p-3 text-xs bg-[var(--hr-ground)]"><code>{q.code ?? "No code submitted."}</code></pre>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="AI interview">
        {!r.interview ? <p className="text-sm text-[var(--hr-muted)]">No interview yet.</p> : (
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
                    {e.quotes.length > 0 && <ul className="text-xs text-[var(--hr-muted)] list-disc pl-5">{e.quotes.map((q) => <li key={q}>“{q}”</li>)}</ul>}
                  </li>
                ))}
              </ul>
            )}
            {r.interview.transcript.length > 0 ? (
              <div className="shadow-[inset_0_0_0_1px_var(--hr-rule)]">
                <p className="px-3 py-2 text-sm font-medium hr-rule-b bg-[var(--hr-surface)]">Transcript ({r.interview.transcript.length} turns)</p>
                <ol className="max-h-80 overflow-auto p-3 space-y-2 text-sm">
                  {r.interview.transcript.map((t, i) => (
                    <li key={i}><span className="font-medium">{t.role === "interviewer" ? "Interviewer" : "Candidate"}:</span> {t.content}</li>
                  ))}
                </ol>
              </div>
            ) : <p className="text-sm text-[var(--hr-muted)]">No transcript.</p>}
          </div>
        )}
      </Section>

      <Section title="Integrity">
        {r.integrity.sessions.length === 0 ? <p className="text-sm text-[var(--hr-muted)]">No proctoring sessions.</p> : (
          <ol className="relative" aria-label="Integrity timeline">
            {r.integrity.sessions.map((s, i) => {
              const review = s.band === "low";
              return (
                <li key={i} className="relative pb-5 last:pb-0 pl-5">
                  <span className="absolute left-0 top-1.5 h-2 w-2" style={{ background: review ? "var(--hr-red)" : "var(--hr-muted)" }} />
                  {i < r.integrity.sessions.length - 1 && <span className="absolute left-[3px] top-4 bottom-0 w-px bg-[var(--hr-rule)]" />}
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="capitalize text-sm font-medium">{s.kind} session</span>
                    <span className="hr-data text-xs text-[var(--hr-muted)]">score {s.score ?? "pending"}</span>
                    {s.band && <Chip tone={review ? "red" : "muted"}>{BAND_TEXT[s.band]} integrity{review ? " · review" : ""}</Chip>}
                    <span className="text-xs text-[var(--hr-muted)]">{s.flags} flag{s.flags === 1 ? "" : "s"}</span>
                  </div>
                  {s.review && <p className="text-xs text-[var(--hr-muted)] mt-1">{REVIEW_TEXT[s.review] ?? s.review}</p>}
                  {staff && s.sessionId && <a className="text-xs underline mt-1 inline-block" href={`/proctor/review/${s.sessionId}`}>Review timeline and evidence</a>}
                </li>
              );
            })}
          </ol>
        )}
        {!staff && <p className="text-xs text-[var(--hr-muted)]">This shared view shows integrity scores only; evidence images are not included.</p>}
      </Section>
    </div>
  );
}
