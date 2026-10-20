// Entire-screen share (window / tab shares are rejected) + single display, then full screen.
import { useState } from "react";
import { Monitor } from "lucide-react";
import { Button } from "@/components/ui/button";
import { displayCount, displaySurface, mediaProblem, requestScreen, stopStream } from "./systemCheck";

export const SURFACE_MESSAGE: Record<string, string> = {
  window: "You shared a single window. Please share your Entire screen instead.",
  browser: "You shared a browser tab. Please share your Entire screen instead.",
  none: "Screen sharing didn't start. Please try again and choose Entire screen.",
};

/** Ask for a screen share and accept only the entire screen. Returns the stream or an error message. */
export async function shareEntireScreen(): Promise<{ stream: MediaStream } | { error: string }> {
  let s: MediaStream;
  try {
    s = await requestScreen();
  } catch (e) {
    const p = mediaProblem(e);
    return { error: p === "denied" ? "Screen sharing was cancelled or blocked. You need to share your entire screen to take this test."
                                   : p === "unsupported" ? "This browser can't share the screen. Use Chrome or Edge on a computer." : SURFACE_MESSAGE.none };
  }
  const surface = displaySurface(s);
  if (surface !== "monitor") {
    stopStream(s);
    return { error: SURFACE_MESSAGE[surface] ?? SURFACE_MESSAGE.none };
  }
  return { stream: s };
}

export async function enterFullscreen(): Promise<boolean> {
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen?.();
    return !!document.fullscreenElement;
  } catch {
    return false;
  }
}

export function ScreenShareStep({ onStart, starting, error: outerError }: {
  /** Called from the Start click (a user gesture) with the verified entire-screen stream. */
  onStart: (screen: MediaStream, displays: number) => void;
  starting?: boolean;
  error?: string | null;
}) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const share = async () => {
    setBusy(true);
    setError(null);
    const r = await shareEntireScreen();
    setBusy(false);
    if ("error" in r) { setError(r.error); return; }
    if (displayCount() > 1) {
      stopStream(r.stream);
      setError("More than one display is connected. Disconnect extra monitors and try again.");
      return;
    }
    setStream(r.stream);
  };

  const start = async () => {
    if (!stream) return;
    await enterFullscreen();
    onStart(stream, displayCount());
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <Monitor className="h-6 w-6 text-primary shrink-0" aria-hidden />
        <div>
          <p className="font-medium">Share your entire screen</p>
          <p className="text-sm text-muted-foreground">
            In the dialog, choose <strong>Entire screen</strong> (not a window or tab). The test then opens in full screen.
            Keep sharing until you finish.
          </p>
        </div>
      </div>
      {(error || outerError) && <p role="alert" className="text-sm text-destructive">{error ?? outerError}</p>}
      {!stream ? (
        <Button type="button" onClick={share} disabled={busy}>{busy ? "Waiting for screen share…" : "Share entire screen"}</Button>
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-emerald-700" data-testid="share-ok">Entire screen shared.</p>
          <Button type="button" onClick={start} disabled={starting}>{starting ? "Starting…" : "Enter full screen and start"}</Button>
        </div>
      )}
    </div>
  );
}
