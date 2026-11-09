// Staff candidate report: the report body plus decisions, comments and expiring share links.
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/AuthContext";
import { b2bDb } from "@/features/b2b/lib/db";
import { Loading, Empty } from "../layout/V1Shell";
import { companyApi } from "../lib/api";
import { NativeSelect } from "../college/CollegeShell";
import type { CandidateReport } from "../../../supabase/functions/_shared/contracts/company";
import { CompanyShell } from "./CompanyShell";
import { ReportView } from "./ReportView";
import { expiresText, SHARE_DAYS, shareState } from "./lib/pipeline";
import { fmtDateTime, friendlyError, useShareLinks } from "./queries";

const DECISION_TEXT: Record<string, string> = { advance: "Advance", hold: "Hold", reject: "Reject", hire: "Hire" };

export default function ReportPage() {
  const { roleCandidateId = "" } = useParams();
  return <CompanyShell>{({ orgId, isEditor }) => <StaffReport orgId={orgId} rcId={roleCandidateId} isEditor={isEditor} />}</CompanyShell>;
}

export function StaffReport({ orgId, rcId, isEditor }: { orgId: string; rcId: string; isEditor: boolean }) {
  const q = useQuery({ queryKey: ["b2b-company", "report", rcId], queryFn: () => companyApi("report", { roleCandidateId: rcId }) });
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <Empty title="Couldn't open this report" body={q.error instanceof Error ? q.error.message : undefined} />;
  const r = q.data.report;
  return (
    <div className="space-y-6 max-w-[1400px]">
      <div>
        <Link to={`/co/${orgId}/roles/${r.role.id}`} className="text-sm text-[var(--hr-muted)] hover:text-foreground">← {r.role.title}</Link>
        <h2 className="hr-display text-2xl mt-1.5">{r.candidate.fullName}</h2>
        <p className="text-sm text-[var(--hr-muted)]">{[r.candidate.email, r.candidate.phone].filter(Boolean).join(" · ")}</p>
      </div>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px] items-start">
        <div className="min-w-0"><ReportView report={r} staff /></div>
        <div className="lg:sticky lg:top-20 space-y-6">
          <DecisionPanel report={r} />
          <Comments orgId={orgId} report={r} />
          {isEditor && <SharePanel rcId={rcId} />}
        </div>
      </div>
    </div>
  );
}

function DecisionPanel({ report: r }: { report: CandidateReport }) {
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  async function decide(decision: "advance" | "hold" | "reject" | "hire") {
    setMsg(null);
    try {
      await companyApi("decide", { roleCandidateIds: [r.roleCandidateId], decision, ...(note.trim() ? { note: note.trim() } : {}) });
      setNote("");
      setMsg("Decision saved.");
      await qc.invalidateQueries({ queryKey: ["b2b-company"] });
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Couldn't save the decision.");
    }
  }
  return (
    <section className="space-y-3 hr-rule-t pt-6">
      <h3 className="hr-display text-lg">Decision</h3>
      <Textarea aria-label="Decision note" placeholder="Why? (optional, visible to your team)" value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
      <div className="flex flex-wrap gap-2">
        {(["advance", "hold", "reject", "hire"] as const).map((d) => {
          const solidDecision = r.stage === "shortlisted" ? "hire" : "advance";
          return <Button key={d} size="sm" variant={d === solidDecision ? "default" : "outline"} onClick={() => void decide(d)}>{DECISION_TEXT[d]}</Button>;
        })}
      </div>
      {msg && <p role="status" className="text-sm">{msg}</p>}
      {r.decisions.length > 0 && (
        <ol className="text-sm space-y-1" aria-label="Decision history">
          {r.decisions.map((d, i) => (
            <li key={i} className="hr-data text-xs text-[var(--hr-muted)]">{fmtDateTime(d.createdAt)} · {d.by}: <b className="text-foreground font-semibold">{DECISION_TEXT[d.decision] ?? d.decision}</b>{d.note ? ` (${d.note})` : ""}</li>
          ))}
        </ol>
      )}
    </section>
  );
}

