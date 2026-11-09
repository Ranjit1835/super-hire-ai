// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  integrityScore, bandFor, durationFactor, eventPoints, isHard, isPauseType, TYPE_CAP, DEFAULT_CAP, type ScoreEvent,
} from "../../../supabase/functions/_shared/contracts/proctor-rules";
import { ConditionTracker, type Incident } from "./conditions";
import { HeadPoseJudge, headAngles, anglesFromLandmarks } from "./headPose";
import { EnergyVad, rmsDb, type SpeechSegment } from "./vad";
import { EventQueue, uuid, type QueuedEvent, type SendResult } from "./queue";
import { detectBrowser, supportProblem, qualityTier, estimateBandwidth, displaySurface, displayCount, mediaProblem } from "./systemCheck";

const T0 = Date.parse("2026-10-21T10:00:00Z");
const iso = (ms: number) => new Date(T0 + ms).toISOString();
const e = (type: string, severity: ScoreEvent["severity"], confidence = 1, durS = 0): ScoreEvent =>
  ({ type, severity, confidence, started_at: iso(0), ended_at: durS ? iso(durS * 1000) : null });

describe("integrity score", () => {
  it("a clean session scores 100 / high; info events never count", () => {
    const d = integrityScore([e("snapshot", "info"), e("session_resumed", "info"), e("auto_submitted", "info")]);
    expect(d).toMatchObject({ score: 100, band: "high", total_deduction: 0, by_type: [] });
  });

  it("severity × confidence × duration", () => {
    expect(eventPoints(e("tab_hidden", "medium"))).toBe(3);
    expect(eventPoints(e("multiple_faces", "high", 0.5))).toBe(3);
    expect(durationFactor(iso(0), iso(30_000))).toBe(2);
    expect(durationFactor(iso(0), iso(3_600_000))).toBe(4); // capped
    expect(durationFactor(iso(0), null)).toBe(1);
    expect(eventPoints(e("no_face", "medium", 1, 60))).toBe(9);
  });

  it("caps each signal type so one noisy detector can't dominate, and explains the result", () => {
    const many = Array.from({ length: 50 }, () => e("looking_away", "low", 0.9, 20));
    const d = integrityScore([...many, e("tab_hidden", "medium"), e("tab_hidden", "medium")]);
    const la = d.by_type.find((t) => t.type === "looking_away")!;
    expect(la.count).toBe(50);
    expect(la.points).toBeGreaterThan(TYPE_CAP.looking_away);
    expect(la.capped).toBe(TYPE_CAP.looking_away);
    expect(d.by_type.find((t) => t.type === "tab_hidden")).toMatchObject({ count: 2, points: 6, capped: 6, cap: DEFAULT_CAP });
    expect(d.score).toBe(100 - 15 - 6);
    expect(d.band).toBe("medium");
    expect(d.formula).toMatch(/cap/);
  });

  it("bands and floor", () => {
    expect([bandFor(100), bandFor(80), bandFor(79.9), bandFor(50), bandFor(49)]).toEqual(["high", "high", "medium", "medium", "low"]);
    const types = ["tab_hidden", "fullscreen_exit", "screen_share_stopped", "extra_display", "camera_off", "multiple_faces"];
    const d = integrityScore(types.flatMap((t) => Array.from({ length: 10 }, () => e(t, "high", 1, 120))));
    expect(d.score).toBe(0);
    expect(d.band).toBe("low");
  });

  it("hard and pause signal sets", () => {
    expect(isHard("tab_hidden")).toBe(true);
    expect(isHard("looking_away")).toBe(false);   // ML signals never count towards auto-submit
    expect(isHard("multiple_faces")).toBe(false);
    expect(isPauseType("fullscreen_exit")).toBe(true);
    expect(isPauseType("tab_hidden")).toBe(false);
  });
});

function track(steps: (t: ConditionTracker) => void) {
  const warned: string[] = [];
  const incidents: Incident[] = [];
  const tr = new ConditionTracker({ warn: (t) => warned.push(t), incident: (i) => incidents.push(i) });
  steps(tr);
  return { warned, incidents };
}
const frames = (tr: ConditionTracker, type: "no_face" | "looking_away" | "multiple_faces", from: number, to: number, on: boolean, fps = 2) => {
  for (let t = from; t < to; t += 1000 / fps) tr.set(type, on, t);
};

