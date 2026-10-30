// The live monitor for one proctoring session: browser signals, camera checks, speech detection, snapshots,
// policy reactions (warn / pause / auto-submit). Framework-free so it can be tested with jsdom events;
// ProctoredSession owns one instance while the proctored screen is mounted.
import { DEFAULT_SEVERITY, EVENT_LABEL, isHard, isPauseType, type Sev } from "../../../supabase/functions/_shared/contracts/proctor-rules";
import { ConditionTracker, type ConditionType, type Incident } from "./conditions";
import { HeadPoseJudge } from "./headPose";
import { EnergyVad, rmsDb } from "./vad";
import { EventQueue, type QueuedEvent, type SendResult } from "./queue";
import { SnapshotUploader, captureFrame, videoFor, type SnapKind, type SnapType, type UploadJob } from "./snapshots";
import { framesIdentical, looksVirtual, startFaceLoop, tinyFrame, type FaceDetectorLike, type FaceFrame } from "./detector";
import { TIER_FPS, displayCount, displaySurface, type Tier } from "./systemCheck";

export type Policy = "standard" | "strict" | "maximum";
/** Things the candidate must fix (Maximum policy pauses until all are fixed). */
export type Problem = "screen" | "camera" | "fullscreen" | "display";

export const PROBLEM_COPY: Record<Problem, string> = {
  screen: "Screen sharing stopped. Share your entire screen again to continue.",
  camera: "Your camera is off. Turn it back on to continue.",
  fullscreen: "You left full screen. Return to full screen to continue.",
  display: "A second display is connected. Disconnect it to continue.",
};

export const WARNING_COPY: Record<string, string> = {
  tab_hidden: "Please stay on this tab. Switching tabs or apps is logged for review.",
  window_blur: "Please stay in the test window.",
  fullscreen_exit: "Please return to full screen.",
  screen_share_stopped: "Screen sharing stopped. Please share your entire screen again.",
  extra_display: "Please disconnect the extra display.",
  copy_attempt: "Copying is logged during this test.",
  cut_attempt: "Cutting text is logged during this test.",
  paste_attempt: "Pasting is logged during this test.",
  devtools_suspected: "Developer tools aren't allowed during this test.",
  no_face: "We can't see your face. Please stay in front of the camera.",
  multiple_faces: "Someone else seems to be in view. The test should be taken alone.",
  looking_away: "Please keep your eyes on the screen.",
  camera_off: "Your camera is off. Please turn it back on.",
  camera_frozen: "Your camera image seems frozen. Check your camera.",
  speech_detected: "We hear talking. Please work quietly during the coding test.",
};

export interface MonitorDeps {
  sessionId: string;
  policy: Policy;
  kind: "assessment" | "interview";
  tier: Tier;
  snapshotIntervalS: number;
  camera: MediaStream | null;
  mic: MediaStream | null;
  screen: MediaStream | null;
  sendEvents: (events: QueuedEvent[]) => Promise<SendResult>;
  uploadUrl: (kind: SnapKind, type: SnapType) => Promise<{ path: string; token: string }>;
  upload: (job: UploadJob) => Promise<void>;
  loadDetector?: () => Promise<FaceDetectorLike>;
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
  onWarning?: (w: { type: string; message: string }) => void;
  /** Strict policy (R2.6): a serious violation was counted; `final` = the next one submits the test. */
  onStrike?: (s: { violations: number; max: number; final: boolean }) => void;
  onPausedChange?: (paused: boolean) => void;
  onProblemsChange?: (problems: Problem[]) => void;
  onAutoSubmit?: () => void;
  /** Test hooks */
  win?: Window;
  doc?: Document;
}

const DEDUPE_MS = 1500;

