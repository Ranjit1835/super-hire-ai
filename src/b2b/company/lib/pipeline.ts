// Pipeline table filter form ↔ contract params, plus share-link expiry helpers.
import type { PipelineFilters, Stage } from "../../../../supabase/functions/_shared/contracts/company";

export type Band = "high" | "medium" | "low";
export interface PipelineForm { stages: Stage[]; bands: Band[]; scoreMin: string; scoreMax: string; search: string }
export const emptyPipeline: PipelineForm = { stages: [], bands: [], scoreMin: "", scoreMax: "", search: "" };

export const STAGES: { value: Stage; label: string }[] = [
  { value: "invited", label: "Invited" }, { value: "in_progress", label: "In progress" }, { value: "completed", label: "Completed" },
  { value: "shortlisted", label: "Shortlisted" }, { value: "rejected", label: "Rejected" }, { value: "hired", label: "Hired" },
];

const score = (s: string): number | undefined => {
  if (s.trim() === "") return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : undefined;
};

/** Only set fields are sent; min/max are swapped if reversed. */
export function toPipelineFilters(f: PipelineForm): PipelineFilters {
  let min = score(f.scoreMin);
  let max = score(f.scoreMax);
  if (min !== undefined && max !== undefined && min > max) [min, max] = [max, min];
  return {
    ...(f.stages.length ? { stages: f.stages } : {}),
    ...(f.bands.length ? { integrityBands: f.bands } : {}),
    ...(min !== undefined ? { scoreMin: min } : {}),
    ...(max !== undefined ? { scoreMax: max } : {}),
    ...(f.search.trim() ? { search: f.search.trim().slice(0, 100) } : {}),
  };
}

export const activeFilterCount = (f: PipelineForm) =>
  Object.keys(toPipelineFilters(f)).length;

// ── Share links ───────────────────────────────────────────────────────────────────────────────────────────
export const SHARE_DAYS = [1, 3, 7, 14, 30] as const;
export type ShareState = "active" | "expired" | "revoked";

export function shareState(l: { expires_at: string; revoked_at: string | null }, now = Date.now()): ShareState {
  if (l.revoked_at) return "revoked";
  return new Date(l.expires_at).getTime() <= now ? "expired" : "active";
}

/** "Expires in 3 days" / "Expires today" / "Expired". */
export function expiresText(iso: string, now = Date.now()): string {
  const ms = new Date(iso).getTime() - now;
  if (ms <= 0) return "Expired";
  const days = Math.floor(ms / 86_400_000);
  if (days === 0) return "Expires today";
  return days === 1 ? "Expires in 1 day" : `Expires in ${days} days`;
}
