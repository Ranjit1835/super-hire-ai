// System check: browser, camera, microphone, speakers, bandwidth, device tier, displays.
// Used as the first step of ProctoredSession and on the stand-alone /proctor/check page.
// Each row states its result in words (Passed / Needs attention / Not checked / Checking…) plus the one fix to make.
// Red is reserved for a row that actually blocks the test; a non-blocking suggestion stays orange, never alarming.
import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, AlertTriangle, Circle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  MEDIA_MESSAGE, MIN_BANDWIDTH_KBPS, SUPPORT_MESSAGE, deviceInfo, detectBrowser, displayCount, estimateBandwidth, mediaProblem,
  qualityTier, requestCameraMic, stopStream, supportProblem, type BrowserInfo, type MediaProblem, type Tier,
} from "./systemCheck";

export type Status = "pending" | "ok" | "warn" | "fail";

export interface CheckResult {
  browser: BrowserInfo;
  camera: boolean;
  mic: boolean;
  speakers: boolean;
  bandwidthKbps: number | null;
  cores: number | null;
  memoryGb: number | null;
  displays: number;
  tier: Tier;
  /** Live camera (+ mic) stream, handed to the monitor so the browser doesn't ask twice. */
  stream: MediaStream | null;
}

/** Not checked yet is a distinct, calm state from a real problem: say so in words, not just an icon. */
function rowWord(status: Status, detail?: string): string {
  if (status === "ok") return "Passed";
  if (status === "pending") return "Checking…";
  if (status === "warn") return detail === "Not checked yet" ? "Not checked" : "Needs attention";
  return "Needs attention";
}

/** Exported for the gallery (a fixed-state preview needs the same row without live camera/mic calls). */
export function Row({ label, status, detail }: { label: string; status: Status; detail?: string }) {
  const word = rowWord(status, detail);
  const notChecked = word === "Not checked";
  const Icon = status === "ok" ? CheckCircle2 : status === "pending" ? Loader2 : notChecked ? Circle : AlertTriangle;
  const tone = status === "ok" ? "text-[var(--hr-gold)]" : status === "pending" ? "text-[var(--hr-blue-ink)]"
    : notChecked ? "text-[var(--hr-muted)]" : status === "fail" ? "text-[var(--hr-red-ink)]" : "text-[var(--hr-orange)]";
  return (
    <li className="flex items-start gap-3 py-3 hr-rule-b" data-testid={`check-${label}`} data-status={status}>
      <Icon className={cn("h-4 w-4 mt-0.5 shrink-0", tone, status === "pending" && "animate-spin")} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <p className="text-sm font-semibold">{label}</p>
          <span className={cn("hr-label !text-[10px]", tone)}>{word}</span>
        </div>
        {detail && detail !== "Not checked yet" && <p className="text-sm text-[var(--hr-muted)] mt-0.5">{detail}</p>}
      </div>
    </li>
  );
}