export class ProctorMonitor {
  readonly queue: EventQueue;
  private readonly tracker: ConditionTracker;
  private readonly judge = new HeadPoseJudge();
  private readonly uploader: SnapshotUploader;
  private readonly win: Window;
  private readonly doc: Document;
  private cleanups: (() => void)[] = [];
  private problems = new Set<Problem>();
  private paused = false;
  private submitted = false;
  private stopped = false;
  private lastEmit = new Map<string, number>();
  private conditionEvidence = new Map<ConditionType, string>();
  private screenVideo: HTMLVideoElement | null = null;
  private cameraVideo: HTMLVideoElement | null = null;
  private vad: EnergyVad | null = null;
  private devtoolsOpen = false;
  /** Stops the current camera's watchers (listeners, frozen check, face loop); run when the camera is replaced. */
  private stopCameraWatch: (() => void)[] = [];

  constructor(private readonly d: MonitorDeps) {
    this.win = d.win ?? window;
    this.doc = d.doc ?? document;
    this.queue = new EventQueue({
      send: d.sendEvents, onResult: (r) => this.onServer(r),
      storage: d.storage ?? null, storageKey: `hr-proctor-q:${d.sessionId}`,
    });
    this.tracker = new ConditionTracker({ warn: (t) => this.onConditionWarn(t), incident: (i) => this.onIncident(i) });
    this.uploader = new SnapshotUploader(d.upload);
  }

  get isPaused() { return this.paused; }
  get currentProblems(): Problem[] { return [...this.problems]; }

  start() {
    const { win, doc } = this;
    const on = <K extends string>(target: EventTarget, type: K, fn: (e: Event) => void, opts?: AddEventListenerOptions) => {
      target.addEventListener(type, fn, opts);
      this.cleanups.push(() => target.removeEventListener(type, fn, opts));
    };
    on(doc, "visibilitychange", () => {
      if (doc.visibilityState === "hidden") {
        this.tracker.set("window_blur", false, Date.now());
        void this.emitWithEvidence("tab_hidden", "screen");
      }
    });
    on(win, "blur", () => {
      if (doc.visibilityState === "hidden") return; // counted once, as a tab switch
      this.tracker.set("window_blur", true, Date.now());
      void this.snapshot("screen", false).then((p) => { if (p) this.conditionEvidence.set("window_blur", p); });
    });
    on(win, "focus", () => this.tracker.set("window_blur", false, Date.now()));
    on(doc, "fullscreenchange", () => {
      if (doc.fullscreenElement) this.clearProblem("fullscreen");
      else { this.emit("fullscreen_exit"); this.addProblem("fullscreen"); }
    });
    for (const [ev, type] of [["copy", "copy_attempt"], ["cut", "cut_attempt"], ["paste", "paste_attempt"]] as const) {
      on(doc, ev, () => this.emit(type));
    }
    on(doc, "contextmenu", (e) => { e.preventDefault(); this.emit("right_click"); });
    on(doc, "keydown", (e) => {
      const k = e as KeyboardEvent;
      const key = k.key?.toUpperCase();
      if (key === "F12" || ((k.ctrlKey || k.metaKey) && (k.shiftKey || k.altKey) && ["I", "J", "C"].includes(key))) {
        k.preventDefault();
        this.emit("devtools_suspected", { confidence: 0.6, meta: { via: "shortcut" } });
      }
    }, { capture: true });

    // Extra display: event where supported, plus a poll (also re-checks after the start).
    const checkDisplays = () => {
      if (displayCount(win.screen as Screen & { isExtended?: boolean }) > 1) {
        if (!this.problems.has("display")) { this.emit("extra_display"); this.addProblem("display"); }
      } else this.clearProblem("display");
    };
    const scr = win.screen as unknown as Partial<EventTarget> | undefined;
    if (scr && typeof scr.addEventListener === "function") on(scr as EventTarget, "change", checkDisplays);
    this.every(5000, checkDisplays);
    this.every(3000, () => this.checkDevtools());
    this.every(250, () => this.tracker.tick(Date.now()));

    this.watchScreen(this.d.screen);
    this.watchCamera(this.d.camera);
    if (this.d.kind === "assessment" && this.d.mic) this.startVad(this.d.mic);

    // Periodic snapshots (screen + webcam); never continuous video.
    const every = Math.max(10, this.d.snapshotIntervalS) * 1000;
    this.every(every, () => { void this.periodicSnapshots(); });
    if (!doc.fullscreenElement && doc.fullscreenEnabled !== false && typeof doc.fullscreenElement !== "undefined") {
      // Started without full screen (it was refused): treat as an exit so the candidate is asked to return.
      this.addProblem("fullscreen");
    }
  }

