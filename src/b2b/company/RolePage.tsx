// One role: pipeline table (server-side filters, sort, pagination), bulk decisions, exports, invites.
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Loading, Empty } from "../layout/V1Shell";
import { companyApi } from "../lib/api";
import { CheckChip, toggle } from "../college/CollegeShell";
import { downloadCsvFile, downloadXlsxFile, fileStamp } from "../college/lib/exports";
import type { PipelineRow } from "../../../supabase/functions/_shared/contracts/company";
import { STAGE_LABEL } from "../../../supabase/functions/_shared/company-logic";
import { CompanyShell } from "./CompanyShell";
import { InviteDialog } from "./InviteDialog";
import { emptyPipeline, STAGES, toPipelineFilters, type Band, type PipelineForm } from "./lib/pipeline";
import { fmtDate, useRole, type JobRoleRecord } from "./queries";

const PAGE = 50;
type SortBy = "full_name" | "stage" | "match_score" | "coding" | "interview" | "integrity" | "invited_at" | "completed_at";
const BAND_TEXT: Record<Band, string> = { high: "High", medium: "Medium", low: "Low" };
const REC_TEXT: Record<string, string> = { strong: "Strong", good: "Good", borderline: "Borderline", not_yet: "Not yet" };

export default function RolePage() {
  const { roleId = "" } = useParams();
  const role = useRole(roleId);
  return (
    <CompanyShell>
      {({ orgId, isEditor }) => role.isLoading ? <Loading />
        : !role.data ? <Empty title="Role not found" body="It may not be assigned to you." />
        : <RoleView orgId={orgId} role={role.data} isEditor={isEditor} />}
    </CompanyShell>
  );
}

