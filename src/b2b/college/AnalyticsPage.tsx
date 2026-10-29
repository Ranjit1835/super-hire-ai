import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Loading, Empty, Stat } from "../layout/V1Shell";
import { Chip, StatStrip, type Series, type Tone } from "../ui/broadcast";
import { collegeApi, ApiError } from "../lib/api";
import { BAND_LABEL, STATUS_LABEL } from "../../../supabase/functions/_shared/college-table";
import { CheckChip, CollegeShell, NativeSelect, toggle } from "./CollegeShell";
import { downloadCsvFile, downloadXlsxFile, fileStamp } from "./lib/exports";
import { emptyAnalytics, toAnalyticsFilters, type AnalyticsForm, type AttemptStatus, type Band } from "./lib/filters";
import { friendly, useDrives, useStudentFacets } from "./queries";

const PAGE_SIZE = 50;
const DIMENSION_LABEL: Record<string, string> = {
  coding: "Coding", problem_solving: "Problem solving", technical_knowledge: "Technical knowledge", communication: "Communication",
  clarity_confidence: "Clarity and confidence", resume_quality: "Resume quality", integrity: "Integrity",
};
/** Dimensions ride the series that owns their meaning; "integrity" is evidence, never a strip (see DriveDetailPage). */
const DIMENSION_SERIES: Record<string, Series | undefined> = {
  coding: "test", problem_solving: "test", technical_knowledge: "test",
  communication: "interview", clarity_confidence: "interview", resume_quality: "overall", integrity: undefined,
};
const STATUS_TONE: Record<string, Tone> = { completed: "gold", in_progress: "blue", assigned: "muted", absent: "muted" };
type SortBy = "roll_no" | "full_name" | "department" | "cgpa" | "coding" | "mcq" | "interview" | "overall" | "integrity_score" | "status";

export default function AnalyticsPage() {
  return <CollegeShell>{({ orgId, orgName }) => <Analytics orgId={orgId} orgName={orgName} />}</CollegeShell>;
}

/** Whether any advanced field (branch, batch, integrity, status, sections, CGPA, backlogs, overall %) carries a value. */
function hasAdvancedValue(f: AnalyticsForm): boolean {
  return f.departments.length > 0 || f.batchYears.length > 0 || f.bands.length > 0 || f.statuses.length > 0
    || f.sections.trim() !== "" || f.cgpaMin !== "" || f.cgpaMax !== "" || f.maxBacklogs !== "" || f.scoreMin !== "" || f.scoreMax !== "";
}
function countAdvanced(f: AnalyticsForm): number {
  return f.departments.length + f.batchYears.length + f.bands.length + f.statuses.length
    + (f.sections.trim() ? 1 : 0) + (f.cgpaMin ? 1 : 0) + (f.cgpaMax ? 1 : 0) + (f.maxBacklogs ? 1 : 0) + (f.scoreMin ? 1 : 0) + (f.scoreMax ? 1 : 0);
}

