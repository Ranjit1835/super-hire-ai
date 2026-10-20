// System check: browser, camera, microphone, speakers, bandwidth, device tier, displays.
// Used as the first step of ProctoredSession and on the stand-alone /proctor/check page.
import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, AlertTriangle, XCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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

function Row({ label, status, detail }: { label: string; status: Status; detail?: string }) {
  const Icon = status === "ok" ? CheckCircle2 : status === "warn" ? AlertTriangle : status === "fail" ? XCircle : Loader2;
  const color = status === "ok" ? "text-emerald-600" : status === "warn" ? "text-amber-600" : status === "fail" ? "text-destructive" : "text-muted-foreground animate-spin";
  return (
    <li className="flex items-start gap-3 py-2" data-testid={`check-${label}`} data-status={status}>
      <Icon className={`h-5 w-5 mt-0.5 shrink-0 ${color}`} aria-hidden />
      <div className="min-w-0">
        <p className="font-medium text-sm">{label}</p>
        {detail && <p className="text-sm text-muted-foreground">{detail}</p>}
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
      <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-4" data-testid="unsupported">
        <p className="font-semibold">This device or browser isn't supported for proctored tests</p>
        <p className="text-sm mt-1">{SUPPORT_MESSAGE[support]}</p>
        <p className="text-xs text-muted-foreground mt-2">Detected: {browser.browser} {browser.version || ""}{browser.mobile ? " (mobile)" : ""}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ul className="divide-y divide-border">
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
        <video ref={preview} muted playsInline autoPlay className="h-24 w-32 rounded-md bg-muted object-cover -scale-x-100" aria-label="Camera preview" />
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