describe("condition thresholds", () => {
  it("looking away for less than N seconds is ignored", () => {
    const { warned, incidents } = track((tr) => {
      frames(tr, "looking_away", 0, 3500, true);
      frames(tr, "looking_away", 3500, 6000, false);
    });
    expect(warned).toEqual([]);
    expect(incidents).toEqual([]);
  });

  it("looking away beyond N seconds warns once and logs the full duration", () => {
    const { warned, incidents } = track((tr) => {
      frames(tr, "looking_away", 0, 7000, true);
      frames(tr, "looking_away", 7000, 9000, false);
    });
    expect(warned).toEqual(["looking_away"]);
    expect(incidents).toHaveLength(1);
    expect(incidents[0].startedAt).toBe(0);
    expect(incidents[0].endedAt).toBe(7000);
  });

  it("one stray frame doesn't split an incident (hysteresis)", () => {
    const { incidents } = track((tr) => {
      frames(tr, "no_face", 0, 5000, true);
      tr.set("no_face", false, 5000);
      frames(tr, "no_face", 5500, 9000, true);
      frames(tr, "no_face", 9000, 11000, false);
    });
    expect(incidents).toHaveLength(1);
    expect(incidents[0].endedAt - incidents[0].startedAt).toBeGreaterThanOrEqual(8500);
  });

  it("flush ends open incidents at session end", () => {
    const { incidents } = track((tr) => { frames(tr, "multiple_faces", 0, 3000, true); tr.flush(3000); });
    expect(incidents.map((i) => i.type)).toEqual(["multiple_faces"]);
  });
});

/** A column-major rotation matrix for a head turned by yaw (about y) and pitch (about x). */
function matrix(yawDeg: number, pitchDeg: number): number[] {
  const y = (yawDeg * Math.PI) / 180, p = (pitchDeg * Math.PI) / 180;
  // R = Ry(yaw) * Rx(pitch); stored so that m[8]=R[0][2], m[9]=R[1][2], m[10]=R[2][2]
  const R = [
    [Math.cos(y), Math.sin(y) * Math.sin(p), Math.sin(y) * Math.cos(p)],
    [0, Math.cos(p), -Math.sin(p)],
    [-Math.sin(y), Math.cos(y) * Math.sin(p), Math.cos(y) * Math.cos(p)],
  ];
  const m = new Array(16).fill(0);
  for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) m[c * 4 + r] = R[c][r];
  m[15] = 1;
  return m;
}

describe("head pose → looking away", () => {
  it("recovers yaw and pitch from the transformation matrix", () => {
    const [yaw, pitch] = headAngles(matrix(20, 0));
    expect(Math.abs((yaw * 180) / Math.PI)).toBeCloseTo(20, 0); // sign depends on matrix layout; the judge uses magnitudes
    expect((pitch * 180) / Math.PI).toBeCloseTo(0, 0);
    const [, p2] = headAngles(matrix(0, 15));
    expect(Math.abs((p2 * 180) / Math.PI)).toBeCloseTo(15, 0);
  });

  it("judges against the user's own baseline pose", () => {
    const j = new HeadPoseJudge();
    const rad = (d: number) => (d * Math.PI) / 180;
    for (let i = 0; i < 8; i++) j.judge(rad(10), rad(5)); // webcam off to one side
    expect(j.baseline![0]).toBeCloseTo(rad(10));
    expect(j.judge(rad(25), rad(5))).toBe(false);  // 15° from baseline
    expect(j.judge(rad(45), rad(5))).toBe(true);   // 35° from baseline
    expect(j.judge(rad(10), rad(-25))).toBe(true); // looking down (phone, notes)
  });

  it("a head turned far away is flagged even before the baseline settles", () => {
    const j = new HeadPoseJudge();
    expect(j.judge(1.2, 0)).toBe(true);
    expect(j.judge(0, 0)).toBeNull();
  });

  it("landmark fallback: centred nose ≈ frontal, nose near a cheek ≈ turned", () => {
    const lm = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
    lm[234] = { x: 0.3, y: 0.5 }; lm[454] = { x: 0.7, y: 0.5 }; lm[10] = { x: 0.5, y: 0.2 }; lm[152] = { x: 0.5, y: 0.8 };
    lm[1] = { x: 0.5, y: 0.53 };
    const [yaw] = anglesFromLandmarks(lm)!;
    expect(Math.abs(yaw)).toBeLessThan(0.05);
    lm[1] = { x: 0.66, y: 0.53 };
    expect(Math.abs(anglesFromLandmarks(lm)![0])).toBeGreaterThan(0.5);
    expect(anglesFromLandmarks([])).toBeNull();
  });
});

