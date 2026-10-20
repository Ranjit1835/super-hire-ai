// A light, audio-reactive presence (no 3D): a circle that pulses while the interviewer speaks (browser TTS exposes
// no amplitude, so a CSS pulse) and follows the microphone level while the candidate answers. Respects
// prefers-reduced-motion. Cheap enough for a 4 GB laptop.
import { useEffect, useState } from "react";
import { startMicLevel } from "@/lib/speech";
import { cn } from "@/lib/utils";

export type PresenceMode = "idle" | "speaking" | "listening" | "thinking";

/** Microphone level 0–1 while `on`; 0 otherwise or when the mic can't be read (purely cosmetic). */
export function useMicLevel(on: boolean): number {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    if (!on) { setLevel(0); return; }
    let stop: (() => void) | null = null;
    let cancelled = false;
    startMicLevel((l) => { if (!cancelled) setLevel(l); })
      .then((h) => { if (cancelled) h.stop(); else stop = h.stop; })
      .catch(() => setLevel(0));
    return () => { cancelled = true; stop?.(); };
  }, [on]);
  return level;
}

export function Presence({ mode, level = 0 }: { mode: PresenceMode; level?: number }) {
  const scale = mode === "listening" ? 1 + Math.min(1, level) * 0.35 : 1;
  const label = { idle: "Interviewer waiting", speaking: "Interviewer speaking", listening: "Listening to you", thinking: "Interviewer thinking" }[mode];
  return (
    <div className="flex flex-col items-center gap-2" role="img" aria-label={label} data-testid="presence" data-mode={mode}>
      <div className="relative h-28 w-28">
        <div className={cn("absolute inset-0 rounded-full bg-primary/15 motion-safe:transition-transform motion-safe:duration-100",
          mode === "speaking" && "motion-safe:animate-pulse")} style={{ transform: `scale(${scale})` }} />
        <div className={cn("absolute inset-4 rounded-full bg-primary/80",
          mode === "thinking" && "motion-safe:animate-pulse opacity-70")} />
      </div>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
