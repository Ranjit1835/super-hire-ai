// One role: pipeline table (server-side filters, sort, pagination), bulk decisions, exports, invites.
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loading, Empty } from "../layout/V1Shell";
import { Chip, PlayerCard, Scorebug, StatStrip, type Series } from "../ui/broadcast";
import { companyApi } from "../lib/api";
import { Checkbox } from "@/components/ui/checkbox";
import { CheckChip, toggle } from "../college/CollegeShell";
import { downloadCsvFile, downloadXlsxFile, fileStamp } from "../college/lib/exports";
import { cn } from "@/lib/utils";
import type { PipelineRow } from "../../../supabase/functions/_shared/contracts/company";
import { STAGE_LABEL } from "../../../supabase/functions/_shared/company-logic";
import { CompanyShell } from "./CompanyShell";
import { InviteDialog } from "./InviteDialog";
import { activeFilterCount, emptyPipeline, STAGES, toPipelineFilters, type Band, type PipelineForm } from "./lib/pipeline";
import { fmtDate, useRole, type JobRoleRecord } from "./queries";

const PAGE = 50;
type SortBy = "full_name" | "stage" | "match_score" | "coding" | "interview" | "integrity" | "invited_at" | "completed_at";
const BAND_TEXT: Record<Band, string> = { high: "High", medium: "Medium", low: "Low" };
const REC_TEXT: Record<string, string> = { strong: "Strong", good: "Good", borderline: "Borderline", not_yet: "Not yet" };
const STAGE_TONE: Record<string, "muted" | "blue" | "gold"> = {
  invited: "muted", in_progress: "blue", completed: "gold", shortlisted: "muted", rejected: "muted", hired: "muted", withdrawn: "muted",
};
// Decision D8: short forms for the framed scorebug's counter labels at 390px.
const STAGE_SHORT: Record<string, string> = { in_progress: "Started", completed: "Done", shortlisted: "Listed", rejected: "Out" };

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
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
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
  const pickedRow = rows.find((r) => r.id === picked) ?? null;

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
  const advancedCount = activeFilterCount({ ...form, stages: [] });
  const header = (label: string, by: SortBy) => (
    <TableHead className="hr-label">
      <button type="button" className="hr-label hover:text-foreground" onClick={() => sortBy(by)} aria-label={`Sort by ${label}`}>
        {label}{sort.by === by ? (sort.dir === "desc" ? " ↓" : " ↑") : ""}
      </button>
    </TableHead>
  );

  return (
    <div className="space-y-4">
      <Scorebug
        head={(
          <>
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 className="hr-display text-[24px]">{role.title}</h2>
              <Chip tone={role.status === "open" ? "blue" : "muted"} solid={role.status === "open"}>
                {role.status === "open" ? "Open" : role.status === "draft" ? "Draft" : "Closed"}
              </Chip>
            </div>
            <p className="text-sm text-[var(--hr-muted)] mt-1.5">
              {role.assessment_id ? "Coding test" : "No coding test"} · {role.interview_config.enabled ? `AI interview (${role.interview_config.duration_min} min)` : "No interview"} · Proctoring: {role.proctoring_policy}
            </p>
          </>
        )}
        counters={STAGES.map((s) => ({ label: s.label, short: STAGE_SHORT[s.value], value: counts[s.value] ?? 0, tone: s.value === "completed" ? "gold" : undefined }))}
      />

      <div className="flex flex-wrap items-center gap-2">
        {isEditor && <Button variant="outline" asChild><Link to={`/co/${orgId}/roles/${role.id}/edit`}>Edit role</Link></Button>}
        {isEditor && <Button onClick={() => setInviting(true)} disabled={role.status !== "open"}>Invite candidates</Button>}
        {isEditor && role.status !== "open" && <p className="text-sm text-[var(--hr-muted)]">Open the role (Edit role → Status) to invite candidates.</p>}
      </div>

      {/* Decision D4: status is a tab bar with counts; integrity, score range and search sit behind one Filters button. */}
      <div className="flex flex-wrap items-end gap-x-2 gap-y-2 hr-rule-b">
        <div role="tablist" aria-label="Stage" className="flex items-stretch overflow-x-auto -mb-px">
          {[{ key: null, label: "All", n: total }, ...STAGES.map((s) => ({ key: s.value, label: s.label, n: counts[s.value] }))].map((t) => {
            const on = t.key === null ? applied.stages.length === 0 : applied.stages.length === 1 && applied.stages[0] === t.key;
            return (
              <button key={t.key ?? "all"} type="button" role="tab" aria-selected={on}
                      onClick={() => {
                        const stages = t.key === null ? [] : [t.key];
                        setForm((f) => ({ ...f, stages }));
                        setApplied((a) => ({ ...a, stages }));
                        setPage(1); setSelected([]);
                      }}
                      className={cn("px-3 py-2 text-sm whitespace-nowrap", on ? "text-foreground shadow-[inset_0_-2px_0_var(--hr-orange)]" : "text-[var(--hr-muted)] hover:text-foreground")}>
                {t.label} <span className="hr-data text-xs ml-1">{t.n ?? "–"}</span>
              </button>
            );
          })}
        </div>
        <div className="ml-auto flex items-center gap-2 pb-1.5">
          {advancedCount > 0 && <Button type="button" size="sm" variant="ghost" onClick={() => { setForm((f) => ({ ...emptyPipeline, stages: f.stages })); setApplied((a) => ({ ...emptyPipeline, stages: a.stages })); setPage(1); }}>Clear</Button>}
          <Button type="button" size="sm" variant="outline" aria-expanded={filtersOpen} aria-controls="role-filters-panel" onClick={() => setFiltersOpen((o) => !o)}>
            Filters{advancedCount > 0 ? ` (${advancedCount})` : ""}
          </Button>
        </div>
      </div>
      {filtersOpen && (
        <form id="role-filters-panel" className="space-y-3 hr-rule-b pb-4" aria-label="Filters"
              onSubmit={(e) => { e.preventDefault(); setApplied((a) => ({ ...a, bands: form.bands, scoreMin: form.scoreMin, scoreMax: form.scoreMax, search: form.search })); setPage(1); setSelected([]); }}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="hr-label">Integrity</span>
            {(["high", "medium", "low"] as Band[]).map((b) => <CheckChip key={b} label={BAND_TEXT[b]} checked={form.bands.includes(b)}
              onChange={(on) => setForm({ ...form, bands: toggle(form.bands, b, on) })} />)}
            <Input aria-label="Minimum match score" placeholder="Min score" className="w-28 hr-data" value={form.scoreMin} onChange={(e) => setForm({ ...form, scoreMin: e.target.value })} />
            <Input aria-label="Maximum match score" placeholder="Max score" className="w-28 hr-data" value={form.scoreMax} onChange={(e) => setForm({ ...form, scoreMax: e.target.value })} />
            <Input aria-label="Search candidates" placeholder="Name or email" className="w-48" value={form.search} onChange={(e) => setForm({ ...form, search: e.target.value })} />
            <Button type="submit" size="sm" variant="outline">Apply filters</Button>
          </div>
        </form>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => exportAs("csv")}>Export CSV</Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => exportAs("xlsx")}>Export XLSX</Button>
      </div>
      <div className={cn("flex flex-wrap items-center gap-2", !selected.length && "hidden md:flex")}>
        <span className="text-sm text-[var(--hr-muted)]">{selected.length} selected</span>
        <Button size="sm" variant="outline" disabled={!selected.length || busy} onClick={() => decide("advance")}>Advance</Button>
        <Button size="sm" variant="outline" disabled={!selected.length || busy} onClick={() => decide("hold")}>Hold</Button>
        <Button size="sm" variant="outline" disabled={!selected.length || busy} onClick={() => decide("reject")}>Reject</Button>
        <Button size="sm" variant="outline" disabled={!selected.length || busy} onClick={() => decide("hire")}>Hire</Button>
      </div>
      {msg && <p role="status" className="text-sm">{msg}</p>}
      <p className="text-xs text-[var(--hr-muted)]">Match score and recommendation are AI suggestions. AI does not pass or fail candidates; your team decides.</p>

      {data.isLoading ? <Loading /> : data.error ? <p role="alert" className="text-sm text-[var(--hr-red-ink)]">{(data.error as Error).message}</p>
        : rows.length === 0 ? <Empty title="No candidates here" body={Object.keys(filters).length ? "No one matches these filters." : "Invite candidates to get started."} />
        : (
        <div className={cn("grid gap-4 items-start", pickedRow && "xl:grid-cols-[minmax(0,1fr)_320px]")}>
          <div className="min-w-0 order-last xl:order-none space-y-3">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="px-2">
                    <Checkbox aria-label="Select all on this page" checked={allOnPage}
                           onClick={(e) => e.stopPropagation()}
                           onCheckedChange={(v) => setSelected(v === true ? [...new Set([...selected, ...rows.map((r) => r.id)])] : selected.filter((id) => !rows.some((r) => r.id === id)))} />
                  </TableHead>
                  {header("Name", "full_name")}{header("Stage", "stage")}{header("Match", "match_score")}
                  {header("Coding", "coding")}{header("Interview", "interview")}{header("Integrity", "integrity")}{header("Invited", "invited_at")}
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id} data-state={r.id === picked ? "selected" : undefined}
                            className="cursor-pointer data-[state=selected]:bg-[var(--hr-surface-2)]"
                            onClick={() => setPicked(r.id === picked ? null : r.id)}>
                    <TableCell className="px-2" onClick={(e) => e.stopPropagation()}>
                      <Checkbox aria-label={`Select ${r.full_name}`} checked={selected.includes(r.id)}
                            onCheckedChange={(v) => setSelected(toggle(selected, r.id, v === true))} />
                    </TableCell>
                    <TableCell>
                      <Link className="font-medium hover:text-[var(--hr-orange)]" to={`/co/${orgId}/candidates/${r.id}`} onClick={(e) => e.stopPropagation()}>{r.full_name}</Link>
                      <div className="text-xs text-[var(--hr-muted)]">{r.email}</div>
                    </TableCell>
                    <TableCell><Chip tone={STAGE_TONE[r.stage] ?? "muted"}>{STAGE_LABEL[r.stage] ?? r.stage}</Chip>{r.decision ? <div className="text-xs text-[var(--hr-muted)] mt-1">Decision: {r.decision}</div> : null}</TableCell>
                    <ScoreCell value={r.match_score} series="overall" hint={r.recommendation ? REC_TEXT[r.recommendation] : undefined} />
                    <ScoreCell value={r.coding} series="test" />
                    <ScoreCell value={r.interview} series="interview" />
                    <TableCell><IntegrityCell band={r.integrity_band} score={r.integrity} /></TableCell>
                    <TableCell className="text-xs">{fmtDate(r.invited_at)}{r.email_error ? <div className="text-[var(--hr-red-ink)]">Email failed</div> : null}</TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>{isEditor && (r.stage === "invited" || r.stage === "in_progress") &&
                      <Button size="sm" variant="ghost" onClick={() => void resend(r)}>Resend</Button>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {total > PAGE && (
              <div className="flex items-center gap-2 text-sm">
                <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
                <span className="hr-data text-xs">Page {page} of {Math.ceil(total / PAGE)}</span>
                <Button size="sm" variant="outline" disabled={page * PAGE >= total} onClick={() => setPage(page + 1)}>Next</Button>
              </div>
            )}
          </div>
          {pickedRow && (
            <PlayerCard open name={pickedRow.full_name} code={pickedRow.email}
              meta={STAGE_LABEL[pickedRow.stage] ?? pickedRow.stage}
              headline={{ label: "AI suggestion", value: pickedRow.match_score ?? "–", tone: "gold" }}
              stats={[
                { label: "Coding", value: pickedRow.coding != null ? `${pickedRow.coding}%` : "–", series: "test", score: pickedRow.coding },
                { label: "Interview", value: pickedRow.interview ?? "–", series: "interview", score: pickedRow.interview },
                { label: "Integrity", value: <IntegrityCell band={pickedRow.integrity_band} score={pickedRow.integrity} /> },
                { label: "Recommendation", value: pickedRow.recommendation ? REC_TEXT[pickedRow.recommendation] : "–" },
              ]}
              onClose={() => setPicked(null)} closeLabel={`Close ${pickedRow.full_name} summary`}>
              <p className="text-xs text-[var(--hr-muted)]">Match score and recommendation are AI suggestions; your team decides.</p>
              <Link to={`/co/${orgId}/candidates/${pickedRow.id}`} className="text-sm underline mt-2 inline-block">Open full report</Link>
            </PlayerCard>
          )}
        </div>
      )}
      {isEditor && (
        <InviteDialog open={inviting} onOpenChange={setInviting} jobRoleId={role.id} roleTitle={role.title}
                      onDone={() => void qc.invalidateQueries({ queryKey: ["b2b-company", "pipeline", role.id] })} />
      )}
    </div>
  );
}

function ScoreCell({ value, series, hint }: { value: number | null; series: Series; hint?: string }) {
  return (
    <TableCell>
      {value == null ? <span className="text-[var(--hr-muted)]">–</span> : (
        <span className="inline-flex flex-col gap-1">
          <span className="hr-data text-sm">{value}</span>
          <StatStrip value={value} series={series} />
          {hint && <span className="text-xs text-[var(--hr-muted)]">{hint}</span>}
        </span>
      )}
    </TableCell>
  );
}

/** Integrity band: evidence for review, never a verdict. Low is the only band that asks for a look. */
function IntegrityCell({ band, score }: { band: string | null; score: number | null }) {
  if (!band) return <span className="text-[var(--hr-muted)]">–</span>;
  const text = `${BAND_TEXT[band as Band] ?? band}${score != null ? ` (${score})` : ""}`;
  return band === "low" ? <Chip tone="red">{text} · review</Chip> : <span className="text-sm">{text}</span>;
}
