import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ProctorMonitor, type Policy } from "./monitor";
import type { QueuedEvent, SendResult } from "./queue";

class FakeTrack extends EventTarget {
  readyState: "live" | "ended" = "live";
  constructor(public surface = "monitor", public label = "Integrated Webcam") { super(); }
  getSettings() { return { displaySurface: this.surface }; }
  stop() { this.readyState = "ended"; }
  end() { this.readyState = "ended"; this.dispatchEvent(new Event("ended")); }
}
const stream = (t: FakeTrack) =>
  ({ getVideoTracks: () => [t], getAudioTracks: () => [], getTracks: () => [t] }) as unknown as MediaStream;

let fullscreen: Element | null = null;
let sent: QueuedEvent[][] = [];
let reply: SendResult = { accepted: 1, violations: 0, action: "none" };

function setup(policy: Policy, extra: Partial<ConstructorParameters<typeof ProctorMonitor>[0]> = {}) {
  const screenTrack = new FakeTrack("monitor");
  const camTrack = new FakeTrack("", "Integrated Webcam");
  const cb = { warn: vi.fn(), paused: vi.fn(), problems: vi.fn(), submit: vi.fn() };
  const m = new ProctorMonitor({
    sessionId: "s1", policy, kind: "assessment", tier: "minimal", snapshotIntervalS: 30,
    camera: stream(camTrack), mic: null, screen: stream(screenTrack),
    sendEvents: async (evs) => { sent.push(evs); return reply; },
    uploadUrl: async () => ({ path: "org/o/sessions/s1/x.jpg", token: "t" }),
    upload: async () => undefined,
    onWarning: cb.warn, onPausedChange: cb.paused, onProblemsChange: cb.problems, onAutoSubmit: cb.submit,
    ...extra,
  });
  m.start();
  return { m, cb, screenTrack, camTrack };
}
const types = () => sent.flat().map((e) => e.type);

beforeEach(() => {
  vi.useFakeTimers();
  HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
  sent = [];
  reply = { accepted: 1, violations: 0, action: "none" };
  fullscreen = document.body;
  Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => fullscreen });
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
  Object.defineProperty(window.screen, "isExtended", { configurable: true, get: () => false });
});
afterEach(() => vi.useRealTimers());

describe("proctor monitor: browser signals", () => {
  it("tab switch is sent immediately (hard violation) with a warning", async () => {
    const { cb, m } = setup("standard");
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(10);
    expect(types()).toEqual(["tab_hidden"]);
    expect(cb.warn).toHaveBeenCalledWith(expect.objectContaining({ type: "tab_hidden" }));
    await m.stop();
  });

  it("copy / cut / paste / right-click are batched; the editor's own paste report isn't double-counted", async () => {
    const { m } = setup("standard");
    m.report("paste_attempt", "medium", { source: "editor" });
    for (const t of ["copy", "cut", "paste"]) document.dispatchEvent(new Event(t));
    const ctx = new MouseEvent("contextmenu", { cancelable: true });
    document.dispatchEvent(ctx);
    expect(ctx.defaultPrevented).toBe(true);
    expect(sent).toHaveLength(0); // batched
    await vi.advanceTimersByTimeAsync(5000);
    expect(types().sort()).toEqual(["copy_attempt", "cut_attempt", "paste_attempt", "right_click"]);
    await m.stop();
  });

  it("devtools shortcuts are blocked and logged as a low-confidence signal", async () => {
    const { m } = setup("standard");
    const k = new KeyboardEvent("keydown", { key: "I", ctrlKey: true, shiftKey: true, cancelable: true });
    document.dispatchEvent(k);
    expect(k.defaultPrevented).toBe(true);
    await m.stop();
    const ev = sent.flat().find((e) => e.type === "devtools_suspected")!;
    expect(ev.confidence).toBeLessThan(1);
  });

  it("window blur under 2 s is ignored; longer becomes one event with a duration", async () => {
    const { m } = setup("standard");
    window.dispatchEvent(new Event("blur"));
    await vi.advanceTimersByTimeAsync(1000);
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("blur"));
    await vi.advanceTimersByTimeAsync(3000);
    window.dispatchEvent(new Event("focus"));
    await m.stop();
    const blurs = sent.flat().filter((e) => e.type === "window_blur");
    expect(blurs).toHaveLength(1);
    expect(Date.parse(blurs[0].endedAt!) - Date.parse(blurs[0].startedAt)).toBeGreaterThanOrEqual(2900);
  });

  it("an extra display connected mid-session is detected by the re-check", async () => {
    const { m, cb } = setup("standard");
    Object.defineProperty(window.screen, "isExtended", { configurable: true, get: () => true });
    await vi.advanceTimersByTimeAsync(5000);
    expect(types()).toContain("extra_display");
    expect(cb.problems).toHaveBeenLastCalledWith(["display"]);
    expect(cb.paused).not.toHaveBeenCalled(); // standard never pauses
    await m.stop();
  });
});

