import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Loading, Empty } from "../layout/V1Shell";
import { Chip, PlayerCard, Scorebug, StatStrip, type Series } from "../ui/broadcast";
import { collegeApi, ApiError } from "../lib/api";
import { CheckChip, CollegeShell, toggle } from "./CollegeShell";
import { describeEligibility } from "./lib/filters";
import { BAND_LABEL, STATUS_LABEL } from "../../../supabase/functions/_shared/college-table";
import { driveStatusLabel, RELEASE_TEXT } from "./DrivesPage";
import { fmtDateTime, friendly, useDrive, type DriveRecord } from "./queries";
import { DriveReplayDialog } from "../replay/CodeReplay";

const PAGE = 50;

export default function DriveDetailPage() {
  const { driveId = "" } = useParams();
  return <CollegeShell>{({ orgId, isAdmin }) => <DriveDetail orgId={orgId} driveId={driveId} isAdmin={isAdmin} />}</CollegeShell>;
}

function DriveDetail({ orgId, driveId, isAdmin }: { orgId: string; driveId: string; isAdmin: boolean }) {
  const drive = useDrive(driveId);
  if (drive.isLoading) return <Loading />;
  if (!drive.data) return <Empty title="Drive not found" body={drive.error ? friendly(drive.error) : undefined} />;
  return <DriveView orgId={orgId} drive={drive.data} isAdmin={isAdmin} />;
}

