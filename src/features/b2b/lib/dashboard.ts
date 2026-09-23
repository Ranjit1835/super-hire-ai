// ─── Batch dashboard aggregation (pure) ───────────────────────────────────────
// Input: the compact rows from org_dashboard_evaluations() + the org roster.
// Everything the dashboard shows (heatmap, filters, quick views, summary, trends,
// Excel export) is derived here so it is unit-tested and consistent across views.
import { DIMENSIONS, type Dimension } from "./shared";

export type Readiness = "not_ready" | "developing" | "ready";
export type GapCategory = "ready" | "technical" | "communication" | "analytical" | "not_attempted";

export interface DashEval {
  interview_id: string;
  user_id: string;
  module_id: string;
  module_name: string;
  module_type: string;
  pass_threshold: number;
  started_at: string;
  completed_at: string;
  overall_score: number | null;
  readiness_level: Readiness | null;
  primary_gap: string | null;
  dimensions: Partial<Record<Dimension, number | null>>;
  per_topic: Record<string, number | null>;
}

export interface RosterStudent {
  user_id: string;
  full_name: string | null;
  roll_no: string | null;
  email: string | null;
  batch_id: string | null;
  batch_name: string | null;
  department: string | null;
}

export interface StudentSummary {
  student: RosterStudent;
  interviews: DashEval[];          // oldest first, within the current module filter
  latest: DashEval | null;
  /** Latest interview per module (readiness is the lowest of these). */
  latest_by_module: DashEval[];
  first: DashEval | null;
  readiness: Readiness | null;
  gap: GapCategory;
  primary_gap: string | null;
  overall_latest: number | null;
  overall_first: number | null;
  delta: number | null;            // latest − first overall (≥ 2 interviews)
  dims: Record<Dimension, number | null>;       // latest non-null score per dimension
  topics: Record<string, number | null>;        // latest non-null score per topic
}

export const GAP_GROUPS: Record<Exclude<GapCategory, "ready" | "not_attempted">, Dimension[]> = {
  technical: ["technical_knowledge", "role_specific_knowledge"],
  communication: ["communication", "language", "confidence"],
  analytical: ["analytical_thinking", "problem_solving"],
};

export const GAP_LABEL: Record<GapCategory, string> = {
  ready: "Ready",
  technical: "Needs technical",
  communication: "Needs communication",
  analytical: "Needs analytical",
  not_attempted: "Not attempted",
};

const READINESS_ORDER: Readiness[] = ["not_ready", "developing", "ready"];

/**
 * A student is only as ready as their weakest module: take the latest interview of each
 * module attempted and use the lowest readiness. (A good HR round must not hide weak SQL.)
 */
