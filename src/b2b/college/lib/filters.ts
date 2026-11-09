// Form state → contract inputs for drive eligibility and TPO analytics. Empty inputs mean "no filter",
// so they are dropped instead of being sent as empty arrays / NaN.
import type { AnalyticsFilters, Eligibility } from "../../../../supabase/functions/_shared/contracts/college";

export interface EligibilityForm {
  departments: string[];
  batchYears: number[];
  sections: string;          // comma-separated, as typed
  minCgpa: string;
  maxBacklogs: string;
  minTenth: string;
  minTwelfth: string;
}
export const emptyEligibility: EligibilityForm = {
  departments: [], batchYears: [], sections: "", minCgpa: "", maxBacklogs: "", minTenth: "", minTwelfth: "",
};

const n = (s: string): number | undefined => {
  const t = s.trim();
  return t === "" || !Number.isFinite(Number(t)) ? undefined : Number(t);
};
const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

export function toEligibility(f: EligibilityForm): Eligibility {
  const e: Eligibility = {};
  if (f.departments.length) e.departments = f.departments;
  if (f.batchYears.length) e.batch_years = f.batchYears;
  const sections = list(f.sections);
  if (sections.length) e.sections = sections;
  const minCgpa = n(f.minCgpa); if (minCgpa !== undefined) e.min_cgpa = minCgpa;
  const maxB = n(f.maxBacklogs); if (maxB !== undefined) e.max_backlogs = Math.trunc(maxB);
  const t10 = n(f.minTenth); if (t10 !== undefined) e.min_tenth_pct = t10;
  const t12 = n(f.minTwelfth); if (t12 !== undefined) e.min_twelfth_pct = t12;
  return e;
}

export function fromEligibility(e: Eligibility | null | undefined): EligibilityForm {
  const s = (v: number | undefined) => (v === undefined ? "" : String(v));
  return {
    departments: e?.departments ?? [], batchYears: e?.batch_years ?? [], sections: (e?.sections ?? []).join(", "),
    minCgpa: s(e?.min_cgpa), maxBacklogs: s(e?.max_backlogs), minTenth: s(e?.min_tenth_pct), minTwelfth: s(e?.min_twelfth_pct),
  };
}

/** "CSE, ECE · 2027 · CGPA ≥ 7 · no backlogs" (or "All students"). */
export function describeEligibility(e: Eligibility | null | undefined): string {
  if (!e) return "All students";
  const parts: string[] = [];
  if (e.departments?.length) parts.push(e.departments.join(", "));
  if (e.batch_years?.length) parts.push(e.batch_years.join(", "));
  if (e.sections?.length) parts.push(`Section ${e.sections.join(", ")}`);
  if (e.min_cgpa !== undefined) parts.push(`CGPA ≥ ${e.min_cgpa}`);
  if (e.max_backlogs !== undefined) parts.push(e.max_backlogs === 0 ? "no backlogs" : `≤ ${e.max_backlogs} backlogs`);
  if (e.min_tenth_pct !== undefined) parts.push(`10th ≥ ${e.min_tenth_pct}%`);
  if (e.min_twelfth_pct !== undefined) parts.push(`12th ≥ ${e.min_twelfth_pct}%`);
  return parts.length ? parts.join(" · ") : "All students";
}

export type Band = "high" | "medium" | "low";
export type AttemptStatus = "assigned" | "in_progress" | "completed" | "absent";

export interface AnalyticsForm {
  driveId: string;           // "" = all drives
  from: string;              // yyyy-mm-dd
  to: string;
  departments: string[];
  batchYears: number[];
  sections: string;
  cgpaMin: string;
  cgpaMax: string;
  maxBacklogs: string;
  bands: Band[];
  scoreMin: string;
  scoreMax: string;
  statuses: AttemptStatus[];
  search: string;
}
export const emptyAnalytics: AnalyticsForm = {
  driveId: "", from: "", to: "", departments: [], batchYears: [], sections: "", cgpaMin: "", cgpaMax: "",
  maxBacklogs: "", bands: [], scoreMin: "", scoreMax: "", statuses: [], search: "",
};

/** Dates are whole days in India time: from = 00:00 IST, to = 23:59:59 IST. */
export function toAnalyticsFilters(f: AnalyticsForm): AnalyticsFilters {
  const out: AnalyticsFilters = {};
  if (f.driveId) out.driveId = f.driveId;
  if (f.from) out.from = new Date(`${f.from}T00:00:00+05:30`).toISOString();
  if (f.to) out.to = new Date(`${f.to}T23:59:59+05:30`).toISOString();
  if (f.departments.length) out.departments = f.departments;
  if (f.batchYears.length) out.batchYears = f.batchYears;
  const sections = list(f.sections);
  if (sections.length) out.sections = sections;
  const cMin = n(f.cgpaMin); const cMax = n(f.cgpaMax);
  if (cMin !== undefined || cMax !== undefined) out.cgpa = [cMin ?? 0, cMax ?? 10];
  const mb = n(f.maxBacklogs); if (mb !== undefined) out.maxBacklogs = Math.trunc(mb);
  if (f.bands.length) out.integrityBands = f.bands;
  const sMin = n(f.scoreMin); const sMax = n(f.scoreMax);
  if (sMin !== undefined || sMax !== undefined) out.scoreRange = [sMin ?? 0, sMax ?? 100];
  if (f.statuses.length) out.status = f.statuses;
  if (f.search.trim()) out.search = f.search.trim();
  return out;
}
