// Head pose from MediaPipe FaceLandmarker output → "looking away" (head turned beyond a threshold).
// V1 uses head pose only (no gaze calibration; that's a fast-follow). Angles are relative to the user's own
// baseline pose (median of the first frames), so a webcam mounted off-centre doesn't count as looking away.

export interface Landmark { x: number; y: number; z?: number }

const DEG = Math.PI / 180;
export const MAX_YAW_DEG = 30;
export const MAX_PITCH_DEG = 25;
/** Looking away must last this long before it becomes an event. */
export const LOOKING_AWAY_MS = 4000;
const BASELINE_FRAMES = 8;

/** Head yaw/pitch (radians) from a 4×4 facial transformation matrix (flattened, column-major as MediaPipe gives it). */
export function headAngles(m: ArrayLike<number>): [number, number] {
  const yaw = Math.atan2(m[8], m[10]);
  const pitch = Math.asin(Math.max(-1, Math.min(1, -m[9])));
  return [yaw, pitch];
}

/** Fallback without a matrix: yaw/pitch estimated from where the nose tip sits between the cheeks / eyes and chin. */
export function anglesFromLandmarks(lm: Landmark[]): [number, number] | null {
  if (lm.length < 455) return null;
  const nose = lm[1], left = lm[234], right = lm[454], top = lm[10], chin = lm[152];
  const w = right.x - left.x, h = chin.y - top.y;
  if (Math.abs(w) < 1e-6 || Math.abs(h) < 1e-6) return null;
  const rx = (nose.x - left.x) / w - 0.5;   // −0.5..0.5
  const ry = (nose.y - top.y) / h - 0.55;
  return [Math.asin(Math.max(-1, Math.min(1, rx * 2))), Math.asin(Math.max(-1, Math.min(1, ry * 2)))];
}

/** Rolling baseline + threshold check. */
export class HeadPoseJudge {
  private samples: [number, number][] = [];
  private base: [number, number] | null = null;

  constructor(private readonly maxYaw = MAX_YAW_DEG * DEG, private readonly maxPitch = MAX_PITCH_DEG * DEG) {}

  get baseline() { return this.base; }

  /** true = looking away, false = facing the screen, null = still calibrating the baseline. */
  judge(yaw: number, pitch: number): boolean | null {
    if (!this.base) {
      // Only near-frontal frames build the baseline (someone already turned away at start shouldn't set it).
      if (Math.abs(yaw) < this.maxYaw && Math.abs(pitch) < this.maxPitch) this.samples.push([yaw, pitch]);
      if (this.samples.length < BASELINE_FRAMES) return Math.abs(yaw) > this.maxYaw || Math.abs(pitch) > this.maxPitch ? true : null;
      const med = (i: 0 | 1) => [...this.samples.map((s) => s[i])].sort((a, b) => a - b)[Math.floor(this.samples.length / 2)];
      this.base = [med(0), med(1)];
    }
    return Math.abs(yaw - this.base[0]) > this.maxYaw || Math.abs(pitch - this.base[1]) > this.maxPitch;
  }
}