function Comments({ orgId, report: r }: { orgId: string; report: CandidateReport }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  async function post() {
    if (!body.trim() || !user) return;
    setError(null);
    const { error: e } = await b2bDb.from("role_candidate_comments").insert({ org_id: orgId, role_candidate_id: r.roleCandidateId, author_id: user.id, body: body.trim() });
    if (e) { setError(friendlyError(new Error(e.message))); return; }
    setBody("");
    await qc.invalidateQueries({ queryKey: ["b2b-company", "report", r.roleCandidateId] });
  }
  return (
    <section className="space-y-3 hr-rule-t pt-6">
      <h3 className="hr-display text-lg">Reviewer comments</h3>
      {r.comments.length === 0 ? <p className="text-sm text-[var(--hr-muted)]">No comments yet.</p> : (
        <ul className="space-y-3">
          {r.comments.map((c) => (
            <li key={c.id} className="text-sm hr-rule-b pb-3">
              <span className="font-medium">{c.author}</span> <span className="text-xs text-[var(--hr-muted)]">· {fmtDateTime(c.createdAt)}</span>
              <p className="mt-0.5">{c.body}</p>
            </li>
          ))}
        </ul>
      )}
      <Textarea aria-label="New comment" value={body} onChange={(e) => setBody(e.target.value)} rows={2} />
      <Button size="sm" onClick={() => void post()} disabled={!body.trim()}>Add comment</Button>
      {error && <p role="alert" className="text-sm text-[var(--hr-red-ink)]">{error}</p>}
    </section>
  );
}

function SharePanel({ rcId }: { rcId: string }) {
  const qc = useQueryClient();
  const links = useShareLinks(rcId);
  const [days, setDays] = useState("7");
  const [created, setCreated] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  async function create() {
    setMsg(null);
    try {
      const r = await companyApi("createShareLink", { roleCandidateId: rcId, expiresInDays: Number(days) });
      setCreated(r.link);
      try { await navigator.clipboard?.writeText(r.link); } catch { /* clipboard blocked */ }
      await qc.invalidateQueries({ queryKey: ["b2b-company", "shares", rcId] });
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Couldn't create the link.");
    }
  }
  async function revoke(id: string) {
    setMsg(null);
    try {
      await companyApi("revokeShareLink", { shareId: id });
      await qc.invalidateQueries({ queryKey: ["b2b-company", "shares", rcId] });
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Couldn't revoke the link.");
    }
  }
  return (
    <section className="space-y-3 hr-rule-t pt-6">
      <h3 className="hr-display text-lg">Share with an outside hiring manager</h3>
      <p className="text-sm text-[var(--hr-muted)]">A view-only link to this report: no comments, no decisions, no other candidates and no evidence images. Anyone with the link can open it until it expires or you revoke it.</p>
      <div className="flex items-center gap-2">
        <NativeSelect aria-label="Link expires in" className="w-40" value={days} onChange={(e) => setDays(e.target.value)}>
          {SHARE_DAYS.map((d) => <option key={d} value={d}>{d === 1 ? "1 day" : `${d} days`}</option>)}
        </NativeSelect>
        <Button size="sm" onClick={() => void create()}>Create link</Button>
      </div>
      {created && <p role="status" className="text-sm break-all">Link copied: {created}</p>}
      {msg && <p role="alert" className="text-sm text-[var(--hr-red-ink)]">{msg}</p>}
      {(links.data ?? []).length > 0 && (
        <ul className="text-sm space-y-1" aria-label="Share links">
          {(links.data ?? []).map((l) => {
            const st = shareState(l);
            return (
              <li key={l.id} className="flex items-center gap-2">
                <span className="flex-1">Created {fmtDateTime(l.created_at)} · {st === "active" ? expiresText(l.expires_at) : st === "revoked" ? "Revoked" : "Expired"} · {l.view_count} view{l.view_count === 1 ? "" : "s"}</span>
                {st === "active" && <Button size="sm" variant="ghost" onClick={() => void revoke(l.id)}>Revoke</Button>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