describe("proctor monitor: policies", () => {
  it("maximum: leaving full screen pauses until fixed, then sends session_resumed", async () => {
    const { m, cb } = setup("maximum");
    fullscreen = null;
    document.dispatchEvent(new Event("fullscreenchange"));
    expect(m.isPaused).toBe(true);
    expect(cb.paused).toHaveBeenLastCalledWith(true);
    await vi.advanceTimersByTimeAsync(10);
    expect(types()).toEqual(["fullscreen_exit"]);
    fullscreen = document.body;
    document.dispatchEvent(new Event("fullscreenchange"));
    expect(m.isPaused).toBe(false);
    await vi.advanceTimersByTimeAsync(10);
    expect(types()).toEqual(["fullscreen_exit", "session_resumed"]);
    await m.stop();
  });

  it("maximum: screen share stopped pauses; only an entire-screen re-share resumes", async () => {
    const { m, screenTrack } = setup("maximum");
    screenTrack.end();
    expect(m.isPaused).toBe(true);
    expect(m.currentProblems).toEqual(["screen"]);
    expect(m.replaceScreen(stream(new FakeTrack("window")))).toBe(false);
    expect(m.isPaused).toBe(true);
    expect(m.replaceScreen(stream(new FakeTrack("monitor")))).toBe(true);
    expect(m.isPaused).toBe(false);
    await m.stop();
    expect(types()).toEqual(["screen_share_stopped", "session_resumed"]);
  });

  it("maximum: camera turned off pauses", async () => {
    const { m, camTrack } = setup("maximum");
    camTrack.end();
    expect(m.currentProblems).toEqual(["camera"]);
    expect(m.isPaused).toBe(true);
    await m.stop();
    expect(types()).toContain("camera_off");
  });

  it("strict: the server's submit action triggers onAutoSubmit exactly once", async () => {
    const { m, cb } = setup("strict");
    reply = { accepted: 1, violations: 3, action: "submit" };
    fullscreen = null;
    document.dispatchEvent(new Event("fullscreenchange"));
    await vi.advanceTimersByTimeAsync(10);
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(10);
    expect(cb.submit).toHaveBeenCalledTimes(1);
    expect(m.isPaused).toBe(false); // strict never pauses
    await m.stop();
  });

  it("flags a virtual camera by its label (a hint for the reviewer)", async () => {
    const t = new FakeTrack("", "OBS Virtual Camera");
    const { m } = setup("standard", { camera: stream(t) });
    await m.stop();
    expect(sent.flat().find((e) => e.type === "virtual_camera_suspected")?.confidence).toBe(0.6);
  });

  it("after stop, nothing more is recorded", async () => {
    const { m } = setup("standard");
    await m.stop();
    document.dispatchEvent(new Event("copy"));
    await vi.advanceTimersByTimeAsync(6000);
    expect(types()).not.toContain("copy_attempt");
  });
});
