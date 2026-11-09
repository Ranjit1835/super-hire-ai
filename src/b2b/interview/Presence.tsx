// A still broadcast presence tag (no 3D, no perpetual motion): one hard-edged panel that reports the interviewer's
// real state in words and a level bar driven by the actual microphone input while answering. State changes snap in
// at most 160ms; nothing loops on its own, so it never fights for attention during a running interview.
import { useEffect, useState } from "react";
import { startMicLevel } from "@/lib/speech";

export type PresenceMode = "idle" | "speaking" | "listening" | "thinking";

/** Microphone level 0-1 while `on`; 0 otherwise or when the mic can't be read (purely cosmetic). */
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

const LABEL: Record<PresenceMode, string> = {
  idle: "Interviewer waiting", speaking: "Interviewer speaking", listening: "Listening to you", thinking: "Interviewer thinking",
};
const WORD: Record<PresenceMode, string> = { idle: "Waiting", speaking: "Speaking", listening: "Listening", thinking: "Thinking" };

export function Presence({ mode, level = 0 }: { mode: PresenceMode; level?: number }) {
  const pct = Math.round(Math.max(0, Math.min(1, level)) * 100);
  return (
    <div className="flex flex-col items-center gap-2.5" role="img" aria-label={LABEL[mode]} data-testid="presence" data-mode={mode}>
      <div className="relative h-24 w-24 bg-[var(--hr-surface)] shadow-[inset_0_0_0_1px_var(--hr-rule)] flex items-end justify-center overflow-hidden">
        <span
          className="block w-full bg-[var(--hr-blue)] transition-[height,opacity] duration-150 ease-out"
          style={{
            height: mode === "speaking" ? "100%" : mode === "thinking" ? "45%" : mode === "listening" ? `${Math.max(6, pct)}%` : "4%",
            opacity: mode === "idle" ? 0.35 : 1,
          }}
        />
      </div>
      <p className="hr-label text-[var(--hr-blue-ink)]">{WORD[mode]}</p>
    </div>
  );
}
