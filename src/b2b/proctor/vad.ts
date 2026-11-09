// Energy-based voice-activity detection for coding tests ("speech detected"). Runs on mic level samples
// (WebAudio AnalyserNode, ~10 per second). An adaptive noise floor follows fans and room hum; speech is
// sustained energy well above that floor. Interviews don't run this (the candidate is meant to talk).
// It flags sound that looks like speech; it can't tell who is speaking. Evidence for review, not a verdict.

export interface VadOptions {
  /** dB above the noise floor that counts as voice. */
  marginDb: number;
  /** Absolute floor: quieter than this is never speech (dBFS). */
  minDb: number;
  /** Voice must last this long (gaps shorter than hangMs bridged) to be an event. */
  minSpeechMs: number;
  /** Silence that ends a segment. */
  hangMs: number;
}

export const VAD_DEFAULTS: VadOptions = { marginDb: 15, minDb: -50, minSpeechMs: 1500, hangMs: 700 };

export interface SpeechSegment { startedAt: number; endedAt: number; peakDb: number }

/** RMS level of a block of samples in dBFS (−100 for silence). */
export function rmsDb(samples: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  const rms = Math.sqrt(sum / Math.max(1, samples.length));
  return rms > 0 ? Math.max(-100, 20 * Math.log10(rms)) : -100;
}

export class EnergyVad {
  private floor: number | null = null;
  private segStart: number | null = null;
  private lastVoice = 0;
  private peak = -100;
  private announced = false;
  readonly opts: VadOptions;

  constructor(
    private readonly on: { start?: (t: number) => void; segment: (s: SpeechSegment) => void },
    opts: Partial<VadOptions> = {},
  ) {
    this.opts = { ...VAD_DEFAULTS, ...opts };
  }

  get noiseFloor() { return this.floor; }

  /** Feed one level sample (dBFS) taken at time t (ms). */
  push(db: number, t: number) {
    if (this.floor === null) this.floor = db;
    const threshold = Math.max(this.floor + this.opts.marginDb, this.opts.minDb);
    const voice = db >= threshold;
    if (!voice) {
      // Follow the floor down fast, up slowly (so speech doesn't drag it up).
      this.floor = db < this.floor ? this.floor + 0.3 * (db - this.floor) : this.floor + 0.02 * (db - this.floor);
    }
    if (voice) {
      if (this.segStart === null) { this.segStart = t; this.peak = db; this.announced = false; }
      this.lastVoice = t;
      this.peak = Math.max(this.peak, db);
      if (!this.announced && t - this.segStart >= this.opts.minSpeechMs) {
        this.announced = true;
        this.on.start?.(this.segStart);
      }
    } else if (this.segStart !== null && t - this.lastVoice > this.opts.hangMs) {
      this.close();
    }
  }

  /** End any open segment (session over). */
  flush() { if (this.segStart !== null) this.close(); }

  private close() {
    const start = this.segStart!;
    const end = this.lastVoice;
    this.segStart = null;
    if (end - start >= this.opts.minSpeechMs) this.on.segment({ startedAt: start, endedAt: end, peakDb: Math.round(this.peak) });
  }
}
