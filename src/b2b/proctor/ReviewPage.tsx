// /proctor/review/:sessionId — staff review of one proctoring session: the AI integrity score with its explanation,
// a vertical timeline of flags with evidence thumbnails (short-lived signed URLs), confirm / dismiss per flag with a
// note, and the final human decision, stored and shown separately from the AI score. Flags are evidence for review,
// never a verdict — nobody is failed on an AI flag alone; a human reads the evidence and decides.
import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { ContractOutput } from "../../../supabase/functions/_shared/contracts/common";
import type { proctorContract } from "../../../supabase/functions/_shared/contracts/proctor";
import { EVENT_LABEL, type ScoreDetail } from "../../../supabase/functions/_shared/contracts/proctor-rules";
import { proctorApi } from "../lib/api";
import { V1Shell, Loading, Empty } from "../layout/V1Shell";
import { Chip, Numeral, type Tone } from "../ui/broadcast";

type Timeline = ContractOutput<typeof proctorContract, "timeline">;
type Ev = Timeline["events"][number];
type Decision = "no_concern" | "minor_concern" | "serious_concern";
type Severity = Ev["severity"];

const BAND_LABEL = { high: "High integrity", medium: "Medium integrity", low: "Low integrity" } as const;
const BAND_TONE: Record<keyof typeof BAND_LABEL, Tone> = { high: "gold", medium: "plain", low: "red" };
const DECISION_LABEL: Record<Decision, string> = { no_concern: "No concern", minor_concern: "Minor concern", serious_concern: "Serious concern" };
/** Severity by series colour; red is reserved for what actually needs review. */
const SEV_TONE: Record<Severity, Tone> = { info: "muted", low: "muted", medium: "plain", high: "red" };
const SEV_DOT: Record<Severity, string> = { info: "var(--hr-muted)", low: "var(--hr-muted)", medium: "#F4F6FA", high: "var(--hr-red)" };

export const reviewKey = (id: string) => ["b2b-v1", "proctor", "timeline", id];