export function RoleView({ orgId, role, isEditor }: { orgId: string; role: JobRoleRecord; isEditor: boolean }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<PipelineForm>(emptyPipeline);
  const [applied, setApplied] = useState<PipelineForm>(emptyPipeline);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<{ by: SortBy; dir: "asc" | "desc" }>({ by: "match_score", dir: "desc" });
  const [selected, setSelected] = useState<string[]>([]);
  const [inviting, setInviting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const filters = toPipelineFilters(applied);
  const data = useQuery({
    queryKey: ["b2b-company", "pipeline", role.id, filters, page, sort],
    queryFn: () => companyApi("pipeline", { jobRoleId: role.id, filters, page, pageSize: PAGE, sort }),
  });
  const rows = data.data?.rows ?? [];
  const total = data.data?.total ?? 0;
  const counts = data.data?.counts ?? {};

  function sortBy(by: SortBy) {
    setSort((s) => ({ by, dir: s.by === by && s.dir === "desc" ? "asc" : "desc" }));
    setPage(1);
  }

  async function decide(decision: "advance" | "hold" | "reject" | "hire") {
    setBusy(true); setMsg(null);
    try {
      const r = await companyApi("decide", { roleCandidateIds: selected, decision });
      setMsg(`${r.updated} updated${r.skipped.length ? `, ${r.skipped.length} skipped` : ""}.`);
      setSelected([]);
      await qc.invalidateQueries({ queryKey: ["b2b-company", "pipeline", role.id] });
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Couldn't save the decision.");
    } finally {
      setBusy(false);
    }
  }

  async function exportAs(format: "csv" | "xlsx") {
    setBusy(true); setMsg(null);
    try {
      const r = await companyApi("exportPipeline", { jobRoleId: role.id, filters, format });
      const name = `${role.title.replace(/[^\w-]+/g, "-")}-pipeline-${fileStamp()}`;
      if (format === "csv") downloadCsvFile(`${name}.csv`, r.columns, r.rows);
      else await downloadXlsxFile(`${name}.xlsx`, "Pipeline", r.columns, r.rows);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Export failed.");
    } finally {
      setBusy(false);
    }
  }

  async function resend(rc: PipelineRow) {
    setMsg(null);
    try {
      const r = await companyApi("resendInvite", { roleCandidateId: rc.id });
      try { await navigator.clipboard?.writeText(r.link); } catch { /* clipboard blocked */ }
      setMsg(r.emailed ? `New link emailed to ${rc.email}. The old link no longer works.`
        : `New link for ${rc.full_name} copied: ${r.link} (the old link no longer works).`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Couldn't re-issue the link.");
    }
  }

  const allOnPage = rows.length > 0 && rows.every((r) => selected.includes(r.id));
  const header = (label: string, by: SortBy) => (
    <th scope="col" className="px-2 py-2 text-left font-medium">
      <button type="button" className="hover:underline" onClick={() => sortBy(by)} aria-label={`Sort by ${label}`}>
        {label}{sort.by === by ? (sort.dir === "desc" ? " ↓" : " ↑") : ""}
      </button>
    </th>
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold">{role.title}</h2>
          <p className="text-xs text-muted-foreground">
            {role.status === "open" ? "Open" : role.status === "draft" ? "Draft" : "Closed"} ·{" "}
            {role.assessment_id ? "Coding test" : "No coding test"} · {role.interview_config.enabled ? `AI interview (${role.interview_config.duration_min} min)` : "No interview"} ·
            Proctoring: {role.proctoring_policy}
          </p>
        </div>
        {isEditor && <Button variant="outline" asChild><Link to={`/co/${orgId}/roles/${role.id}/edit`}>Edit role</Link></Button>}
        {isEditor && <Button onClick={() => setInviting(true)} disabled={role.status !== "open"}>Invite candidates</Button>}
      </div>
      {isEditor && role.status !== "open" && <p className="text-sm text-muted-foreground">Open the role (Edit role → Status) to invite candidates.</p>}

      <div className="flex flex-wrap gap-2 text-sm" aria-label="Counts by stage">
        {STAGES.map((s) => <span key={s.value} className="rounded-full border px-3 py-1">{s.label}: {counts[s.value] ?? 0}</span>)}
      </div>

      <form className="space-y-3 rounded-lg border border-border p-3" aria-label="Filters"
            onSubmit={(e) => { e.preventDefault(); setApplied(form); setPage(1); setSelected([]); }}>
        <div className="flex flex-wrap gap-2">
          {STAGES.map((s) => <CheckChip key={s.value} label={s.label} checked={form.stages.includes(s.value)}
            onChange={(on) => setForm({ ...form, stages: toggle(form.stages, s.value, on) })} />)}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm">Integrity:</span>
          {(["high", "medium", "low"] as Band[]).map((b) => <CheckChip key={b} label={BAND_TEXT[b]} checked={form.bands.includes(b)}
            onChange={(on) => setForm({ ...form, bands: toggle(form.bands, b, on) })} />)}
          <Input aria-label="Minimum match score" placeholder="Min score" className="w-28" value={form.scoreMin} onChange={(e) => setForm({ ...form, scoreMin: e.target.value })} />
          <Input aria-label="Maximum match score" placeholder="Max score" className="w-28" value={form.scoreMax} onChange={(e) => setForm({ ...form, scoreMax: e.target.value })} />
          <Input aria-label="Search candidates" placeholder="Name or email" className="w-48" value={form.search} onChange={(e) => setForm({ ...form, search: e.target.value })} />
          <Button type="submit" size="sm">Apply filters</Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => { setForm(emptyPipeline); setApplied(emptyPipeline); setPage(1); }}>Clear</Button>
        </div>
      </form>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">{selected.length} selected</span>
        <Button size="sm" variant="outline" disabled={!selected.length || busy} onClick={() => decide("advance")}>Advance</Button>
        <Button size="sm" variant="outline" disabled={!selected.length || busy} onClick={() => decide("hold")}>Hold</Button>
        <Button size="sm" variant="outline" disabled={!selected.length || busy} onClick={() => decide("reject")}>Reject</Button>
        <Button size="sm" variant="outline" disabled={!selected.length || busy} onClick={() => decide("hire")}>Hire</Button>
        <span className="flex-1" />
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => exportAs("csv")}>Export CSV</Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => exportAs("xlsx")}>Export XLSX</Button>
      </div>
      {msg && <p role="status" className="text-sm">{msg}</p>}
      <p className="text-xs text-muted-foreground">Match score and recommendation are AI suggestions. AI does not pass or fail candidates; your team decides.</p>

      {data.isLoading ? <Loading /> : data.error ? <p role="alert" className="text-sm text-destructive">{(data.error as Error).message}</p>
        : rows.length === 0 ? <Empty title="No candidates here" body={Object.keys(filters).length ? "No one matches these filters." : "Invite candidates to get started."} />
        : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th scope="col" className="px-2 py-2">
                  <input type="checkbox" aria-label="Select all on this page" checked={allOnPage}
                         onChange={(e) => setSelected(e.target.checked ? [...new Set([...selected, ...rows.map((r) => r.id)])] : selected.filter((id) => !rows.some((r) => r.id === id)))} />
                </th>
                {header("Name", "full_name")}{header("Stage", "stage")}{header("Match", "match_score")}
                {header("Coding", "coding")}{header("Interview", "interview")}{header("Integrity", "integrity")}{header("Invited", "invited_at")}
                <th scope="col" className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="px-2 py-2"><input type="checkbox" aria-label={`Select ${r.full_name}`} checked={selected.includes(r.id)}
                        onChange={(e) => setSelected(toggle(selected, r.id, e.target.checked))} /></td>
                  <td className="px-2 py-2">
                    <Link className="font-medium hover:underline" to={`/co/${orgId}/candidates/${r.id}`}>{r.full_name}</Link>
                    <div className="text-xs text-muted-foreground">{r.email}</div>
                  </td>
                  <td className="px-2 py-2">{STAGE_LABEL[r.stage] ?? r.stage}{r.decision ? <div className="text-xs text-muted-foreground">Decision: {r.decision}</div> : null}</td>
                  <td className="px-2 py-2 tabular-nums">{r.match_score ?? "—"}{r.recommendation ? <div className="text-xs text-muted-foreground">{REC_TEXT[r.recommendation]}</div> : null}</td>
                  <td className="px-2 py-2 tabular-nums">{r.coding !== null ? `${r.coding}%` : "—"}</td>
                  <td className="px-2 py-2 tabular-nums">{r.interview !== null ? r.interview : "—"}</td>
                  <td className="px-2 py-2">{r.integrity_band ? <Badge variant={r.integrity_band === "low" ? "destructive" : "secondary"}>{BAND_TEXT[r.integrity_band]}</Badge> : "—"}</td>
                  <td className="px-2 py-2 text-xs">{fmtDate(r.invited_at)}{r.email_error ? <div className="text-destructive">Email failed</div> : null}</td>
                  <td className="px-2 py-2">{isEditor && (r.stage === "invited" || r.stage === "in_progress") &&
                    <Button size="sm" variant="ghost" onClick={() => void resend(r)}>Resend</Button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {total > PAGE && (
        <div className="flex items-center gap-2 text-sm">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
          <span>Page {page} of {Math.ceil(total / PAGE)}</span>
          <Button size="sm" variant="outline" disabled={page * PAGE >= total} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      )}
      {isEditor && (
        <InviteDialog open={inviting} onOpenChange={setInviting} jobRoleId={role.id} roleTitle={role.title}
                      onDone={() => void qc.invalidateQueries({ queryKey: ["b2b-company", "pipeline", role.id] })} />
      )}
    </div>
  );
}