describe("energy VAD thresholds", () => {
  const run = (levels: [number, number][]) => {
    const segs: SpeechSegment[] = [];
    const starts: number[] = [];
    const v = new EnergyVad({ segment: (s) => segs.push(s), start: (t) => starts.push(t) });
    let t = 0;
    for (const [db, ms] of levels) for (let end = t + ms; t < end; t += 100) v.push(db, t);
    v.flush();
    return { segs, starts, v };
  };

  it("rmsDb", () => {
    expect(rmsDb(new Float32Array(100))).toBe(-100);
    expect(rmsDb(new Float32Array(100).fill(1))).toBeCloseTo(0);
    expect(rmsDb(new Float32Array(100).fill(0.1))).toBeCloseTo(-20);
  });

  it("sustained speech well above the room's noise floor is detected, once, with its duration", () => {
    const { segs, starts } = run([[-60, 3000], [-30, 4000], [-60, 2000]]);
    expect(segs).toHaveLength(1);
    expect(starts).toHaveLength(1);
    expect(segs[0].endedAt - segs[0].startedAt).toBeGreaterThanOrEqual(3800);
  });

  it("short sounds (a cough, a click) are ignored", () => {
    expect(run([[-60, 3000], [-30, 800], [-60, 3000]]).segs).toHaveLength(0);
  });

  it("a noisy but steady room (fan) is not speech; the floor adapts", () => {
    const { segs, v } = run([[-40, 10000]]);
    expect(segs).toHaveLength(0);
    expect(v.noiseFloor!).toBeCloseTo(-40, 0);
  });

  it("whisper-quiet levels below the absolute minimum never count", () => {
    expect(run([[-90, 3000], [-58, 4000], [-90, 1000]]).segs).toHaveLength(0);
  });

  it("brief pauses between words are bridged", () => {
    const { segs } = run([[-60, 2000], [-30, 1000], [-60, 400], [-30, 1000], [-60, 2000]]);
    expect(segs).toHaveLength(1);
  });
});