function offset(startIso: string, iso: string) {
  const s = Math.max(0, Math.round((Date.parse(iso) - Date.parse(startIso)) / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
function duration(e: Ev) {
  if (!e.ended_at) return null;
  const s = Math.round((Date.parse(e.ended_at) - Date.parse(e.started_at)) / 1000);
  return s >= 1 ? `${s}s` : null;
}
const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—");

/** One row on the timeline: a marker on the connector line, mono time, event name in words, evidence, controls. */
function EventRow({ e, start, last, onReview, busy }: { e: Ev; start: string; last: boolean; busy: boolean; onReview: (status: "confirmed" | "dismissed", note: string) => void }) {
  const [note, setNote] = useState(e.review_note ?? "");
  const [imgFailed, setImgFailed] = useState(false);
  const flag = e.severity !== "info";
  const noSnapshot = flag && !e.evidenceUrl;
  return (
    <li className="relative pl-7" data-testid="timeline-event">
      {!last && <span aria-hidden className="absolute left-[5px] top-4 bottom-[-0.75rem] w-px bg-[var(--hr-rule)]" />}
      <span aria-hidden className="absolute left-0 top-1.5 h-[11px] w-[11px]" style={{ background: SEV_DOT[e.severity] }} />
      <div className="grid grid-cols-[3.5rem_1fr] sm:grid-cols-[3.5rem_1fr_9rem] gap-3 pb-5">
        <span className="hr-data text-xs text-[var(--hr-muted)] pt-0.5">{offset(start, e.started_at)}</span>
        <div className="space-y-1.5 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-sm">{EVENT_LABEL[e.type] ?? e.type}</span>
            <Chip tone={SEV_TONE[e.severity]}>{e.severity}</Chip>
            {e.confidence < 1 && <span className="hr-data text-xs text-[var(--hr-muted)]">confidence {Math.round(e.confidence * 100)}%</span>}
            {duration(e) && <span className="hr-data text-xs text-[var(--hr-muted)]">{duration(e)}</span>}
            {e.review_status !== "pending" && (
              <Chip tone={e.review_status === "confirmed" ? "red" : "muted"} solid={e.review_status === "confirmed"}>
                {e.review_status === "confirmed" ? "Confirmed" : "Dismissed"}
              </Chip>
            )}
          </div>
          {e.meta && typeof e.meta.cause === "string" && <p className="text-xs text-[var(--hr-muted)]">Cause: {EVENT_LABEL[e.meta.cause] ?? e.meta.cause}</p>}
          {flag && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Textarea value={note} onChange={(x) => setNote(x.target.value)} placeholder="Note (optional)" rows={1}
                        className="min-h-0 h-8 py-1 text-sm max-w-xs bg-[var(--hr-surface)]" aria-label={`Note for ${EVENT_LABEL[e.type] ?? e.type} at ${offset(start, e.started_at)}`} />
              <Button size="sm" variant="outline" disabled={busy} onClick={() => onReview("confirmed", note)}>Confirm</Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => onReview("dismissed", note)}>Dismiss</Button>
            </div>
          )}
        </div>
        <div className="col-start-2 sm:col-start-auto">
          {e.evidenceUrl && !imgFailed ? (
            <a href={e.evidenceUrl} target="_blank" rel="noreferrer" title="Open evidence (link expires in 5 minutes)">
              <img src={e.evidenceUrl} alt={`Evidence: ${EVENT_LABEL[e.type] ?? e.type}`} loading="lazy" onError={() => setImgFailed(true)}
                   className="w-36 h-20 object-cover bg-[var(--hr-surface-2)] shadow-[inset_0_0_0_1px_var(--hr-rule)]" />
            </a>
          ) : noSnapshot || imgFailed ? (
            <div className="w-36 h-20 grid place-items-center bg-[var(--hr-surface-2)] shadow-[inset_0_0_0_1px_var(--hr-rule)]">
              <span className="hr-label !text-[10px] text-[var(--hr-muted)]">No snapshot</span>
            </div>
          ) : null}
        </div>
      </div>
    </li>
  );
}

export default function ReviewPage() {
  const { sessionId = "" } = useParams();
  const qc = useQueryClient();
  const [showSnapshots, setShowSnapshots] = useState(false);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [note, setNote] = useState("");
  const q = useQuery({ queryKey: reviewKey(sessionId), queryFn: () => proctorApi("timeline", { sessionId }), enabled: !!sessionId,
                       staleTime: 60_000 /* signed evidence URLs live 5 minutes */ });
  const review = useMutation({
    mutationFn: (v: { eventId: number; status: "confirmed" | "dismissed"; note: string }) =>
      proctorApi("reviewEvent", { eventId: v.eventId, status: v.status, note: v.note || undefined }),
    onSuccess: () => qc.invalidateQueries({ queryKey: reviewKey(sessionId) }),
  });
  const decide = useMutation({
    mutationFn: (v: { decision: Decision; note: string }) => proctorApi("decide", { sessionId, decision: v.decision, note: v.note || undefined }),
    onSuccess: () => { setNote(""); setDecision(null); return qc.invalidateQueries({ queryKey: reviewKey(sessionId) }); },
  });

  const data = q.data;
  const events = useMemo(() => (data?.events ?? []).filter((e) => showSnapshots || e.type !== "snapshot"), [data, showSnapshots]);
  if (q.isLoading) return <V1Shell title="Integrity review"><Loading /></V1Shell>;
  if (q.error || !data) {
    return <V1Shell title="Integrity review"><Empty title="Session not found" body="It doesn't exist, or you don't have access to it." /></V1Shell>;
  }
  const s = data.session;
  const detail = s.score_detail as ScoreDetail | null;
  const flags = data.events.filter((e) => e.severity !== "info");
  const pending = flags.filter((e) => e.review_status === "pending").length;
  const latest = data.reviews[0];

  return (
    <V1Shell title="Integrity review" subtitle={`${s.subject_name ?? "Candidate"} · ${s.policy} policy · ${fmt(s.started_at)}`}>
      <div className="grid gap-4 lg:grid-cols-2 mb-6">
        <section className="hr-scorebug flex flex-col" aria-labelledby="ai-score-label">
          <div className="px-5 py-4 flex-1">
            <h2 id="ai-score-label" className="hr-label !text-[11px]">AI integrity score</h2>
            <div className="flex items-baseline gap-3 mt-1.5">
              <span className="text-[34px] leading-none" data-testid="ai-score">
                <Numeral value={s.integrity_score === null ? "–" : Math.round(s.integrity_score)} tone={s.integrity_band ? BAND_TONE[s.integrity_band] : "plain"} />
              </span>
              {s.integrity_band && (s.integrity_band === "low"
                ? <Chip tone="red">{BAND_LABEL[s.integrity_band]} · review</Chip>
                : <span className={cn("text-sm", s.integrity_band === "high" ? "text-[var(--hr-gold)]" : "text-foreground")}>{BAND_LABEL[s.integrity_band]}</span>)}
              {s.provisional && <Chip tone="plain">Provisional</Chip>}
            </div>
            <p className="text-sm text-[var(--hr-muted)] mt-3">
              Computed from AI and browser signals. Flags are evidence for review, never a verdict. Check them below before deciding.
            </p>
            {detail?.by_type?.length ? (
              <table className="w-full text-sm mt-3">
                <thead><tr className="text-left hr-label !text-[10px]"><th className="font-normal pb-1">Signal</th><th className="font-normal text-right pb-1">Count</th><th className="font-normal text-right pb-1">Points</th><th className="font-normal text-right pb-1">Counted (cap)</th></tr></thead>
                <tbody>
                  {detail.by_type.map((t) => (
                    <tr key={t.type} className="hr-rule-t"><td className="py-1">{t.label}</td><td className="hr-data text-right">{t.count}</td><td className="hr-data text-right">{t.points}</td><td className="hr-data text-right">{t.capped} ({t.cap})</td></tr>
                  ))}
                </tbody>
              </table>
            ) : <p className="text-sm text-[var(--hr-muted)] mt-3">No flagged signals.</p>}
            {detail?.formula && <p className="text-xs text-[var(--hr-muted)] mt-2">Score = {detail.formula}. Bands: 80+ high, 50–79 medium, below 50 low.</p>}
          </div>
        </section>

        <section className="bg-[var(--hr-surface)] shadow-[inset_0_0_0_1px_var(--hr-rule)] p-4 space-y-3" aria-labelledby="human-decision">
          <h2 id="human-decision" className="hr-label !text-[11px]">Human decision</h2>
          {latest ? (
            <p className="text-sm" data-testid="latest-decision">
              <strong>{DECISION_LABEL[latest.decision]}</strong>{latest.note ? ` — ${latest.note}` : ""}
              <span className="block text-xs text-[var(--hr-muted)] mt-0.5">{latest.reviewer_name ?? "Reviewer"} · {fmt(latest.created_at)}</span>
            </p>
          ) : <p className="text-sm text-[var(--hr-muted)]">No decision recorded yet.</p>}
          {pending > 0 && <p className="text-xs text-foreground">{pending} flag{pending === 1 ? "" : "s"} not reviewed yet.</p>}
          <div role="radiogroup" aria-label="Decision" className="flex flex-wrap gap-2">
            {(Object.keys(DECISION_LABEL) as Decision[]).map((d) => (
              <Button key={d} type="button" size="sm" role="radio" aria-checked={decision === d} variant={decision === d ? "default" : "outline"} onClick={() => setDecision(d)}>
                {DECISION_LABEL[d]}
              </Button>
            ))}
          </div>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reasoning (recommended)" aria-label="Decision note" rows={2} className="bg-[var(--hr-surface-2)]" />
          <Button type="button" disabled={!decision || decide.isPending} onClick={() => decision && decide.mutate({ decision, note })}>
            {latest ? "Record a new decision" : "Record decision"}
          </Button>
          {decide.error && <p role="alert" className="text-sm text-[var(--hr-red-ink)]">{(decide.error as Error).message}</p>}
        </section>
      </div>

      <section aria-labelledby="timeline">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h2 id="timeline" className="hr-display text-lg">Timeline <span className="text-sm font-normal text-[var(--hr-muted)]">({flags.length} flags)</span></h2>
          <div className="flex items-center gap-2">
            <Switch id="snapshots" checked={showSnapshots} onCheckedChange={setShowSnapshots} />
            <Label htmlFor="snapshots" className="text-sm">Show periodic snapshots</Label>
          </div>
        </div>
        {review.error && <p role="alert" className="text-sm text-[var(--hr-red-ink)] mb-2">{(review.error as Error).message}</p>}
        {events.length === 0 ? <Empty title="Nothing to review" body="No signals were recorded in this session." /> : (
          <ul>
            {events.map((e, i) => (
              <EventRow key={e.id} e={e} start={s.started_at} last={i === events.length - 1} busy={review.isPending}
                        onReview={(status, n) => review.mutate({ eventId: e.id, status, note: n })} />
            ))}
          </ul>
        )}
      </section>
    </V1Shell>
  );
}
