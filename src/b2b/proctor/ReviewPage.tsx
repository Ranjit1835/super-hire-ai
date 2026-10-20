// /proctor/review/:sessionId — staff review of one proctoring session: the AI integrity score with its explanation,
// a timeline of flags with evidence thumbnails (short-lived signed URLs), confirm / dismiss per flag with a note,
// and the final human decision, stored and shown separately from the AI score.
import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import type { ContractOutput } from "../../../supabase/functions/_shared/contracts/common";
import type { proctorContract } from "../../../supabase/functions/_shared/contracts/proctor";
import { EVENT_LABEL, type ScoreDetail } from "../../../supabase/functions/_shared/contracts/proctor-rules";
import { proctorApi } from "../lib/api";
import { V1Shell, Loading, Empty } from "../layout/V1Shell";

type Timeline = ContractOutput<typeof proctorContract, "timeline">;
type Ev = Timeline["events"][number];
type Decision = "no_concern" | "minor_concern" | "serious_concern";

const BAND_LABEL = { high: "High integrity", medium: "Medium integrity", low: "Low integrity" } as const;
const BAND_CLASS = { high: "bg-emerald-100 text-emerald-900", medium: "bg-amber-100 text-amber-900", low: "bg-red-100 text-red-900" } as const;
const DECISION_LABEL: Record<Decision, string> = { no_concern: "No concern", minor_concern: "Minor concern", serious_concern: "Serious concern" };
const SEV_CLASS = { info: "bg-muted text-muted-foreground", low: "bg-sky-100 text-sky-900", medium: "bg-amber-100 text-amber-900", high: "bg-red-100 text-red-900" } as const;

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

