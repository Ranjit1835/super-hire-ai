// Proctoring rules shared by the browser, the b2b-proctor edge function and the tests:
// which signals are "hard" violations, which pause a Maximum-policy session, and the integrity score.
// Pure code, no imports beyond types, so Deno and Vite both load it.
//
// Honesty rules: the integrity score summarises AI and browser signals for a human reviewer. It is
// never a verdict; nobody is failed on it alone. The final human decision is stored separately.

export type Sev = "info" | "low" | "medium" | "high";
export type Band = "high" | "medium" | "low";

/**
 * Hard violations: certain browser-level facts (not ML guesses). Strict policy counts them towards
 * auto-submit; Maximum counts them too. Kept in sync with b2b_proctor_hard_types() in the SQL.
 */
export const HARD_TYPES = [
  "tab_hidden", "fullscreen_exit", "screen_share_stopped", "extra_display", "camera_off", "second_session",
] as const;

/** Maximum policy: these pause the session until fixed. Kept in sync with b2b_proctor_pause_types(). */
export const PAUSE_TYPES = ["screen_share_stopped", "camera_off", "extra_display", "fullscreen_exit"] as const;

export const isHard = (t: string) => (HARD_TYPES as readonly string[]).includes(t);
export const isPauseType = (t: string) => (PAUSE_TYPES as readonly string[]).includes(t);

/** Default severity per signal (the client may raise it, e.g. a long absence). */
export const DEFAULT_SEVERITY: Record<string, Sev> = {
  tab_hidden: "medium", window_blur: "low", fullscreen_exit: "medium", screen_share_stopped: "high", extra_display: "high",
  copy_attempt: "low", paste_attempt: "medium", cut_attempt: "low", right_click: "info", devtools_suspected: "medium",
  page_reload: "low", second_session: "high",
  no_face: "medium", multiple_faces: "high", looking_away: "low", camera_off: "high", camera_frozen: "medium",
  virtual_camera_suspected: "medium", speech_detected: "medium",
  large_paste: "medium", typing_burst: "low", prompt_injection: "medium",
  session_paused: "medium", session_resumed: "info", auto_submitted: "info", snapshot: "info",
};

export const EVENT_LABEL: Record<string, string> = {
  tab_hidden: "Switched tab or app", window_blur: "Left the test window", fullscreen_exit: "Left full screen",
  screen_share_stopped: "Screen sharing stopped", extra_display: "Extra display connected", copy_attempt: "Copy attempt",
  paste_attempt: "Paste attempt", cut_attempt: "Cut attempt", right_click: "Right-click", devtools_suspected: "Developer tools suspected",
  page_reload: "Page reloaded", second_session: "Second tab or device", no_face: "Face not visible",
  multiple_faces: "More than one face in view", looking_away: "Looking away from the screen", camera_off: "Camera off",
  camera_frozen: "Camera image frozen", virtual_camera_suspected: "Virtual camera suspected", speech_detected: "Speech detected",
  large_paste: "Large paste", typing_burst: "Unusual typing burst", prompt_injection: "Prompt-injection attempt",
  session_paused: "Session paused", session_resumed: "Session resumed", auto_submitted: "Auto-submitted", snapshot: "Snapshot",
};

// ── Integrity score ─────────────────────────────────────────────────────────
// points(event) = severity weight × confidence × duration factor; points are summed per signal type and
// capped per type so one noisy detector can't dominate; score = 100 − Σ capped points (floor 0).

export const SCORE_VERSION = "integrity-v1";
export const SEVERITY_WEIGHT: Record<Sev, number> = { info: 0, low: 1, medium: 3, high: 6 };
/** Instant events count ×1; long ones up to ×4 (one extra unit per 30 s). */
export const DURATION_UNIT_S = 30;
export const MAX_DURATION_FACTOR = 4;
export const DEFAULT_CAP = 25;
/** ML / heuristic detectors get lower caps: they are the noisiest. */
export const TYPE_CAP: Record<string, number> = {
  looking_away: 15, no_face: 20, speech_detected: 15, devtools_suspected: 10, window_blur: 10, right_click: 5,
  copy_attempt: 10, cut_attempt: 10, typing_burst: 10, camera_frozen: 15, virtual_camera_suspected: 10, page_reload: 10,
};
export const BAND_HIGH = 80;
export const BAND_MEDIUM = 50;

export interface ScoreEvent {
  type: string;
  severity: Sev;
  confidence: number;
  started_at: string;
  ended_at?: string | null;
  review_status?: string;
}

export interface TypeDetail { type: string; label: string; count: number; points: number; cap: number; capped: number }
export interface ScoreDetail {
  version: string;
  score: number;
  band: Band;
  total_deduction: number;
  by_type: TypeDetail[];
  formula: string;
}

export function durationFactor(started: string, ended?: string | null): number {
  if (!ended) return 1;
  const s = (Date.parse(ended) - Date.parse(started)) / 1000;
  if (!Number.isFinite(s) || s <= 0) return 1;
  return Math.min(MAX_DURATION_FACTOR, 1 + s / DURATION_UNIT_S);
}

export function eventPoints(e: ScoreEvent): number {
  const conf = Math.max(0, Math.min(1, Number(e.confidence)));
  return SEVERITY_WEIGHT[e.severity] * conf * durationFactor(e.started_at, e.ended_at);
}

export function bandFor(score: number): Band {
  return score >= BAND_HIGH ? "high" : score >= BAND_MEDIUM ? "medium" : "low";
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Pure: the AI integrity score of a session from its events, with an explanation. */
export function integrityScore(events: ScoreEvent[]): ScoreDetail {
  const by = new Map<string, { count: number; points: number }>();
  for (const e of events) {
    const p = eventPoints(e);
    if (p <= 0) continue;
    const cur = by.get(e.type) ?? { count: 0, points: 0 };
    cur.count++;
    cur.points += p;
    by.set(e.type, cur);
  }
  const byType: TypeDetail[] = [...by.entries()].map(([type, v]) => {
    const cap = TYPE_CAP[type] ?? DEFAULT_CAP;
    return { type, label: EVENT_LABEL[type] ?? type, count: v.count, points: r2(v.points), cap, capped: r2(Math.min(cap, v.points)) };
  }).sort((a, b) => b.capped - a.capped || a.type.localeCompare(b.type));
  const total = r2(byType.reduce((s, t) => s + t.capped, 0));
  const score = r2(Math.max(0, 100 - total));
  return {
    version: SCORE_VERSION, score, band: bandFor(score), total_deduction: total, by_type: byType,
    formula: "100 − Σ per signal type of min(cap, Σ severity weight × confidence × duration factor)",
  };
}
