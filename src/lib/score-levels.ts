// One mapping from ATS score to performance level, shared by every results view and the
// share card. Matches the bands in the analyze-resume prompt, which also enforces them
// server-side so a model-chosen label can't contradict the score.
export type PerformanceTone = "risk" | "improve" | "competitive" | "strong";

export interface PerformanceLevel {
  label: string;
  tone: PerformanceTone;
}

export function performanceLevel(score: number): PerformanceLevel {
  if (score >= 80) return { label: "Strong & Market Ready", tone: "strong" };
  if (score >= 65) return { label: "Competitive but Optimizable", tone: "competitive" };
  if (score >= 50) return { label: "Needs Strategic Improvement", tone: "improve" };
  return { label: "High Risk – Immediate Fix Required", tone: "risk" };
}

/** Text colour for the score number / ring accent. */
export const TONE_TEXT: Record<PerformanceTone, string> = {
  risk: "text-red-400",
  improve: "text-amber-400",
  competitive: "text-cyan-400",
  strong: "text-emerald-400",
};

/** Badge styles for the level label. */
export const TONE_BADGE: Record<PerformanceTone, string> = {
  risk: "bg-red-500/15 text-red-400 border-red-500/25",
  improve: "bg-amber-500/15 text-amber-400 border-amber-500/25",
  competitive: "bg-cyan-500/15 text-cyan-400 border-cyan-500/25",
  strong: "bg-emerald-500/15 text-emerald-400 border-emerald-500/25",
};
