// Turns sampled boolean conditions ("no face in this frame") into events with a duration.
// A condition becomes an incident once it has lasted its threshold (the user is warned then); it is logged
// with its full duration when it ends. Camera conditions need a short clear period before they end, so one
// stray frame doesn't split an incident in two. Adapted from the pilot's IncidentTracker.

export interface ConditionSpec { thresholdMs: number; clearMs: number }

/** V1 thresholds. Looking away: N = 4 s beyond the head-pose limit. */
export const CONDITIONS = {
  no_face: { thresholdMs: 3000, clearMs: 700 },
  multiple_faces: { thresholdMs: 1500, clearMs: 700 },
  looking_away: { thresholdMs: 4000, clearMs: 700 },
  camera_frozen: { thresholdMs: 10000, clearMs: 0 },
  window_blur: { thresholdMs: 2000, clearMs: 0 },
} satisfies Record<string, ConditionSpec>;

export type ConditionType = keyof typeof CONDITIONS;

interface Active { since: number; clearSince: number | null; warned: boolean }

export interface Incident { type: ConditionType; startedAt: number; endedAt: number }

export class ConditionTracker {
  private active = new Map<ConditionType, Active>();

  constructor(
    private readonly on: { warn: (type: ConditionType) => void; incident: (i: Incident) => void },
    private readonly specs: Record<ConditionType, ConditionSpec> = CONDITIONS,
  ) {}

  isActive(type: ConditionType) { return this.active.get(type)?.warned ?? false; }

  /** Report the current state of a condition at time t. */
  set(type: ConditionType, on: boolean, t: number) {
    const c = this.active.get(type);
    if (on) {
      if (!c) this.active.set(type, { since: t, clearSince: null, warned: false });
      else c.clearSince = null;
    } else if (c) {
      const clearMs = this.specs[type].clearMs;
      if (clearMs <= 0) this.end(type, t);
      else if (c.clearSince === null) c.clearSince = t;
      else if (t - c.clearSince >= clearMs) this.end(type, c.clearSince);
    }
    this.tick(t);
  }

  /** Check thresholds; call regularly. */
  tick(t: number) {
    for (const [type, c] of this.active) {
      if (!c.warned && c.clearSince === null && t - c.since >= this.specs[type].thresholdMs) {
        c.warned = true;
        this.on.warn(type);
      }
    }
  }

  /** End everything (session over), logging what had become incidents. */
  flush(t: number) {
    this.tick(t);
    for (const type of [...this.active.keys()]) this.end(type, t);
  }

  private end(type: ConditionType, t: number) {
    const c = this.active.get(type);
    if (!c) return;
    this.active.delete(type);
    if (c.warned) this.on.incident({ type, startedAt: c.since, endedAt: Math.max(c.since, c.clearSince ?? t) });
  }
}
