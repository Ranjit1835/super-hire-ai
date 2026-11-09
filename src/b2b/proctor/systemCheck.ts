// System check helpers: browser support, device tier, bandwidth, screen-share surface, displays.
// Pure where possible so the outcomes are unit-tested with mocked browser APIs.

export const MIN_CHROMIUM_VERSION = 110;

export interface BrowserInfo { browser: string; version: number; chromium: boolean; mobile: boolean }

interface UAData { brands?: { brand: string; version: string }[]; mobile?: boolean }

/** Which browser is this? Prefers User-Agent Client Hints; falls back to the UA string. */
export function detectBrowser(ua: string, uaData?: UAData | null): BrowserInfo {
  const mobileUa = /Android|iPhone|iPad|iPod|Mobile|CriOS|FxiOS/i.test(ua);
  const mobile = uaData?.mobile ?? mobileUa;
  const brands = uaData?.brands ?? [];
  const brand = (name: string) => brands.find((b) => b.brand === name);
  const chromiumBrand = brand("Chromium");
  if (chromiumBrand) {
    const named = brand("Microsoft Edge") ?? brand("Google Chrome") ?? brand("Opera") ?? brand("Brave");
    return { browser: named?.brand.replace(/^Google /, "").replace(/^Microsoft /, "") ?? "Chromium",
             version: parseInt((named ?? chromiumBrand).version, 10) || 0, chromium: true, mobile: mobile || mobileUa };
  }
  const m = (re: RegExp) => { const x = ua.match(re); return x ? parseInt(x[1], 10) : 0; };
  // iOS browsers are all WebKit underneath, whatever their name.
  if (/CriOS|FxiOS|EdgiOS/.test(ua)) return { browser: "iOS browser", version: 0, chromium: false, mobile: true };
  if (/Edg\//.test(ua)) return { browser: "Edge", version: m(/Edg\/(\d+)/), chromium: true, mobile };
  if (/OPR\//.test(ua)) return { browser: "Opera", version: m(/Chrome\/(\d+)/), chromium: true, mobile };
  if (/Firefox\//.test(ua)) return { browser: "Firefox", version: m(/Firefox\/(\d+)/), chromium: false, mobile };
  if (/Chrome\//.test(ua)) return { browser: "Chrome", version: m(/Chrome\/(\d+)/), chromium: true, mobile };
  if (/Safari\//.test(ua)) return { browser: "Safari", version: m(/Version\/(\d+)/), chromium: false, mobile };
  return { browser: "Unknown", version: 0, chromium: false, mobile };
}

export type SupportProblem = "mobile" | "not_chromium" | "too_old" | null;

export function supportProblem(b: BrowserInfo): SupportProblem {
  if (b.mobile) return "mobile";
  if (!b.chromium) return "not_chromium";
  if (b.version < MIN_CHROMIUM_VERSION) return "too_old";
  return null;
}

export const SUPPORT_MESSAGE: Record<Exclude<SupportProblem, null>, string> = {
  mobile: "Proctored tests need a laptop or desktop computer. Phones and tablets can't share the entire screen.",
  not_chromium: "Please open this page in Google Chrome or Microsoft Edge on a laptop or desktop.",
  too_old: `Your browser is out of date. Update Chrome or Edge to version ${MIN_CHROMIUM_VERSION} or newer and reload.`,
};

export type Tier = "full" | "lite" | "minimal";

/**
 * Device quality tier: decides how often face checks run. A 4 GB dual-core laptop is "lite" (face checks at
 * 2 fps); "minimal" skips face checks entirely (browser signals and snapshots still run).
 */
export function qualityTier(d: { cores: number | null; memoryGb: number | null; bandwidthKbps: number | null }): Tier {
  const cores = d.cores ?? 2;
  const mem = d.memoryGb ?? 4;
  if (cores < 2 || mem < 2) return "minimal";
  if (cores >= 4 && mem >= 8 && (d.bandwidthKbps === null || d.bandwidthKbps >= 1000)) return "full";
  return "lite";
}

/** Face-check frames per second for a tier (≤ 5 fps always). */
export const TIER_FPS: Record<Tier, number> = { full: 4, lite: 2, minimal: 0 };

export const MIN_BANDWIDTH_KBPS = 300;

/** Rough downlink estimate: Network Information API if present, else time a small cache-busted download. */
export async function estimateBandwidth(
  opts: { connection?: { downlink?: number } | null; fetchImpl?: typeof fetch; url?: string; now?: () => number } = {},
): Promise<number | null> {
  const conn = opts.connection !== undefined ? opts.connection
    : (typeof navigator !== "undefined" ? (navigator as unknown as { connection?: { downlink?: number } }).connection : null);
  if (conn && typeof conn.downlink === "number" && conn.downlink > 0) return Math.round(conn.downlink * 1000);
  const f = opts.fetchImpl ?? (typeof fetch !== "undefined" ? fetch : null);
  if (!f) return null;
  const now = opts.now ?? (() => performance.now());
  try {
    const t0 = now();
    const res = await f(`${opts.url ?? "/logo.svg"}?bw=${Date.now()}`, { cache: "no-store" });
    const buf = await res.arrayBuffer();
    const ms = Math.max(1, now() - t0);
    return Math.round((buf.byteLength * 8) / ms); // bits per ms = kbps
  } catch {
    return null;
  }
}

export type Surface = "monitor" | "window" | "browser" | "none";

/** What the user picked in the share dialog. Only "monitor" (entire screen) is accepted. */
export function displaySurface(stream: MediaStream | null): Surface {
  const track = stream?.getVideoTracks()[0];
  if (!track || track.readyState === "ended") return "none";
  const s = (track.getSettings() as MediaTrackSettings & { displaySurface?: string }).displaySurface;
  return s === "monitor" || s === "window" || s === "browser" ? s : "none";
}

/** 2 when the OS reports an extended desktop (more than one display), else 1. */
export function displayCount(scr: (Screen & { isExtended?: boolean }) | undefined = typeof window !== "undefined" ? window.screen : undefined): number {
  return scr?.isExtended ? 2 : 1;
}

export function deviceInfo(nav: Navigator = navigator): { cores: number | null; memoryGb: number | null } {
  const mem = (nav as Navigator & { deviceMemory?: number }).deviceMemory;
  return { cores: nav.hardwareConcurrency || null, memoryGb: typeof mem === "number" ? mem : null };
}

export type MediaProblem = "denied" | "not_found" | "in_use" | "unsupported" | "other";

export function mediaProblem(e: unknown): MediaProblem {
  const name = (e as { name?: string })?.name ?? "";
  if (name === "NotAllowedError" || name === "SecurityError") return "denied";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "not_found";
  if (name === "NotReadableError" || name === "AbortError") return "in_use";
  if (name === "Unsupported") return "unsupported";
  return "other";
}

export const MEDIA_MESSAGE: Record<MediaProblem, string> = {
  denied: "Permission was blocked. Click the camera icon in the address bar, allow access, then try again.",
  not_found: "No device found. Connect a webcam / microphone and try again.",
  in_use: "Another app is using it. Close Zoom, Teams or other camera apps and try again.",
  unsupported: "This browser can't access the camera or microphone.",
  other: "Something went wrong. Try again.",
};

/** Ask for entire-screen sharing; the dialog opens on "Entire screen" where the browser supports the hint. */
export function requestScreen(md: MediaDevices = navigator.mediaDevices): Promise<MediaStream> {
  if (!md?.getDisplayMedia) return Promise.reject(Object.assign(new Error("Unsupported"), { name: "Unsupported" }));
  return md.getDisplayMedia({
    video: { displaySurface: "monitor", frameRate: { max: 5 } } as MediaTrackConstraints,
    audio: false,
    // Chromium hints: offer the monitor first, don't let the user switch to a tab mid-session.
    monitorTypeSurfaces: "include", surfaceSwitching: "exclude", selfBrowserSurface: "exclude",
  } as DisplayMediaStreamOptions);
}

export function requestCameraMic(md: MediaDevices = navigator.mediaDevices, audio = true): Promise<MediaStream> {
  if (!md?.getUserMedia) return Promise.reject(Object.assign(new Error("Unsupported"), { name: "Unsupported" }));
  return md.getUserMedia({
    video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { max: 15 }, facingMode: "user" },
    audio: audio ? { echoCancellation: true, noiseSuppression: false, autoGainControl: false } : false,
  });
}

export function stopStream(s: MediaStream | null | undefined) {
  s?.getTracks().forEach((t) => t.stop());
}