  /** A signal reported by the host screen (e.g. the code editor). */
  report(type: string, severity?: Sev, meta?: Record<string, unknown>) {
    this.emit(type, { severity, meta });
  }

  /** Candidate re-shared after a stop: must be the entire screen again. */
  replaceScreen(stream: MediaStream): boolean {
    if (displaySurface(stream) !== "monitor") return false;
    this.d.screen?.getTracks().forEach((t) => t.stop());
    this.d.screen = stream;
    this.watchScreen(stream);
    this.clearProblem("screen");
    return true;
  }

  replaceCamera(stream: MediaStream) {
    this.d.camera?.getVideoTracks().forEach((t) => t.stop());
    this.d.camera = stream;
    this.watchCamera(stream);
    this.clearProblem("camera");
  }

  /** Stop everything and send what's queued. Resolves when the queue drained (or gave up). */
  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    const t = Date.now();
    this.tracker.flush(t);
    this.vad?.flush();
    for (const c of this.cleanups.splice(0)) { try { c(); } catch { /* ignore */ } }
    this.uploader.stop();
    await this.queue.drain();
    this.queue.stop();
  }

  // ── internals ───────────────────────────────────────────────────────────

  private every(ms: number, fn: () => void) {
    const id = setInterval(fn, ms);
    this.cleanups.push(() => clearInterval(id));
  }

  private emit(type: string, o: { severity?: Sev; confidence?: number; startedAt?: number; endedAt?: number; evidencePath?: string; meta?: Record<string, unknown> } = {}) {
    if (this.stopped) return;
    const now = Date.now();
    // Same signal from two sources (document listener + the editor's report) within a moment counts once.
    if (type !== "snapshot" && now - (this.lastEmit.get(type) ?? 0) < DEDUPE_MS && !o.endedAt) return;
    this.lastEmit.set(type, now);
    const severity = o.severity ?? DEFAULT_SEVERITY[type] ?? "low";
    const ev: Omit<QueuedEvent, "clientEventId"> = {
      type, severity, confidence: o.confidence ?? 1, startedAt: new Date(o.startedAt ?? now).toISOString(),
      ...(o.endedAt ? { endedAt: new Date(o.endedAt).toISOString() } : {}),
      ...(o.evidencePath ? { evidencePath: o.evidencePath } : {}),
      ...(o.meta ? { meta: o.meta } : {}),
    };
    const urgent = isHard(type) || isPauseType(type) || type === "session_resumed";
    this.queue.add(ev, urgent);
    // Incidents with a duration were already warned about when they crossed their threshold; in Maximum the
    // pause screen explains pause-type problems.
    if (severity !== "info" && !o.endedAt && !(this.d.policy === "maximum" && isPauseType(type))) {
      const message = WARNING_COPY[type];
      if (message) this.d.onWarning?.({ type, message });
    }
  }

  private async emitWithEvidence(type: string, kind: SnapKind) {
    const at = Date.now();
    const path = await this.snapshot(kind, false);
    this.emit(type, { startedAt: at, evidencePath: path ?? undefined });
  }

  /** Capture + background upload. Returns the evidence path (known before the upload finishes) or null. */
  private async snapshot(kind: SnapKind, periodic: boolean): Promise<string | null> {
    try {
      const video = kind === "screen" ? this.screenVideo : this.cameraVideo;
      const frame = await captureFrame(video, kind);
      if (!frame) return null;
      const { path, token } = await this.d.uploadUrl(kind, frame.type);
      this.uploader.enqueue({ path, token, blob: frame.blob, type: frame.type, periodic });
      return path;
    } catch {
      return null;
    }
  }

  private async periodicSnapshots() {
    for (const kind of ["screen", "camera"] as const) {
      const path = await this.snapshot(kind, true);
      if (path) this.emit("snapshot", { severity: "info", evidencePath: path, meta: { kind } });
    }
  }

  private onConditionWarn(type: ConditionType) {
    const message = WARNING_COPY[type];
    if (message) this.d.onWarning?.({ type, message });
    if (type !== "window_blur" && type !== "camera_frozen") {
      void this.snapshot("camera", false).then((p) => { if (p) this.conditionEvidence.set(type, p); });
    }
  }

  private onIncident(i: Incident) {
    const confidence = i.type === "looking_away" ? 0.7 : i.type === "no_face" || i.type === "multiple_faces" ? 0.85 : 1;
    const evidencePath = this.conditionEvidence.get(i.type);
    this.conditionEvidence.delete(i.type);
    const durS = (i.endedAt - i.startedAt) / 1000;
    const base = DEFAULT_SEVERITY[i.type] ?? "low";
    const severity: Sev = durS >= 60 && base === "low" ? "medium" : base;
    this.emit(i.type, { severity, confidence, startedAt: i.startedAt, endedAt: Math.max(i.endedAt, i.startedAt + 1), evidencePath,
                        meta: { duration_s: Math.round(durS) } });
  }

  private onServer(r: SendResult) {
    if ((r.action === "warn" || r.action === "final_warning") && r.maxViolations) {
      this.d.onStrike?.({ violations: r.violations, max: r.maxViolations, final: r.action === "final_warning" });
    }
    if (r.action === "submit" && !this.submitted) {
      this.submitted = true;
      this.d.onAutoSubmit?.();
    } else if (r.action === "pause" && this.problems.size > 0) {
      this.setPaused(true);
    }
  }

  private addProblem(p: Problem) {
    if (this.problems.has(p)) return;
    this.problems.add(p);
    this.d.onProblemsChange?.(this.currentProblems);
    if (this.d.policy === "maximum") this.setPaused(true);
  }

  private clearProblem(p: Problem) {
    if (!this.problems.delete(p)) return;
    this.d.onProblemsChange?.(this.currentProblems);
    if (this.d.policy === "maximum" && this.problems.size === 0 && this.paused) {
      this.emit("session_resumed", { severity: "info" });
      this.setPaused(false);
    }
  }

  private setPaused(v: boolean) {
    if (this.paused === v) return;
    this.paused = v;
    this.d.onPausedChange?.(v);
  }

  private checkDevtools() {
    const w = this.win;
    const fs = !!this.doc.fullscreenElement;
    const gapW = fs ? w.screen.width - w.innerWidth : w.outerWidth - w.innerWidth;
    const gapH = fs ? w.screen.height - w.innerHeight : w.outerHeight - w.innerHeight;
    const open = (gapW > 200 || gapH > 250) && w.innerWidth > 0;
    if (open && !this.devtoolsOpen) this.emit("devtools_suspected", { confidence: 0.5, meta: { via: "size", gapW, gapH } });
    this.devtoolsOpen = open;
  }

  private watchScreen(stream: MediaStream | null) {
    const track = stream?.getVideoTracks()[0];
    if (!track) return;
    this.screenVideo = videoFor(stream!);
    const ended = () => {
      if (this.d.screen !== stream) return;
      this.emit("screen_share_stopped");
      this.addProblem("screen");
    };
    track.addEventListener("ended", ended);
    this.cleanups.push(() => track.removeEventListener("ended", ended));
  }

  private watchCamera(stream: MediaStream | null) {
    // A replaced camera's face loop would otherwise keep running on the dead stream's last frame next to the new
    // one: double the detection work, and stale results mixed into the no-face / looking-away signals.
    for (const c of this.stopCameraWatch.splice(0)) { try { c(); } catch { /* ignore */ } }
    const track = stream?.getVideoTracks()[0];
    if (!track) return;
    const own = (fn: () => void) => { this.stopCameraWatch.push(fn); this.cleanups.push(fn); };
    this.cameraVideo = videoFor(stream!);
    if (looksVirtual(track.label ?? "")) {
      this.emit("virtual_camera_suspected", { confidence: 0.6, meta: { label: track.label.slice(0, 80) } });
    }
    let mutedTimer: ReturnType<typeof setTimeout> | null = null;
    const off = (why: string) => {
      if (this.d.camera !== stream || this.problems.has("camera")) return;
      this.emit("camera_off", { meta: { why } });
      this.addProblem("camera");
    };
    const onEnded = () => off("ended");
    const onMute = () => { mutedTimer = setTimeout(() => off("muted"), 3000); };
    const onUnmute = () => {
      if (mutedTimer) clearTimeout(mutedTimer);
      if (this.d.camera === stream && track.readyState === "live") this.clearProblem("camera");
    };
    track.addEventListener("ended", onEnded);
    track.addEventListener("mute", onMute);
    track.addEventListener("unmute", onUnmute);
    own(() => {
      track.removeEventListener("ended", onEnded); track.removeEventListener("mute", onMute); track.removeEventListener("unmute", onUnmute);
      if (mutedTimer) clearTimeout(mutedTimer);
    });

    // Frozen feed: compare tiny thumbnails every 2 s.
    const canvas = this.doc.createElement("canvas");
    let prev: Uint8ClampedArray | null = null;
    const frozenTimer = setInterval(() => {
      if (this.d.camera !== stream || !this.cameraVideo) return;
      const cur = tinyFrame(this.cameraVideo, canvas);
      this.tracker.set("camera_frozen", framesIdentical(prev, cur), Date.now());
      prev = cur;
    }, 2000);
    own(() => clearInterval(frozenTimer));

    const fps = TIER_FPS[this.d.tier];
    if (fps > 0 && this.d.loadDetector) {
      const video = this.cameraVideo;
      this.d.loadDetector().then((det) => {
        if (this.stopped || this.d.camera !== stream) return;
        const stopLoop = startFaceLoop(det, video, fps, (f) => { if (this.d.camera === stream) this.onFace(f); });
        own(stopLoop);
      }).catch(() => { /* model unavailable: browser signals + snapshots still run */ });
    }
  }

  private onFace(f: FaceFrame) {
    if (this.paused) return;
    this.tracker.set("no_face", f.faces === 0, f.t);
    this.tracker.set("multiple_faces", f.faces >= 2, f.t);
    const away = f.faces === 1 && f.pose ? this.judge.judge(f.pose[0], f.pose[1]) : null;
    this.tracker.set("looking_away", away === true, f.t);
  }

  private startVad(mic: MediaStream) {
    const Ctx = (this.win as Window & { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
      ?? (this.win as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx || !mic.getAudioTracks().length) return;
    try {
      const ctx = new Ctx();
      const src = ctx.createMediaStreamSource(mic);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      src.connect(analyser);
      const buf = new Float32Array(analyser.fftSize);
      this.vad = new EnergyVad({
        start: () => this.d.onWarning?.({ type: "speech_detected", message: WARNING_COPY.speech_detected }),
        segment: (s) => this.emit("speech_detected", { confidence: 0.7, startedAt: s.startedAt, endedAt: s.endedAt,
                                                        meta: { peak_db: s.peakDb, duration_s: Math.round((s.endedAt - s.startedAt) / 1000) } }),
      });
      this.every(100, () => { analyser.getFloatTimeDomainData(buf); this.vad?.push(rmsDb(buf), Date.now()); });
      this.cleanups.push(() => { void ctx.close().catch(() => undefined); });
    } catch { /* audio unavailable: skip VAD */ }
  }
}

export const eventLabel = (t: string) => EVENT_LABEL[t] ?? t;