function EventRow({ e, start, onReview, busy }: { e: Ev; start: string; busy: boolean; onReview: (status: "confirmed" | "dismissed", note: string) => void }) {
  const [note, setNote] = useState(e.review_note ?? "");
  const flag = e.severity !== "info";
  return (
    <li className="grid grid-cols-[3.5rem_1fr] sm:grid-cols-[3.5rem_1fr_9rem] gap-3 py-3" data-testid="timeline-event">
      <span className="font-mono text-xs text-muted-foreground pt-1">{offset(start, e.started_at)}</span>
      <div className="space-y-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-sm">{EVENT_LABEL[e.type] ?? e.type}</span>
          <span className={`rounded px-1.5 py-0.5 text-xs ${SEV_CLASS[e.severity]}`}>{e.severity}</span>
          {e.confidence < 1 && <span className="text-xs text-muted-foreground">confidence {Math.round(e.confidence * 100)}%</span>}
          {duration(e) && <span className="text-xs text-muted-foreground">{duration(e)}</span>}
          {e.review_status !== "pending" && (
            <Badge variant={e.review_status === "confirmed" ? "destructive" : "secondary"}>{e.review_status === "confirmed" ? "Confirmed" : "Dismissed"}</Badge>
          )}
        </div>
        {e.meta && typeof e.meta.cause === "string" && <p className="text-xs text-muted-foreground">Cause: {EVENT_LABEL[e.meta.cause] ?? e.meta.cause}</p>}
        {flag && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Textarea value={note} onChange={(x) => setNote(x.target.value)} placeholder="Note (optional)" rows={1}
                      className="min-h-0 h-8 py-1 text-sm max-w-xs" aria-label={`Note for ${EVENT_LABEL[e.type] ?? e.type} at ${offset(start, e.started_at)}`} />
            <Button size="sm" variant="outline" disabled={busy} onClick={() => onReview("confirmed", note)}>Confirm</Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => onReview("dismissed", note)}>Dismiss</Button>
          </div>
        )}
      </div>
      <div className="col-start-2 sm:col-start-auto">
        {e.evidenceUrl ? (
          <a href={e.evidenceUrl} target="_blank" rel="noreferrer" title="Open evidence (link expires in 5 minutes)">
            <img src={e.evidenceUrl} alt={`Evidence: ${EVENT_LABEL[e.type] ?? e.type}`} loading="lazy" className="w-36 h-20 object-cover rounded border border-border bg-muted" />
          </a>
        ) : null}
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
      <div className="grid gap-4 md:grid-cols-2 mb-6">
        <section className="rounded-lg border border-border p-4 space-y-3" aria-labelledby="ai-score">
          <h2 id="ai-score" className="font-semibold">AI integrity score</h2>
          <div className="flex items-center gap-3">
            <span className="text-3xl font-semibold" data-testid="ai-score">{s.integrity_score === null ? "—" : Math.round(s.integrity_score)}</span>
            {s.integrity_band && <span className={`rounded px-2 py-1 text-sm ${BAND_CLASS[s.integrity_band]}`}>{BAND_LABEL[s.integrity_band]}</span>}
            {s.provisional && <Badge variant="outline">Provisional (session didn't end cleanly)</Badge>}
          </div>
          <p className="text-xs text-muted-foreground">
            Computed from AI and browser signals. It is evidence for your review, not a verdict: check the flags below before deciding.
          </p>
          {detail?.by_type?.length ? (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-muted-foreground"><th className="font-normal">Signal</th><th className="font-normal text-right">Count</th><th className="font-normal text-right">Points</th><th className="font-normal text-right">Counted (cap)</th></tr></thead>
              <tbody>
                {detail.by_type.map((t) => (
                  <tr key={t.type}><td>{t.label}</td><td className="text-right">{t.count}</td><td className="text-right">{t.points}</td><td className="text-right">{t.capped} ({t.cap})</td></tr>
                ))}
              </tbody>
            </table>
          ) : <p className="text-sm text-muted-foreground">No flagged signals.</p>}
          {detail?.formula && <p className="text-xs text-muted-foreground">Score = {detail.formula}. Bands: 80+ high, 50–79 medium, below 50 low.</p>}
        </section>

        <section className="rounded-lg border border-border p-4 space-y-3" aria-labelledby="human-decision">
          <h2 id="human-decision" className="font-semibold">Human decision</h2>
          {latest ? (
            <p className="text-sm" data-testid="latest-decision">
              <strong>{DECISION_LABEL[latest.decision]}</strong>{latest.note ? ` — ${latest.note}` : ""}
              <span className="block text-xs text-muted-foreground">{latest.reviewer_name ?? "Reviewer"} · {fmt(latest.created_at)}</span>
            </p>
          ) : <p className="text-sm text-muted-foreground">No decision recorded yet.</p>}
          {pending > 0 && <p className="text-xs text-amber-700">{pending} flag{pending === 1 ? "" : "s"} not reviewed yet.</p>}
          <div role="radiogroup" aria-label="Decision" className="flex flex-wrap gap-2">
            {(Object.keys(DECISION_LABEL) as Decision[]).map((d) => (
              <Button key={d} type="button" size="sm" role="radio" aria-checked={decision === d} variant={decision === d ? "default" : "outline"} onClick={() => setDecision(d)}>
                {DECISION_LABEL[d]}
              </Button>
            ))}
          </div>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reasoning (recommended)" aria-label="Decision note" rows={2} />
          <Button type="button" disabled={!decision || decide.isPending} onClick={() => decision && decide.mutate({ decision, note })}>
            {latest ? "Record a new decision" : "Record decision"}
          </Button>
          {decide.error && <p role="alert" className="text-sm text-destructive">{(decide.error as Error).message}</p>}
        </section>
      </div>

      <section aria-labelledby="timeline">
        <div className="flex items-center justify-between mb-2">
          <h2 id="timeline" className="font-semibold">Timeline <span className="text-sm font-normal text-muted-foreground">({flags.length} flags)</span></h2>
          <div className="flex items-center gap-2">
            <Switch id="snapshots" checked={showSnapshots} onCheckedChange={setShowSnapshots} />
            <Label htmlFor="snapshots" className="text-sm">Show periodic snapshots</Label>
          </div>
        </div>
        {review.error && <p role="alert" className="text-sm text-destructive">{(review.error as Error).message}</p>}
        {events.length === 0 ? <Empty title="Nothing to review" body="No signals were recorded in this session." /> : (
          <ul className="divide-y divide-border">
            {events.map((e) => (
              <EventRow key={e.id} e={e} start={s.started_at} busy={review.isPending}
                        onReview={(status, n) => review.mutate({ eventId: e.id, status, note: n })} />
            ))}
          </ul>
        )}
      </section>
    </V1Shell>
  );
}