export function DriveView({ orgId, drive, isAdmin }: { orgId: string; drive: DriveRecord; isAdmin: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [page, setPage] = useState(1);
  const [confirmRelease, setConfirmRelease] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [replayOpen, setReplayOpen] = useState(false);
  const [statuses, setStatuses] = useState<StatusKey[]>([]);
  const [bands, setBands] = useState<BandKey[]>([]);
  const [search, setSearch] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const narrow = useNarrow();
  const filters = {
    driveId: drive.id,
    ...(statuses.length ? { status: statuses } : {}),
    ...(bands.length ? { integrityBands: bands } : {}),
    ...(search ? { search } : {}),
  };
  const filtered = statuses.length > 0 || bands.length > 0 || !!search;
  const results = useQuery({
    // The unfiltered key stays [.., drive.id, page] so the page's cache (and the gallery fixtures) line up.
    queryKey: filtered ? ["b2b-college", "drive-results", drive.id, page, statuses, bands, search] : ["b2b-college", "drive-results", drive.id, page],
    queryFn: () => collegeApi("analytics", { orgId, filters, page, pageSize: PAGE, sort: { by: "roll_no", dir: "asc" } }),
  });
  // The scorebug, the status tab counts and the release dialog describe the whole drive, never the filtered view:
  // the server's summary is computed over the filtered rows, so they read the unfiltered first page instead (the same
  // cache entry as `results` when no filter is on).
  const overview = useQuery({
    queryKey: ["b2b-college", "drive-results", drive.id, 1],
    queryFn: () => collegeApi("analytics", { orgId, filters: { driveId: drive.id }, page: 1, pageSize: PAGE, sort: { by: "roll_no", dir: "asc" } }),
  });
  const onSearch = (e: FormEvent) => { e.preventDefault(); setPage(1); setSearch(searchDraft.trim()); };
  const clearFilters = () => { setStatuses([]); setBands([]); setSearch(""); setSearchDraft(""); setPage(1); };
  const refresh = () => void qc.invalidateQueries({ queryKey: ["b2b-college"] });

  const assign = async () => {
    setBusy(true);
    try {
      const r = await collegeApi("assignDrive", { driveId: drive.id });
      toast({ title: `${r.assigned} students assigned`, description: `${r.alreadyAssigned} were already assigned · ${r.ineligible} not eligible` });
      refresh();
    } catch (e) {
      toast({ title: "Couldn't assign", description: e instanceof ApiError ? e.message : friendly(e), variant: "destructive" });
    } finally { setBusy(false); }
  };

  const release = async () => {
    setBusy(true);
    try {
      await collegeApi("releaseResults", { driveId: drive.id });
      toast({ title: "Results released", description: "Students can now see their scores for this drive." });
      refresh();
    } catch (e) {
      toast({ title: "Couldn't release results", description: e instanceof ApiError ? e.message : friendly(e), variant: "destructive" });
    } finally { setBusy(false); setConfirmRelease(false); }
  };

  const counts = overview.data?.summary.byStatus;
  const assignedTotal = overview.data?.total ?? 0;
  const total = results.data?.total ?? 0;
  const canRelease = isAdmin && drive.results_release === "manual" && !drive.results_released_at;
  const parts = [drive.assessment_id && "Coding / MCQ test", drive.interview_module_id && "AI interview", drive.resume_task && "Resume task"].filter(Boolean);
  const label = driveStatusLabel(drive);
  const rows = results.data?.rows ?? [];
  const picked = rows.find((r) => r.student_id === selected) ?? null;

  // On a wide screen the player card is part of the first view: open it once on the first finished student. Only once,
  // so closing the card keeps it closed.
  const autoPicked = useRef(false);
  useEffect(() => {
    if (autoPicked.current || selected || !rows.length || typeof window === "undefined" || !window.matchMedia?.("(min-width: 1280px)").matches) return;
    autoPicked.current = true;
    setSelected((rows.find((r) => r.status === "completed") ?? rows[0]).student_id);
  }, [rows, selected]);

  return (
    <div className="space-y-4">
      <nav aria-label="Breadcrumb" className="text-xs text-[var(--hr-muted)]">
        <Link to={`/c/${orgId}/drives`} className="hover:text-foreground">Drives</Link> / <span className="text-foreground">{drive.name}</span>
      </nav>

      <Scorebug
        head={(
          <>
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 className="hr-display text-[26px]">{drive.name}</h2>
              <Chip tone={label === "Open" ? "blue" : label === "Closed" ? "muted" : "plain"} solid={label === "Open"}>{label}</Chip>
            </div>
            <p className="text-sm text-[var(--hr-muted)] mt-1.5">{parts.join(" + ") || "Nothing to do yet"} · {describeEligibility(drive.eligibility)}</p>
            <p className="text-sm text-[var(--hr-muted)]">
              <span className="hr-data text-foreground">{fmtDateTime(drive.window_start)} – {fmtDateTime(drive.window_end)}</span>
              {" · "}Results: {drive.results_released_at ? `released ${fmtDateTime(drive.results_released_at)}` : RELEASE_TEXT[drive.results_release]}
            </p>
          </>
        )}
        counters={[
          { label: "Assigned", value: counts ? assignedTotal : "–" },
          { label: "Completed", short: "Done", value: counts?.completed ?? "–", tone: "gold", hint: "Finished both the test and the interview" },
          { label: "In progress", short: "Started", value: counts?.in_progress ?? "–", live: label === "Open" && !!counts?.in_progress },
          { label: "Not started", short: "Waiting", value: counts?.assigned ?? "–" },
          { label: "Absent", value: counts?.absent ?? "–", hint: "Did not start before the window closed" },
        ]}
      />

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void assign()} disabled={busy || drive.status === "closed"}>Assign eligible students</Button>
        {canRelease && <Button variant="outline" onClick={() => setConfirmRelease(true)} disabled={busy}>Release results</Button>}
        <Button variant="outline" asChild><Link to={`/c/${orgId}/analytics?drive=${drive.id}`}>Analytics</Link></Button>
        <Button variant="outline" asChild><Link to={`/c/${orgId}/drives/${drive.id}/edit`}>Edit</Link></Button>
      </div>

      {/* Decision D4: status is a tab bar with counts; integrity and search sit behind one Filters button. */}
      <div className="flex flex-wrap items-end gap-x-2 gap-y-2 hr-rule-b">
        <div role="tablist" aria-label="Status" className="flex items-stretch overflow-x-auto -mb-px">
          {[{ key: "all" as const, label: "All", n: counts ? assignedTotal : undefined }, ...STATUS_KEYS.map((k) => ({ key: k, label: STATUS_LABEL[k], n: counts?.[k] }))].map((t) => {
            const on = t.key === "all" ? statuses.length === 0 : statuses.length === 1 && statuses[0] === t.key;
            return (
              <button key={t.key} type="button" role="tab" aria-selected={on}
                      onClick={() => { setPage(1); setStatuses(t.key === "all" ? [] : [t.key]); }}
                      className={cn("px-3 py-2 text-sm whitespace-nowrap", on ? "text-foreground shadow-[inset_0_-2px_0_var(--hr-orange)]" : "text-[var(--hr-muted)] hover:text-foreground")}>
                {t.label} <span className="hr-data text-xs ml-1">{t.n ?? "–"}</span>
              </button>
            );
          })}
        </div>
        <div className="ml-auto flex items-center gap-2 pb-1.5">
          {filtered && <Button type="button" size="sm" variant="ghost" onClick={clearFilters}>Clear</Button>}
          <Button type="button" size="sm" variant="outline" aria-expanded={showFilters} onClick={() => setShowFilters((v) => !v)}>
            Filters{bands.length || search ? ` (${bands.length + (search ? 1 : 0)})` : ""}
          </Button>
        </div>
      </div>
      {showFilters && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2" role="group" aria-label="Filter students">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="hr-label mr-1">Integrity</span>
            {BAND_KEYS.map((k) => (
              <CheckChip key={k} label={BAND_LABEL[k]} checked={bands.includes(k)}
                         onChange={(on) => { setPage(1); setBands((l) => toggle(l, k, on)); }} />
            ))}
          </div>
          <form onSubmit={onSearch} className="flex items-center gap-2 w-full sm:w-auto">
            <Input aria-label="Search students" placeholder="Name or roll no" value={searchDraft}
                   onChange={(e) => setSearchDraft(e.target.value)} className="h-9 sm:w-56" />
          </form>
        </div>
      )}

      {results.isLoading ? <Loading /> : results.error ? <Empty title="Couldn't load students" body={friendly(results.error)} /> :
        total === 0 && filtered ? <Empty title="No students match these filters" body="Change or clear the filters to see everyone assigned to this drive." /> :
        total === 0 ? <Empty stage title="No students assigned yet" body="Use “Assign eligible students” to add everyone who matches the rules." /> : (
          <div className={cn("grid gap-4 items-start", picked && "xl:grid-cols-[minmax(0,1fr)_320px]")}>
            <div className="min-w-0 order-last xl:order-none">
              {narrow ? (
                <ul aria-label="Students" className="hr-rule-t">
                  {rows.map((r, i) => (
                    <li key={r.student_id} className="hr-rule-b py-3 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1.5 items-center">
                      <button type="button" className="text-left min-w-0" aria-pressed={r.student_id === selected}
                              onClick={() => setSelected(r.student_id === selected ? null : r.student_id)}>
                        <span className="block truncate">{r.full_name}</span>
                        <span className="hr-data text-xs text-[var(--hr-muted)]">{r.roll_no} · {r.department ?? "–"}</span>
                      </button>
                      <StatusChip status={r.status} />
                      <span className="hr-data text-xs text-[var(--hr-muted)]">
                        Coding {r.coding ?? "–"} · MCQ {r.mcq ?? "–"} · Interview {r.interview ?? "–"}
                      </span>
                      <span className="inline-flex items-center gap-2 justify-self-end">
                        <span className="hr-data text-sm">{r.overall ?? "–"}</span>
                        <StatStrip value={r.overall} series="overall" index={i} label={`Overall ${r.overall ?? "not scored"}`} />
                      </span>
                      {r.integrity_band === "low" && <span className="col-span-2"><IntegrityCell band={r.integrity_band} score={r.integrity_score} /></span>}
                    </li>
                  ))}
                </ul>
              ) : (
              <Table>
                <TableHeader><TableRow className="hover:bg-transparent">
                  <TableHead className="hr-label">Roll no</TableHead><TableHead className="hr-label">Name</TableHead>
                  <TableHead className="hr-label">Branch</TableHead><TableHead className="hr-label">Status</TableHead>
                  <TableHead className="hr-label text-right">Coding</TableHead><TableHead className="hr-label text-right">MCQ</TableHead>
                  <TableHead className="hr-label text-right">Interview</TableHead><TableHead className="hr-label text-right">Overall %</TableHead>
                  <TableHead className="hr-label">Integrity</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {rows.map((r, i) => (
                    <TableRow key={r.student_id} data-state={r.student_id === selected ? "selected" : undefined}
                              className="cursor-pointer data-[state=selected]:bg-[var(--hr-surface-2)]"
                              onClick={() => setSelected(r.student_id === selected ? null : r.student_id)}>
                      <TableCell className="hr-data text-xs text-[var(--hr-muted)]">{r.roll_no}</TableCell>
                      <TableCell>
                        <button type="button" className="text-left hover:text-[var(--hr-orange)]" aria-pressed={r.student_id === selected}
                                onClick={(e) => { e.stopPropagation(); setSelected(r.student_id === selected ? null : r.student_id); }}>
                          {r.full_name}
                        </button>
                      </TableCell>
                      <TableCell>{r.department ?? "–"}</TableCell>
                      <TableCell><StatusChip status={r.status} /></TableCell>
                      <ScoreCell value={r.coding} series="test" index={i} />
                      <ScoreCell value={r.mcq} series="test" index={i} />
                      <ScoreCell value={r.interview} series="interview" index={i} />
                      <ScoreCell value={r.overall} series="overall" index={i} />
                      <TableCell><IntegrityCell band={r.integrity_band} score={r.integrity_score} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              )}
              <div className="flex justify-end items-center gap-2 text-sm mt-3">
                <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
                <span className="hr-data text-xs">Page {page} of {Math.max(1, Math.ceil(total / PAGE))}</span>
                <Button size="sm" variant="outline" disabled={page * PAGE >= total} onClick={() => setPage((p) => p + 1)}>Next</Button>
              </div>
            </div>
            {picked && (
              <PlayerCard open name={picked.full_name} code={picked.roll_no}
                meta={[picked.department, picked.batch_year && `Batch ${picked.batch_year}`].filter(Boolean).join(" · ")}
                headline={{ label: "Overall", value: picked.overall ?? "–" }}
                stats={[
                  { label: "Coding", value: picked.coding ?? "–", series: "test", score: picked.coding },
                  { label: "MCQ", value: picked.mcq ?? "–", series: "test", score: picked.mcq },
                  { label: "Interview", value: picked.interview ?? "–", series: "interview", score: picked.interview },
                  { label: "Integrity", value: <IntegrityCell band={picked.integrity_band} score={picked.integrity_score} /> },
                  { label: "CGPA", value: picked.cgpa ?? "–" },
                  { label: "Backlogs", value: picked.active_backlogs ?? "–" },
                ]}
                onClose={() => setSelected(null)} closeLabel={`Close ${picked.full_name} summary`}>
                <p className="text-xs text-[var(--hr-muted)]">Status: {STATUS_LABEL[picked.status] ?? picked.status}. Scores are evidence for your decision; AI suggests, people decide.</p>
                {picked.status !== "assigned" && (
                  <Button size="sm" variant="outline" className="mt-2" onClick={() => setReplayOpen(true)}>Code replay</Button>
                )}
              </PlayerCard>
            )}
            {picked && (
              <DriveReplayDialog driveId={drive.id} studentId={picked.student_id} name={picked.full_name}
                                 open={replayOpen} onOpenChange={setReplayOpen} />
            )}
          </div>
        )}

      <AlertDialog open={confirmRelease} onOpenChange={setConfirmRelease}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Release results for {drive.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              All {assignedTotal} assigned students will see their scores on their dashboard, including students who finish later.
              This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void release()}>Release results</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

const STATUS_TONE: Record<string, "gold" | "blue" | "muted" | "plain"> = { completed: "gold", in_progress: "blue", assigned: "muted", absent: "muted" };

function StatusChip({ status }: { status: string }) {
  return <Chip tone={STATUS_TONE[status] ?? "muted"}>{STATUS_LABEL[status] ?? status}</Chip>;
}

function ScoreCell({ value, series, index }: { value: number | null; series: Series; index: number }) {
  return (
    <TableCell className="text-right">
      {value == null ? <span className="text-[var(--hr-muted)]">–</span> : (
        <span className="inline-flex flex-col items-end gap-1">
          <span className="hr-data text-sm">{value}</span>
          <StatStrip value={value} series={series} index={index} />
        </span>
      )}
    </TableCell>
  );
}

/** Integrity band: evidence for review, never a verdict. Low is the only band that asks for a look. */
function IntegrityCell({ band, score }: { band: string | null; score: number | null }) {
  if (!band) return <span className="text-[var(--hr-muted)]">–</span>;
  const text = `${BAND_LABEL[band] ?? band}${score != null ? ` (${score})` : ""}`;
  return band === "low" ? <Chip tone="red">{text} · review</Chip> : <span className="text-sm">{text}</span>;
}

const STATUS_KEYS = ["assigned", "in_progress", "completed", "absent"] as const;
type StatusKey = (typeof STATUS_KEYS)[number];
const BAND_KEYS = ["high", "medium", "low"] as const;
type BandKey = (typeof BAND_KEYS)[number];

/** Phones (under 768px) get stacked rows; tables keep their columns from tablets up. */
function useNarrow(): boolean {
  const q = "(max-width: 767px)";
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.(q).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(q);
    if (!mq) return;
    const on = () => setNarrow(mq.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return narrow;
}