describe("event queue: batching, retry, idempotency", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const ev = (type = "tab_hidden"): Omit<QueuedEvent, "clientEventId"> => ({ type, severity: "medium", confidence: 1, startedAt: iso(0) });
  const ok: SendResult = { accepted: 1, violations: 0, action: "none" };

  it("batches non-urgent events and sends urgent ones immediately", async () => {
    const send = vi.fn().mockResolvedValue(ok);
    const q = new EventQueue({ send, batchMs: 5000 });
    q.add(ev("copy_attempt")); q.add(ev("right_click"));
    expect(send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5000);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toHaveLength(2);
    q.add(ev("screen_share_stopped"), true);
    await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("retries failed batches with the same client ids (server dedupes), then clears them", async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(ok);
    const q = new EventQueue({ send });
    const id = q.add(ev(), true);
    await vi.advanceTimersByTimeAsync(0);
    expect(q.size).toBe(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0][0][0].clientEventId).toBe(id);
    expect(send.mock.calls[1][0][0].clientEventId).toBe(id);
    expect(q.size).toBe(0);
  });

  it("never sends more than maxBatch at once; drains the rest", async () => {
    const send = vi.fn().mockResolvedValue(ok);
    const q = new EventQueue({ send, maxBatch: 200 });
    for (let i = 0; i < 450; i++) q.add(ev());
    vi.useRealTimers();
    expect(await q.drain()).toBe(true);
    expect(send.mock.calls.map((c) => c[0].length)).toEqual([200, 200, 50]);
  });

  it("ignores a duplicate add of the same id and reports server actions", async () => {
    const onResult = vi.fn();
    const send = vi.fn().mockResolvedValue({ ...ok, action: "pause" });
    const q = new EventQueue({ send, onResult });
    const id = uuid();
    q.add({ ...ev(), clientEventId: id }); q.add({ ...ev(), clientEventId: id });
    expect(q.size).toBe(1);
    await q.flush();
    expect(onResult).toHaveBeenCalledWith(expect.objectContaining({ action: "pause" }));
  });

  it("unsent events survive a reload via storage and are re-sent", async () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
    const failing = new EventQueue({ send: vi.fn().mockRejectedValue(new Error("x")), storage, storageKey: "k" });
    const id = failing.add(ev());
    failing.stop();
    const send = vi.fn().mockResolvedValue(ok);
    new EventQueue({ send, storage, storageKey: "k" });
    await vi.advanceTimersByTimeAsync(0);
    expect(send.mock.calls[0][0][0].clientEventId).toBe(id);
    expect(store.has("k")).toBe(false);
  });

  it("uuid is a v4 uuid", () => {
    expect(uuid()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe("system check helpers", () => {
  const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
  it("detects desktop Chromium, Edge, Firefox, Safari and phones", () => {
    expect(detectBrowser(CHROME)).toEqual({ browser: "Chrome", version: 130, chromium: true, mobile: false });
    expect(detectBrowser(`${CHROME} Edg/129.0.0.0`)).toMatchObject({ browser: "Edge", version: 129, chromium: true });
    expect(supportProblem(detectBrowser("Mozilla/5.0 (Windows NT 10.0; rv:131.0) Gecko/20100101 Firefox/131.0"))).toBe("not_chromium");
    expect(supportProblem(detectBrowser("Mozilla/5.0 (Macintosh) AppleWebKit/605 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"))).toBe("not_chromium");
    expect(supportProblem(detectBrowser("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36"))).toBe("mobile");
    expect(supportProblem(detectBrowser("Mozilla/5.0 (iPhone) AppleWebKit/605 CriOS/130.0 Mobile/15E148 Safari/604.1"))).toBe("mobile");
    expect(supportProblem(detectBrowser(CHROME.replace("130.0", "99.0")))).toBe("too_old");
    expect(supportProblem(detectBrowser(CHROME))).toBeNull();
  });

  it("prefers client hints", () => {
    const b = detectBrowser(CHROME, { brands: [{ brand: "Chromium", version: "131" }, { brand: "Microsoft Edge", version: "131" }], mobile: false });
    expect(b).toEqual({ browser: "Edge", version: 131, chromium: true, mobile: false });
  });

  it("quality tier from cores, memory and bandwidth", () => {
    expect(qualityTier({ cores: 8, memoryGb: 8, bandwidthKbps: 5000 })).toBe("full");
    expect(qualityTier({ cores: 2, memoryGb: 4, bandwidthKbps: 2000 })).toBe("lite");     // the 4 GB dual-core laptop
    expect(qualityTier({ cores: 8, memoryGb: 8, bandwidthKbps: 500 })).toBe("lite");
    expect(qualityTier({ cores: 1, memoryGb: 2, bandwidthKbps: null })).toBe("minimal");
    expect(qualityTier({ cores: null, memoryGb: null, bandwidthKbps: null })).toBe("lite");
  });

  it("bandwidth: Network Information API first, else a timed download", async () => {
    expect(await estimateBandwidth({ connection: { downlink: 2.5 } })).toBe(2500);
    let t = 0;
    const fetchImpl = vi.fn().mockResolvedValue({ arrayBuffer: async () => new ArrayBuffer(125_000) }) as unknown as typeof fetch;
    expect(await estimateBandwidth({ connection: null, fetchImpl, now: () => (t += 500) })).toBe(2000);
    expect(await estimateBandwidth({ connection: null, fetchImpl: vi.fn().mockRejectedValue(new Error()) as unknown as typeof fetch })).toBeNull();
  });

  it("only an entire-screen share counts; ended tracks are 'none'", () => {
    const stream = (surface: string, readyState = "live") =>
      ({ getVideoTracks: () => [{ readyState, getSettings: () => ({ displaySurface: surface }) }] }) as unknown as MediaStream;
    expect(displaySurface(stream("monitor"))).toBe("monitor");
    expect(displaySurface(stream("window"))).toBe("window");
    expect(displaySurface(stream("browser"))).toBe("browser");
    expect(displaySurface(stream("monitor", "ended"))).toBe("none");
    expect(displaySurface(null)).toBe("none");
  });

  it("displays and media errors", () => {
    expect(displayCount({ isExtended: true } as Screen & { isExtended: boolean })).toBe(2);
    expect(displayCount({ isExtended: false } as Screen & { isExtended: boolean })).toBe(1);
    expect(mediaProblem({ name: "NotAllowedError" })).toBe("denied");
    expect(mediaProblem({ name: "NotReadableError" })).toBe("in_use");
    expect(mediaProblem({ name: "NotFoundError" })).toBe("not_found");
  });
});
