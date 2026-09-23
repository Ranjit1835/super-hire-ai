export const READINESS_LABEL = { not_ready: "Not ready yet", developing: "Developing", ready: "Ready" } as const;
export const READINESS_STYLE = {
  not_ready: "border-red-500/40 bg-red-500/10 text-red-200",
  developing: "border-amber-500/40 bg-amber-500/10 text-amber-200",
  ready: "border-emerald-500/40 bg-emerald-500/10 text-emerald-200",
} as const;

/** Bar colour for a 0–10 score relative to the module's pass mark. */
export function scoreTone(score: number, pass: number) {
  if (score >= pass) return "bg-emerald-400";
  if (score >= pass - 2) return "bg-amber-400";
  return "bg-red-400";
}