export function Analytics({ orgId, orgName }: { orgId: string; orgName: string }) {
  const [params] = useSearchParams();
  const initial: AnalyticsForm = { ...emptyAnalytics, driveId: params.get("drive") ?? "" };
  const [form, setForm] = useState<AnalyticsForm>(initial);
  const [applied, setApplied] = useState<AnalyticsForm>(initial);
  const [moreOpen, setMoreOpen] = useState(() => hasAdvancedValue(initial));
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<{ by: SortBy; dir: "asc" | "desc" }>({ by: "roll_no", dir: "asc" });
  const [exporting, setExporting] = useState(false);
  const drives = useDrives(orgId);
  const facets = useStudentFacets(orgId);
  const { toast } = useToast();
  const filters = toAnalyticsFilters(applied);

  const data = useQuery({
    queryKey: ["b2b-college", "analytics", orgId, filters, page, sort],
    queryFn: () => collegeApi("analytics", { orgId, filters, page, pageSize: PAGE_SIZE, sort }),
    placeholderData: (prev) => prev,
  });

  const set = (patch: Partial<AnalyticsForm>) => setForm((f) => ({ ...f, ...patch }));
  const apply = () => { setApplied(form); setPage(1); };
  const reset = () => { setForm(emptyAnalytics); setApplied(emptyAnalytics); setPage(1); };
  const sortBy = (by: SortBy) => { setSort((s) => ({ by, dir: s.by === by && s.dir === "asc" ? "desc" : "asc" })); setPage(1); };

  const exportAs = async (format: "csv" | "xlsx") => {
    setExporting(true);
    try {
      const t = await collegeApi("exportTable", { orgId, filters, format });
      const base = `${orgName.replace(/[^\w-]+/g, "-").toLowerCase()}-results-${fileStamp()}`;
      if (format === "csv") downloadCsvFile(`${base}.csv`, t.columns, t.rows);
      else await downloadXlsxFile(`${base}.xlsx`, "Results", t.columns, t.rows);
    } catch (e) {
      toast({ title: "Export failed", description: e instanceof ApiError ? e.message : friendly(e), variant: "destructive" });
    } finally { setExporting(false); }
  };

  const total = data.data?.total ?? 0;
  const s = data.data?.summary;
  const Th = ({ by, children, right }: { by: SortBy; children: string; right?: boolean }) => (
    <TableHead className={cn("hr-label", right && "text-right")} aria-sort={sort.by === by ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" className="inline-flex items-center gap-1" onClick={() => sortBy(by)}>
        {children}{sort.by === by && (sort.dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
      </button>
    </TableHead>
  );

  return (
    <div className="space-y-6">
      <form className="border border-[var(--hr-rule)] bg-[var(--hr-surface)] p-4 space-y-3" onSubmit={(e) => { e.preventDefault(); apply(); }} aria-label="Filters">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1.3fr_0.8fr_0.8fr_1.3fr_auto_auto_auto] lg:items-end">
          <div className="space-y-1"><Label htmlFor="a-drive">Drive</Label>
            <NativeSelect id="a-drive" value={form.driveId} onChange={(e) => set({ driveId: e.target.value })}>
              <option value="">All drives</option>
              {drives.data?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </NativeSelect></div>
          <div className="space-y-1"><Label htmlFor="a-from">From</Label><Input id="a-from" type="date" value={form.from} onChange={(e) => set({ from: e.target.value })} /></div>
          <div className="space-y-1"><Label htmlFor="a-to">To</Label><Input id="a-to" type="date" value={form.to} onChange={(e) => set({ to: e.target.value })} /></div>
          <div className="space-y-1"><Label htmlFor="a-search">Search</Label>
            <Input id="a-search" value={form.search} onChange={(e) => set({ search: e.target.value })} placeholder="Name, roll no or email" /></div>
          <Button type="submit">Apply filters</Button>
          <Button type="button" variant="ghost" onClick={reset}>Clear</Button>
          <Button type="button" variant="outline" aria-expanded={moreOpen} aria-controls="analytics-advanced-filters"
            onClick={() => setMoreOpen((o) => !o)}>
            More filters{countAdvanced(form) > 0 ? ` (${countAdvanced(form)})` : ""}
          </Button>
        </div>

        <div id="analytics-advanced-filters" className={cn("space-y-3 border-t border-[var(--hr-rule)] pt-3", !moreOpen && "hidden")}>
          {facets.data?.departments.length ? (
            <div className="flex flex-wrap gap-2 items-center"><span className="hr-label w-20">Branch</span>
              {facets.data.departments.map((d) => <CheckChip key={d} label={d} checked={form.departments.includes(d)} onChange={(on) => set({ departments: toggle(form.departments, d, on) })} />)}
            </div>
          ) : null}
          {facets.data?.batchYears.length ? (
            <div className="flex flex-wrap gap-2 items-center"><span className="hr-label w-20">Batch</span>
              {facets.data.batchYears.map((y) => <CheckChip key={y} label={String(y)} checked={form.batchYears.includes(y)} onChange={(on) => set({ batchYears: toggle(form.batchYears, y, on) })} />)}
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2 items-center"><span className="hr-label w-20">Integrity</span>
            {(["high", "medium", "low"] as Band[]).map((b) => <CheckChip key={b} label={BAND_LABEL[b]} checked={form.bands.includes(b)} onChange={(on) => set({ bands: toggle(form.bands, b, on) })} />)}
          </div>
          <div className="flex flex-wrap gap-2 items-center"><span className="hr-label w-20">Status</span>
            {(["assigned", "in_progress", "completed", "absent"] as AttemptStatus[]).map((st) => (
              <CheckChip key={st} label={STATUS_LABEL[st]} checked={form.statuses.includes(st)} onChange={(on) => set({ statuses: toggle(form.statuses, st, on) })} />
            ))}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
            <div className="space-y-1"><Label htmlFor="a-sec">Sections</Label><Input id="a-sec" value={form.sections} onChange={(e) => set({ sections: e.target.value })} placeholder="A, B" /></div>
            <div className="space-y-1"><Label htmlFor="a-cmin">CGPA from</Label><Input id="a-cmin" inputMode="decimal" value={form.cgpaMin} onChange={(e) => set({ cgpaMin: e.target.value })} /></div>
            <div className="space-y-1"><Label htmlFor="a-cmax">CGPA to</Label><Input id="a-cmax" inputMode="decimal" value={form.cgpaMax} onChange={(e) => set({ cgpaMax: e.target.value })} /></div>
            <div className="space-y-1"><Label htmlFor="a-back">Max backlogs</Label><Input id="a-back" inputMode="numeric" value={form.maxBacklogs} onChange={(e) => set({ maxBacklogs: e.target.value })} /></div>
            <div className="space-y-1"><Label htmlFor="a-smin">Overall % from</Label><Input id="a-smin" inputMode="decimal" value={form.scoreMin} onChange={(e) => set({ scoreMin: e.target.value })} /></div>
            <div className="space-y-1"><Label htmlFor="a-smax">Overall % to</Label><Input id="a-smax" inputMode="decimal" value={form.scoreMax} onChange={(e) => set({ scoreMax: e.target.value })} /></div>
          </div>
        </div>
      </form>

      {s && (
        <div className="grid sm:grid-cols-4 gap-3">
          <Stat label="Invited" value={s.funnel.invited} />
          <Stat label="Activated" value={s.funnel.activated} />
          <Stat label="Started" value={s.funnel.started} />
          <Stat label="Completed" value={s.funnel.completed} hint={`of ${total} assigned in this view`} />
        </div>
      )}
      {s && (s.byDepartment.length > 0 || s.dimensions.length > 0) && (
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="border border-[var(--hr-rule)] bg-[var(--hr-surface)] p-3">
            <p className="hr-label mb-2">By branch · average overall %</p>
            <ul className="text-sm">{s.byDepartment.map((d) => (
              <li key={d.department} className="flex justify-between items-center gap-3 hr-rule-b py-1.5">
                <span>{d.department} <span className="text-[var(--hr-muted)]">({d.students})</span></span>
                {d.avg == null ? <span className="text-[var(--hr-muted)]">–</span> : (
                  <span className="inline-flex items-center gap-2"><span className="hr-data">{d.avg}</span><StatStrip value={d.avg} series="overall" /></span>
                )}
              </li>
            ))}</ul></div>
          <div className="border border-[var(--hr-rule)] bg-[var(--hr-surface)] p-3">
            <p className="hr-label mb-2">Skills · average, 0–100</p>
            {s.dimensions.length ? <ul className="text-sm">{s.dimensions.map((d) => {
              const series = DIMENSION_SERIES[d.dimension];
              return (
                <li key={d.dimension} className="flex justify-between items-center gap-3 hr-rule-b py-1.5">
                  <span>{DIMENSION_LABEL[d.dimension] ?? d.dimension}</span>
                  {d.avg == null ? <span className="text-[var(--hr-muted)]">–</span> : series ? (
                    <span className="inline-flex items-center gap-2"><span className="hr-data">{d.avg}</span><StatStrip value={d.avg} series={series} /></span>
                  ) : <span className="hr-data">{d.avg}</span>}
                </li>
              );
            })}</ul> : <p className="text-sm text-[var(--hr-muted)]">No skill scores yet.</p>}</div>
        </div>
      )}

      <div className="flex justify-between items-center">
        <p className="hr-data text-sm text-[var(--hr-muted)]">{total} rows</p>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={exporting || total === 0} onClick={() => void exportAs("csv")}><Download className="h-4 w-4 mr-1" />CSV</Button>
          <Button size="sm" variant="outline" disabled={exporting || total === 0} onClick={() => void exportAs("xlsx")}><Download className="h-4 w-4 mr-1" />Excel</Button>
        </div>
      </div>

      {data.isLoading ? <Loading /> : data.error ? <Empty title="Couldn't load analytics" body={friendly(data.error)} /> : total === 0 ? (
        <Empty title="Nothing to show" body="No assigned students match these filters yet." />
      ) : (
        <>
          <Table>
            <TableHeader><TableRow className="hover:bg-transparent">
              <Th by="roll_no">Roll no</Th><Th by="full_name">Name</Th><Th by="department">Branch</Th><TableHead className="hr-label">Drive</TableHead>
              <Th by="cgpa" right>CGPA</Th><Th by="status">Status</Th><Th by="coding" right>Coding %</Th><Th by="mcq" right>MCQ %</Th>
              <Th by="interview" right>Interview %</Th><Th by="overall" right>Overall %</Th><Th by="integrity_score">Integrity</Th>
            </TableRow></TableHeader>
            <TableBody>
              {data.data!.rows.map((r) => (
                <TableRow key={`${r.student_id}-${r.drive_id}`}>
                  <TableCell className="hr-data text-xs text-[var(--hr-muted)]">{r.roll_no}</TableCell><TableCell>{r.full_name}</TableCell>
                  <TableCell>{r.department ?? "–"}</TableCell><TableCell className="text-xs text-[var(--hr-muted)]">{r.drive_name}</TableCell>
                  <TableCell className="hr-data text-right">{r.cgpa ?? "–"}</TableCell>
                  <TableCell><Chip tone={STATUS_TONE[r.status] ?? "muted"}>{STATUS_LABEL[r.status] ?? r.status}</Chip></TableCell>
                  <ScoreCell value={r.coding} series="test" /><ScoreCell value={r.mcq} series="test" />
                  <ScoreCell value={r.interview} series="interview" /><ScoreCell value={r.overall} series="overall" bold />
                  <TableCell>{r.integrity_band ? <span className={r.integrity_band === "low" ? "text-[var(--hr-red-ink)]" : undefined}>{BAND_LABEL[r.integrity_band]} ({r.integrity_score})</span> : <span className="text-[var(--hr-muted)]">–</span>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex justify-end items-center gap-2 text-sm">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
            <span className="hr-data text-xs">Page {page} of {Math.max(1, Math.ceil(total / PAGE_SIZE))}</span>
            <Button size="sm" variant="outline" disabled={page * PAGE_SIZE >= total} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        </>
      )}
      <p className="text-xs text-[var(--hr-muted)]">Integrity is an AI proctoring score that flags sessions for review; it is not proof of cheating.</p>
    </div>
  );
}

function ScoreCell({ value, series, bold }: { value: number | null; series: Series; bold?: boolean }) {
  return (
    <TableCell className="text-right">
      {value == null ? <span className="text-[var(--hr-muted)]">–</span> : (
        <span className="inline-flex items-center justify-end gap-2">
          <span className={cn("hr-data", bold && "font-semibold text-foreground")}>{value}</span>
          <StatStrip value={value} series={series} />
        </span>
      )}
    </TableCell>
  );
}
