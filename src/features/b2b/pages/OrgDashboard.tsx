import { Fragment, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Download, Loader2, TrendingDown, TrendingUp } from "lucide-react";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from "recharts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { CenteredSpinner, EmptyState, StatCard } from "../components/B2BShell";
import { useOrgContext } from "../components/OrgContext";
import { useDashboardData } from "../hooks/useDashboard";
import {
  GAP_LABEL, QUICK_VIEWS, applyFilters, batchSummary, heatClass, round1, summarize,
  type Filters, type Readiness, type StudentSummary,
} from "../lib/dashboard";
import { friendlyDbError } from "../lib/format";
import { DIMENSIONS, DIMENSION_LABEL, type Dimension } from "../lib/shared";
import { READINESS_LABEL } from "../lib/report-style";

const SHORT: Record<Dimension, string> = {
  technical_knowledge: "Tech", communication: "Comm", language: "English", analytical_thinking: "Analytical",
  problem_solving: "Problem", confidence: "Confid.", role_specific_knowledge: "Module", resume_project_knowledge: "Projects",
};
const READINESS_BAR: Record<Readiness | "not_attempted", string> = {
  ready: "bg-emerald-500", developing: "bg-amber-500", not_ready: "bg-red-500", not_attempted: "bg-white/15",
};
const ALL = "__all";

type SortKey = "name" | "overall" | "delta" | Dimension | `topic:${string}`;