export function SystemCheckPanel({ kind, onPassed, keepStream = true }: {
  kind: "assessment" | "interview";
  onPassed?: (r: CheckResult) => void;
  /** false on the stand-alone page: release the camera once checked. */
  keepStream?: boolean;
}) {
  const [browser] = useState<BrowserInfo>(() => detectBrowser(navigator.userAgent,
    (navigator as Navigator & { userAgentData?: { brands?: { brand: string; version: string }[]; mobile?: boolean } }).userAgentData));
  const support = supportProblem(browser);
  const [media, setMedia] = useState<{ status: "idle" | "asking" | "ok" | "error"; problem?: MediaProblem; camera: boolean; mic: boolean }>(
    { status: "idle", camera: false, mic: false });
  const [speakers, setSpeakers] = useState<boolean | null>(null);
  const [bandwidth, setBandwidth] = useState<number | null | undefined>(undefined);
  const [displays, setDisplays] = useState(() => displayCount());
  const stream = useRef<MediaStream | null>(null);
  const preview = useRef<HTMLVideoElement | null>(null);
  const handedOver = useRef(false);
  const dev = deviceInfo();
  const tier = qualityTier({ cores: dev.cores, memoryGb: dev.memoryGb, bandwidthKbps: bandwidth ?? null });

  useEffect(() => {
    let alive = true;
    void estimateBandwidth().then((b) => { if (alive) setBandwidth(b); });
    const id = setInterval(() => setDisplays(displayCount()), 2000);
    return () => {
      alive = false;
      clearInterval(id);
      if (!handedOver.current) stopStream(stream.current);
    };
  }, []);

  const askMedia = useCallback(async () => {
    setMedia({ status: "asking", camera: false, mic: false });
    stopStream(stream.current);
    try {
      const s = await requestCameraMic(navigator.mediaDevices, true);
      stream.current = s;
      if (preview.current) { preview.current.srcObject = s; void preview.current.play?.()?.catch?.(() => undefined); }
      setMedia({ status: "ok", camera: s.getVideoTracks().length > 0, mic: s.getAudioTracks().length > 0 });
    } catch (e) {
      setMedia({ status: "error", problem: mediaProblem(e), camera: false, mic: false });
    }
  }, []);

  const playTone = useCallback(() => {
    try {
      const Ctx = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      gain.gain.value = 0.15;
      osc.frequency.value = 660;
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.6);
      osc.onended = () => { void ctx.close(); };
    } catch { /* no audio output */ }
  }, []);

  const bwStatus: Status = bandwidth === undefined ? "pending" : bandwidth === null ? "warn" : bandwidth < MIN_BANDWIDTH_KBPS ? "warn" : "ok";
  const passed = !support && media.status === "ok" && media.camera && (kind === "interview" || media.mic) && displays <= 1;

  const done = () => {
    if (!passed) return;
    handedOver.current = keepStream;
    if (!keepStream) stopStream(stream.current);
    onPassed?.({
      browser, camera: media.camera, mic: media.mic, speakers: speakers === true, bandwidthKbps: bandwidth ?? null,
      cores: dev.cores, memoryGb: dev.memoryGb, displays, tier, stream: keepStream ? stream.current : null,
    });
  };

  if (support) {
    return (
      <div role="alert" className="border border-[var(--hr-red)] bg-[var(--hr-surface)] p-4" data-testid="unsupported">
        <p className="font-semibold text-[var(--hr-red-ink)]">This device or browser isn't supported for proctored tests</p>
        <p className="text-sm mt-1">{SUPPORT_MESSAGE[support]}</p>
        <p className="hr-data text-xs text-[var(--hr-muted)] mt-2">Detected: {browser.browser} {browser.version || ""}{browser.mobile ? " (mobile)" : ""}</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <ul className="bg-[var(--hr-surface)] px-4" aria-label="Checks">
        <Row label="Browser" status="ok" detail={`${browser.browser} ${browser.version}`} />
        <Row label="Camera" status={media.status === "ok" ? (media.camera ? "ok" : "fail") : media.status === "error" ? "fail" : media.status === "asking" ? "pending" : "warn"}
             detail={media.status === "error" ? MEDIA_MESSAGE[media.problem ?? "other"] : media.status === "idle" ? "Not checked yet" : undefined} />
        <Row label="Microphone" status={media.status === "ok" ? (media.mic ? "ok" : kind === "interview" ? "warn" : "fail") : media.status === "error" ? "fail" : media.status === "asking" ? "pending" : "warn"}
             detail={kind === "assessment" ? "Used only to detect speech during the coding test; nothing is recorded." : undefined} />
        <Row label="Speakers" status={speakers ? "ok" : "warn"} detail={speakers ? "You heard the test sound" : "Play the test sound and confirm you heard it"} />
        <Row label="Connection" status={bwStatus}
             detail={bandwidth === undefined ? "Measuring…" : bandwidth === null ? "Couldn't measure; a stable connection is recommended" : `About ${(bandwidth / 1000).toFixed(1)} Mbps${bandwidth < MIN_BANDWIDTH_KBPS ? " — slow; snapshots may upload late" : ""}`} />
        <Row label="Device" status={tier === "minimal" ? "warn" : "ok"}
             detail={`${dev.cores ?? "?"} cores, ${dev.memoryGb ?? "?"} GB memory → ${tier === "full" ? "full checks" : tier === "lite" ? "light checks (saves battery and CPU)" : "basic checks only"}`} />
        <Row label="Displays" status={displays > 1 ? "fail" : "ok"} detail={displays > 1 ? "More than one display is connected. Disconnect extra monitors (or set them to mirror) and wait a moment." : "Single display"} />
      </ul>

      <div className="flex flex-wrap items-center gap-3">
        <video ref={preview} muted playsInline autoPlay className="h-24 w-32 bg-[var(--hr-surface-2)] object-cover -scale-x-100 shadow-[inset_0_0_0_1px_var(--hr-rule)]" aria-label="Camera preview" />
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant={media.status === "ok" ? "outline" : "default"} onClick={askMedia} disabled={media.status === "asking"}>
            {media.status === "ok" ? "Re-check camera & mic" : "Allow camera & microphone"}
          </Button>
          <Button type="button" variant="outline" onClick={playTone}>Play test sound</Button>
          {speakers !== true && <Button type="button" variant="ghost" onClick={() => setSpeakers(true)}>I heard it</Button>}
        </div>
      </div>

      {onPassed && (
        <Button type="button" onClick={done} disabled={!passed} className="w-full sm:w-auto">
          Continue
        </Button>
      )}
    </div>
  );
}