export function studentReadiness(latestByModule: DashEval[]): Readiness | null {
  const levels = latestByModule.map((e) => e.readiness_level).filter((r): r is Readiness => !!r);
  if (!levels.length) return null;
  return READINESS_ORDER[Math.min(...levels.map((r) => READINESS_ORDER.indexOf(r)))];
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
export const round1 = (n: number | null) => (n === null ? null : Math.round(n * 10) / 10);

/** The weakest skill group decides the gap; "ready" students are shown as ready. */
export function gapCategory(dims: Record<Dimension, number | null>, readiness: Readiness | null): GapCategory {
  if (readiness === "ready") return "ready";
  let worst: GapCategory | null = null;
  let worstScore = Infinity;
  for (const [g, ds] of Object.entries(GAP_GROUPS) as Array<[keyof typeof GAP_GROUPS, Dimension[]]>) {
    const m = mean(ds.map((d) => dims[d]).filter((x): x is number => typeof x === "number"));
    if (m !== null && m < worstScore) { worstScore = m; worst = g; }
  }
  return worst ?? (readiness ? "technical" : "not_attempted");
}

function latestNonNull<K extends string>(evals: DashEval[], keys: K[], pick: (e: DashEval) => Partial<Record<K, number | null>>) {
  const out = Object.fromEntries(keys.map((k) => [k, null])) as Record<K, number | null>;
  for (const e of evals) { // oldest → newest, later overwrites
    const v = pick(e);
    for (const k of keys) if (typeof v[k] === "number") out[k] = v[k] as number;
  }
  return out;
}

export function summarize(roster: RosterStudent[], evals: DashEval[], moduleId?: string | null): StudentSummary[] {
  const scoped = moduleId ? evals.filter((e) => e.module_id === moduleId) : evals;
  const byUser = new Map<string, DashEval[]>();
  for (const e of [...scoped].sort((a, b) => a.started_at.localeCompare(b.started_at))) {
    byUser.set(e.user_id, [...(byUser.get(e.user_id) ?? []), e]);
  }
  const topicKeys = [...new Set(scoped.flatMap((e) => Object.keys(e.per_topic)))];
  return roster.map((student) => {
    const interviews = byUser.get(student.user_id) ?? [];
    const latest = interviews.at(-1) ?? null;
    const first = interviews[0] ?? null;
    const dims = latestNonNull(interviews, [...DIMENSIONS], (e) => e.dimensions);
    const topics = latestNonNull(interviews, topicKeys, (e) => e.per_topic);
    const byModule = new Map<string, DashEval>();
    for (const e of interviews) byModule.set(e.module_id, e); // oldest → newest
    const latestByModule = [...byModule.values()];
    const readiness = studentReadiness(latestByModule);
    const overallLatest = latest?.overall_score ?? null;
    const overallFirst = first?.overall_score ?? null;
    return {
      student, interviews, latest, first, readiness, latest_by_module: latestByModule,
      gap: latest ? gapCategory(dims, readiness) : "not_attempted",
      primary_gap: latest?.primary_gap ?? null,
      overall_latest: overallLatest,
      overall_first: overallFirst,
      delta: interviews.length >= 2 && overallLatest !== null && overallFirst !== null ? round1(overallLatest - overallFirst) : null,
      dims,
      topics,
    };
  });
}

export interface Filters {
  readiness?: Array<Readiness | "not_attempted">;
  gap?: GapCategory[];
  batchId?: string | null;
  department?: string | null;
  search?: string;
}

export function applyFilters(rows: StudentSummary[], f: Filters): StudentSummary[] {
  const q = f.search?.trim().toLowerCase();
  return rows.filter((r) =>
    (!f.readiness?.length || f.readiness.includes(r.readiness ?? "not_attempted")) &&
    (!f.gap?.length || f.gap.includes(r.gap)) &&
    (!f.batchId || r.student.batch_id === f.batchId) &&
    (!f.department || r.student.department === f.department) &&
    (!q || [r.student.full_name, r.student.roll_no, r.student.email].some((v) => v?.toLowerCase().includes(q))));
}

export const QUICK_VIEWS: Array<{ id: string; label: string; filters: Filters }> = [
  { id: "all", label: "All students", filters: {} },
  { id: "ready", label: "Ready", filters: { gap: ["ready"] } },
  { id: "technical", label: "Needs technical", filters: { gap: ["technical"] } },
  { id: "communication", label: "Needs communication", filters: { gap: ["communication"] } },
  { id: "analytical", label: "Needs analytical", filters: { gap: ["analytical"] } },
  { id: "not_attempted", label: "Not attempted", filters: { gap: ["not_attempted"] } },
];

export interface BatchSummary {
  students: number;
  attempted: number;
  interviews: number;
  readiness: Record<Readiness | "not_attempted", number>;
  gaps: Record<GapCategory, number>;
  avg_overall: number | null;
  dimension_avg: Record<Dimension, number | null>;
  weakest_topics: Array<{ topic: string; avg: number; n: number }>;
  improvement: { students: number; first_avg: number | null; latest_avg: number | null; delta: number | null; improved: number; declined: number };
  dimension_delta: Record<Dimension, number | null>;
}

export function batchSummary(rows: StudentSummary[], minTopicN = 2): BatchSummary {
  const attempted = rows.filter((r) => r.latest);
  const readiness = { ready: 0, developing: 0, not_ready: 0, not_attempted: 0 } as BatchSummary["readiness"];
  const gaps = { ready: 0, technical: 0, communication: 0, analytical: 0, not_attempted: 0 } as BatchSummary["gaps"];
  for (const r of rows) {
    readiness[r.readiness ?? "not_attempted"]++;
    gaps[r.gap]++;
  }

  const dimension_avg = Object.fromEntries(DIMENSIONS.map((d) => [d,
    round1(mean(attempted.map((r) => r.dims[d]).filter((x): x is number => x !== null)))])) as BatchSummary["dimension_avg"];

  const topicScores = new Map<string, number[]>();
  for (const r of attempted) for (const [t, s] of Object.entries(r.topics)) {
    if (typeof s === "number") topicScores.set(t, [...(topicScores.get(t) ?? []), s]);
  }
  const weakest_topics = [...topicScores.entries()]
    .filter(([, xs]) => xs.length >= minTopicN)
    .map(([topic, xs]) => ({ topic, avg: round1(mean(xs))!, n: xs.length }))
    .sort((a, b) => a.avg - b.avg || b.n - a.n)
    .slice(0, 5);

  const repeat = attempted.filter((r) => r.interviews.length >= 2 && r.delta !== null);
  const dimension_delta = Object.fromEntries(DIMENSIONS.map((d) => {
    const deltas = repeat.map((r) => {
      const f = r.first!.dimensions[d], l = r.latest!.dimensions[d];
      return typeof f === "number" && typeof l === "number" ? l - f : null;
    }).filter((x): x is number => x !== null);
    return [d, round1(mean(deltas))];
  })) as BatchSummary["dimension_delta"];

  return {
    students: rows.length,
    attempted: attempted.length,
    interviews: rows.reduce((a, r) => a + r.interviews.length, 0),
    readiness,
    gaps,
    avg_overall: round1(mean(attempted.map((r) => r.overall_latest).filter((x): x is number => x !== null))),
    dimension_avg,
    weakest_topics,
    improvement: {
      students: repeat.length,
      first_avg: round1(mean(repeat.map((r) => r.overall_first!))),
      latest_avg: round1(mean(repeat.map((r) => r.overall_latest!))),
      delta: round1(mean(repeat.map((r) => r.delta!))),
      improved: repeat.filter((r) => r.delta! > 0).length,
      declined: repeat.filter((r) => r.delta! < 0).length,
    },
    dimension_delta,
  };
}

/** Heat colour class for a 0–10 score relative to a pass mark (null = no data). */
export function heatClass(score: number | null, pass = 6): string {
  if (score === null) return "bg-white/[0.03] text-muted-foreground";
  if (score >= pass + 2) return "bg-emerald-500/60 text-white";
  if (score >= pass) return "bg-emerald-500/30 text-emerald-50";
  if (score >= pass - 2) return "bg-amber-500/35 text-amber-50";
  return "bg-red-500/45 text-red-50";
}