function weekKey(iso: string) {
  const d = new Date(iso);
  const day = (d.getUTCDay() + 6) % 7; // Monday start
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

/** /org/:orgId/dashboard */
export default function OrgDashboard() {
  const { org } = useOrgContext();
  const q = useDashboardData(org.id);
  const navigate = useNavigate();
  const { toast } = useToast();
  const [moduleId, setModuleId] = useState<string>(ALL);
  const [batchId, setBatchId] = useState<string>(ALL);
  const [department, setDepartment] = useState<string>(ALL);
  const [readiness, setReadiness] = useState<Array<Readiness | "not_attempted">>([]);
  const [view, setView] = useState("all");
  const [search, setSearch] = useState("");
  const [columns, setColumns] = useState<"skills" | "topics">("skills");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "overall", dir: 1 });
  const [exporting, setExporting] = useState(false);

  const modules = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of q.data?.evals ?? []) m.set(e.module_id, e.module_name);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [q.data]);
  const departments = useMemo(
    () => [...new Set((q.data?.batches ?? []).map((b) => b.department).filter((d): d is string => !!d))].sort(),
    [q.data],
  );

  const scopedModule = moduleId === ALL ? null : moduleId;
  const all = useMemo(() => (q.data ? summarize(q.data.roster, q.data.evals, scopedModule) : []), [q.data, scopedModule]);
  const filters: Filters = {
    ...QUICK_VIEWS.find((v) => v.id === view)?.filters,
    readiness: readiness.length ? readiness : undefined,
    batchId: batchId === ALL ? null : batchId,
    department: department === ALL ? null : department,
    search,
  };
  const rows = useMemo(() => applyFilters(all, filters), [all, JSON.stringify(filters)]); // eslint-disable-line react-hooks/exhaustive-deps
  const summary = useMemo(() => batchSummary(rows), [rows]);
  const topicCols = useMemo(() => [...new Set(rows.flatMap((r) => Object.keys(r.topics)))], [rows]);
  const showTopics = columns === "topics" && !!scopedModule;

  const sorted = useMemo(() => {
    const val = (r: StudentSummary): number | string | null => {
      if (sort.key === "name") return r.student.full_name ?? "";
      if (sort.key === "overall") return r.overall_latest;
      if (sort.key === "delta") return r.delta;
      if (sort.key.startsWith("topic:")) return r.topics[sort.key.slice(6)] ?? null;
      return r.dims[sort.key as Dimension];
    };
    return [...rows].sort((a, b) => {
      const va = val(a), vb = val(b);
      if (va === null && vb === null) return 0;
      if (va === null) return 1; // no data always last
      if (vb === null) return -1;
      return (typeof va === "string" ? va.localeCompare(vb as string) : va - (vb as number)) * sort.dir;
    });
  }, [rows, sort]);

  const trend = useMemo(() => {
    const scoped = (q.data?.evals ?? []).filter((e) => (!scopedModule || e.module_id === scopedModule) && rows.some((r) => r.student.user_id === e.user_id));
    const byWeek = new Map<string, number[]>();
    for (const e of scoped) if (e.overall_score !== null) byWeek.set(weekKey(e.started_at), [...(byWeek.get(weekKey(e.started_at)) ?? []), e.overall_score]);
    return [...byWeek.entries()].sort().map(([w, xs]) => ({
      week: new Date(w).toLocaleDateString("en-IN", { day: "numeric", month: "short" }),
      avg: round1(xs.reduce((a, b) => a + b, 0) / xs.length), n: xs.length,
    }));
  }, [q.data, scopedModule, rows]);

  const toggleSort = (key: SortKey) => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : key === "name" ? 1 : 1 }));
  const toggleReadiness = (r: Readiness | "not_attempted") =>
    setReadiness((xs) => (xs.includes(r) ? xs.filter((x) => x !== r) : [...xs, r]));

  const exportXlsx = async () => {
    setExporting(true);
    try {
      const { buildBatchWorkbook, downloadBlob } = await import("../lib/export-xlsx");
      const scope = [
        scopedModule ? modules.find(([id]) => id === scopedModule)?.[1] : "All modules",
        batchId !== ALL ? q.data?.batches.find((b) => b.id === batchId)?.name : null,
        department !== ALL ? department : null,
        view !== "all" ? QUICK_VIEWS.find((v) => v.id === view)?.label : null,
      ].filter(Boolean).join(" · ");
      const buf = await buildBatchWorkbook({ orgName: org.name, scopeLabel: scope, rows: sorted, summary, isDemo: org.is_demo });
      downloadBlob(`${org.slug}-readiness-${new Date().toISOString().slice(0, 10)}.xlsx`, buf, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    } catch (e) {
      toast({ title: "Export failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setExporting(false);
    }
  };

  if (q.isLoading) return <CenteredSpinner />;
  if (q.error) {
    const msg = String((q.error as { message?: string }).message ?? "");
    if (/PLAN_FEATURE/.test(msg)) {
      return (
        <EmptyState title="The batch dashboard is part of the Pilot and Pro plans" body="On this plan you can open each student's individual reports from the Overview tab.">
          <Button asChild variant="secondary"><Link to={`/org/${org.id}`}>Go to students</Link></Button>
        </EmptyState>
      );
    }
    return <EmptyState title="Couldn't load the dashboard" body={friendlyDbError(q.error)} />;
  }
  if (!q.data?.evals.length) {
    return <EmptyState title="No scored interviews yet" body="The dashboard fills in as students complete interviews. Each report appears here about a minute after the interview ends." />;
  }

  const Header = ({ k, children, className }: { k: SortKey; children: React.ReactNode; className?: string }) => (
    <th scope="col" className={cn("px-2 py-2 font-medium text-xs text-muted-foreground whitespace-nowrap", className)}>
      <button onClick={() => toggleSort(k)} className="hover:text-foreground" aria-label={`Sort by ${typeof children === "string" ? children : k}`}>
        {children}{sort.key === k ? (sort.dir === 1 ? " ↑" : " ↓") : ""}
      </button>
    </th>
  );

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <Select value={moduleId} onValueChange={(v) => { setModuleId(v); if (v === ALL) setColumns("skills"); }}>
          <SelectTrigger className="w-52" aria-label="Module"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All modules</SelectItem>
            {modules.map(([id, name]) => <SelectItem key={id} value={id}>{name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={batchId} onValueChange={setBatchId}>
          <SelectTrigger className="w-44" aria-label="Batch"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All batches</SelectItem>
            {q.data.batches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
          </SelectContent>
        </Select>
        {departments.length > 1 && (
          <Select value={department} onValueChange={setDepartment}>
            <SelectTrigger className="w-40" aria-label="Department"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All departments</SelectItem>
              {departments.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or roll no" className="w-52" aria-label="Search students" />
        <Button variant="secondary" size="sm" className="ml-auto" onClick={exportXlsx} disabled={exporting || !rows.length}>
          {exporting ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Download className="h-4 w-4 mr-1" />} Export Excel
        </Button>
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Quick views">
        {QUICK_VIEWS.map((v) => (
          <button
            key={v.id}
            onClick={() => setView(v.id)}
            aria-pressed={view === v.id}
            className={cn("rounded-full border px-3 py-1 text-sm", view === v.id ? "bg-white/10 border-violet-400" : "border-border/60 hover:bg-white/5")}
          >
            {v.label} <span className="text-muted-foreground tabular-nums">{v.id === "all" ? all.length : all.filter((r) => v.filters.gap?.includes(r.gap)).length}</span>
          </button>
        ))}
      </div>

      {/* Summary */}
      <div className="grid lg:grid-cols-3 gap-3">
        <div className="rounded-lg border border-border/60 bg-card/40 p-4 lg:col-span-1">
          <p className="text-xs text-muted-foreground mb-2">Readiness · {summary.students} students</p>
          <div className="flex h-3 rounded-full overflow-hidden" role="img" aria-label={`Ready ${summary.readiness.ready}, developing ${summary.readiness.developing}, not ready ${summary.readiness.not_ready}, not attempted ${summary.readiness.not_attempted}`}>
            {(["ready", "developing", "not_ready", "not_attempted"] as const).map((k) =>
              summary.readiness[k] ? <div key={k} className={READINESS_BAR[k]} style={{ width: `${(summary.readiness[k] / summary.students) * 100}%` }} /> : null)}
          </div>
          <div className="grid grid-cols-2 gap-1 mt-3 text-sm">
            {(["ready", "developing", "not_ready", "not_attempted"] as const).map((k) => (
              <button key={k} onClick={() => toggleReadiness(k)} aria-pressed={readiness.includes(k)}
                className={cn("flex items-center gap-2 rounded px-1.5 py-0.5 text-left", readiness.includes(k) && "bg-white/10")}>
                <span className={cn("h-2.5 w-2.5 rounded-sm", READINESS_BAR[k])} />
                <span className="flex-1">{k === "not_attempted" ? "Not attempted" : READINESS_LABEL[k]}</span>
                <span className="tabular-nums">{summary.readiness[k]}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <StatCard label="Average score (latest)" value={summary.avg_overall ?? "—"} hint={`${summary.interviews} scored interviews`} />
          <StatCard
            label="First → latest"
            value={summary.improvement.delta === null ? "—" : `${summary.improvement.delta > 0 ? "+" : ""}${summary.improvement.delta}`}
            tone={summary.improvement.delta !== null && summary.improvement.delta > 0 ? "ok" : undefined}
            hint={summary.improvement.students
              ? `${summary.improvement.first_avg} → ${summary.improvement.latest_avg} · ${summary.improvement.improved} up, ${summary.improvement.declined} down (${summary.improvement.students} students)`
              : "Needs students with 2+ interviews"}
          />
        </div>

        <div className="rounded-lg border border-border/60 bg-card/40 p-4">
          <p className="text-xs text-muted-foreground mb-2">Weakest topics</p>
          {summary.weakest_topics.length ? (
            <ol className="space-y-1.5 text-sm">
              {summary.weakest_topics.map((t) => (
                <li key={t.topic} className="flex items-center gap-2">
                  <span className="flex-1 truncate" title={t.topic}>{t.topic}</span>
                  <span className={cn("rounded px-1.5 text-xs tabular-nums", heatClass(t.avg))}>{t.avg}</span>
                  <span className="text-xs text-muted-foreground w-10 text-right">n={t.n}</span>
                </li>
              ))}
            </ol>
          ) : <p className="text-sm text-muted-foreground">Not enough data yet.</p>}
        </div>
      </div>

      {trend.length >= 2 && (
        <div className="rounded-lg border border-border/60 bg-card/40 p-4">
          <p className="text-xs text-muted-foreground mb-2">Average score by week</p>
          <div className="h-40">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trend} margin={{ left: -20, right: 8, top: 4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="week" tick={{ fontSize: 11, fill: "#9ca3af" }} />
                <YAxis domain={[0, 10]} tick={{ fontSize: 11, fill: "#9ca3af" }} />
                <Tooltip formatter={(v: number, _n, p) => [`${v} (${(p.payload as { n: number }).n} interviews)`, "Average"]} contentStyle={{ background: "#111", border: "1px solid #333" }} />
                <Line type="monotone" dataKey="avg" stroke="#a78bfa" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Dimension averages + change */}
      <div className="rounded-lg border border-border/60 bg-card/40 p-4">
        <p className="text-xs text-muted-foreground mb-3">Skill averages (latest) and change since first interview</p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-2">
          {DIMENSIONS.map((d) => {
            const avg = summary.dimension_avg[d], delta = summary.dimension_delta[d];
            return (
              <div key={d} className="flex items-center gap-2 text-sm">
                <span className="flex-1">{DIMENSION_LABEL[d]}</span>
                <span className={cn("rounded px-1.5 text-xs tabular-nums", heatClass(avg))}>{avg ?? "—"}</span>
                {delta !== null && delta !== 0 && (
                  <span className={cn("text-xs inline-flex items-center", delta > 0 ? "text-emerald-300" : "text-red-300")}>
                    {delta > 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}{delta > 0 ? "+" : ""}{delta}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Heatmap */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-semibold">Students × {showTopics ? "topics" : "skills"} <span className="text-sm text-muted-foreground font-normal">({sorted.length})</span></h2>
          {scopedModule && (
            <div className="flex rounded-md border border-border/60 text-xs overflow-hidden" role="group" aria-label="Columns">
              {(["skills", "topics"] as const).map((c) => (
                <button key={c} onClick={() => setColumns(c)} aria-pressed={columns === c}
                  className={cn("px-3 py-1", columns === c ? "bg-white/10" : "hover:bg-white/5")}>{c === "skills" ? "Skills" : "Topics"}</button>
              ))}
            </div>
          )}
        </div>
        {!sorted.length ? (
          <EmptyState title="No students match these filters" />
        ) : (
          <div className="rounded-lg border border-border/60 overflow-auto max-h-[70vh]">
            <table className="text-sm border-separate border-spacing-0 w-full">
              <thead className="sticky top-0 z-10 bg-background">
                <tr>
                  <Header k="name" className="text-left sticky left-0 bg-background min-w-44">Student</Header>
                  <Header k="overall">Overall</Header>
                  {showTopics
                    ? topicCols.map((t) => <Header key={t} k={`topic:${t}`} className="max-w-24"><span className="block max-w-24 truncate" title={t}>{t}</span></Header>)
                    : DIMENSIONS.map((d) => <Header key={d} k={d}><span title={DIMENSION_LABEL[d]}>{SHORT[d]}</span></Header>)}
                  <Header k="delta">Change</Header>
                  <th scope="col" className="px-2 py-2 text-xs text-muted-foreground font-medium text-left">Focus</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => {
                  const pass = r.latest?.pass_threshold ?? 6;
                  const cell = (v: number | null, label: string) => (
                    <td className="p-0.5">
                      <div className={cn("rounded text-center text-xs tabular-nums py-1 min-w-10", heatClass(v, pass))} title={`${label}: ${v ?? "no data"}`}>
                        {v ?? "·"}
                      </div>
                    </td>
                  );
                  return (
                    <tr key={r.student.user_id} className="hover:bg-white/[0.03] cursor-pointer" onClick={() => navigate(`/org/${org.id}/students/${r.student.user_id}`)}>
                      <td className="px-2 py-1.5 sticky left-0 bg-background">
                        <Link to={`/org/${org.id}/students/${r.student.user_id}`} className="hover:underline" onClick={(e) => e.stopPropagation()}>
                          {r.student.full_name ?? r.student.email}
                        </Link>
                        <div className="text-xs text-muted-foreground tabular-nums">{r.student.roll_no ?? ""}{r.student.batch_name ? ` · ${r.student.batch_name}` : ""}</div>
                      </td>
                      {cell(r.overall_latest, "Overall")}
                      {showTopics
                        ? topicCols.map((t) => <Fragment key={t}>{cell(r.topics[t] ?? null, t)}</Fragment>)
                        : DIMENSIONS.map((d) => <Fragment key={d}>{cell(r.dims[d], DIMENSION_LABEL[d])}</Fragment>)}
                      <td className="px-2 text-xs tabular-nums text-center">
                        {r.delta === null ? <span className="text-muted-foreground">—</span> : <span className={r.delta > 0 ? "text-emerald-300" : r.delta < 0 ? "text-red-300" : ""}>{r.delta > 0 ? "+" : ""}{r.delta}</span>}
                      </td>
                      <td className="px-2 text-xs whitespace-nowrap" title={r.primary_gap ?? undefined}>{GAP_LABEL[r.gap]}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-muted-foreground mt-2">
          Each cell is the student's latest score (0–10) in the selected scope. Green ≥ pass mark, amber within 2, red below; “·” = not enough evidence yet.
        </p>
      </div>
    </div>
  );
}
