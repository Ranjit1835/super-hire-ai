// ─── Turn-latency statistics ─────────────────────────────────────────────────
// Pure TS (browser dev panel + server summary). Nearest-rank percentiles over "candidate stopped speaking →
// interviewer audio started" in milliseconds. Target from the spec: about 1.5 s or less.

export interface LatencyStats { count: number; p50: number | null; p95: number | null; max: number | null; overTarget: number }

export const LATENCY_TARGET_MS = 1500;
const MAX_VALID_MS = 5 * 60 * 1000;

export function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

export function latencyStats(samples: (number | null | undefined)[]): LatencyStats {
  const xs = samples
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= MAX_VALID_MS)
    .map(Math.round)
    .sort((a, b) => a - b);
  return {
    count: xs.length,
    p50: percentile(xs, 50),
    p95: percentile(xs, 95),
    max: xs.length ? xs[xs.length - 1] : null,
    overTarget: xs.filter((v) => v > LATENCY_TARGET_MS).length,
  };
}
