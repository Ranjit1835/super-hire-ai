import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Mic, Volume2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  isSttSupported, isTtsSupported, micHelp, micProblemFromError, primeSpeech, speakText, startMicLevel, NO_VOICES_HELP,
  type MicProblem,
} from "@/lib/speech";

type SpeakerState = "untested" | "playing" | "asked" | "ok" | "not-heard" | "blocked" | "unsupported" | "no-voices";
type MicState = "untested" | "listening" | "ok" | "problem";

export interface AudioCheckStatus { speakerOk: boolean; micOk: boolean }

const TEST_LINE = "Hi! This is how your interviewer will sound. If you can hear me, tap Yes.";

/**
 * "Test your mic & speaker" step shown before an interview. Everything happens inside taps,
 * which also unlocks speech for the interview on mobile browsers.
 */
export function AudioCheck({ onChange, needMic = true }: { onChange?: (s: AudioCheckStatus) => void; needMic?: boolean }) {
  const [speaker, setSpeaker] = useState<SpeakerState>(isTtsSupported() ? "untested" : "unsupported");
  const [mic, setMic] = useState<MicState>("untested");
  const [micProblem, setMicProblem] = useState<MicProblem | null>(isSttSupported() ? null : "unsupported");
  const [level, setLevel] = useState(0);
  const heard = useRef(false);
  const stopMic = useRef<(() => void) | null>(null);
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { onChange?.({ speakerOk: speaker === "ok", micOk: mic === "ok" }); }, [speaker, mic, onChange]);
  useEffect(() => () => { stopMic.current?.(); if (stopTimer.current) clearTimeout(stopTimer.current); }, []);

  const playTest = async () => {
    primeSpeech(); // inside the tap
    setSpeaker("playing");
    const outcome = await speakText(TEST_LINE).done;
    if (outcome === "blocked") setSpeaker("blocked");
    else if (outcome === "unsupported") setSpeaker("unsupported");
    else if (outcome === "no-voices") setSpeaker("no-voices");
    else setSpeaker("asked");
  };

  const testMic = async () => {
    stopMic.current?.();
    setMicProblem(isSttSupported() ? null : "unsupported");
    setMic("listening");
    heard.current = false;
    try {
      const { stop } = await startMicLevel((l) => {
        setLevel(l);
        if (l > 0.12 && !heard.current) { heard.current = true; setMic("ok"); }
      });
      stopMic.current = stop;
      stopTimer.current = setTimeout(() => { stop(); stopMic.current = null; setLevel(0); if (!heard.current) setMic("untested"); }, 10_000);
    } catch (e) {
      setMic("problem");
      setMicProblem(micProblemFromError(e));
    }
  };

  const help = micProblem ? micHelp(micProblem) : null;

  return (
    <div className="rounded-xl border border-violet-500/15 bg-white/[0.02] p-4 space-y-4 text-left" aria-label="Test your mic and speaker">
      <p className="text-sm font-semibold text-foreground">Test your mic and speaker</p>

      {/* Speaker */}
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <Volume2 className="h-4 w-4 text-violet-400 shrink-0" aria-hidden />
          <span className="text-sm flex-1">Speaker</span>
          {speaker === "ok" ? (
            <span className="text-xs text-emerald-400 inline-flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5" /> Working</span>
          ) : speaker !== "unsupported" && (
            <Button type="button" size="sm" variant="outline" onClick={playTest} disabled={speaker === "playing"}>
              {speaker === "playing" ? <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> Playing</> : speaker === "untested" ? "Play test voice" : "Play again"}
            </Button>
          )}
        </div>
        {speaker === "asked" && (
          <div className="flex items-center gap-2 pl-7">
            <span className="text-xs text-muted-foreground flex-1">Did you hear the test voice?</span>
            <Button type="button" size="sm" onClick={() => setSpeaker("ok")}>Yes</Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setSpeaker("not-heard")}>No</Button>
          </div>
        )}
        {speaker === "blocked" && (
          <p role="alert" className="pl-7 text-xs text-amber-300 flex gap-1.5"><AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            Your browser blocked the sound. Tap “Play again” — audio can only start after a tap.</p>
        )}
        {speaker === "not-heard" && (
          <p role="alert" className="pl-7 text-xs text-amber-300 flex gap-1.5"><AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            Turn up the volume, switch off Silent mode on iPhone, check the tab isn't muted, or try headphones — then tap “Play again”.</p>
        )}
        {speaker === "no-voices" && (
          <p role="alert" className="pl-7 text-xs text-amber-300">{NO_VOICES_HELP}</p>
        )}
        {speaker === "unsupported" && (
          <p role="status" className="pl-7 text-xs text-amber-300">This browser can't read questions aloud. Use Chrome, Edge or Safari — questions will still appear on screen.</p>
        )}
      </div>

      {/* Microphone */}
      {needMic && (
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <Mic className="h-4 w-4 text-violet-400 shrink-0" aria-hidden />
            <span className="text-sm flex-1">Microphone</span>
            {mic === "ok" ? (
              <span className="text-xs text-emerald-400 inline-flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5" /> We can hear you</span>
            ) : micProblem !== "unsupported" && (
              <Button type="button" size="sm" variant="outline" onClick={testMic} disabled={mic === "listening"}>
                {mic === "listening" ? "Say something…" : mic === "problem" ? "Try again" : "Test microphone"}
              </Button>
            )}
          </div>
          {(mic === "listening" || mic === "ok") && level > 0 && (
            <div className="pl-7" aria-hidden>
              <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                <div className="h-full bg-emerald-400 transition-[width] duration-75" style={{ width: `${Math.round(level * 100)}%` }} />
              </div>
            </div>
          )}
          {help && (
            <div role={mic === "problem" ? "alert" : "status"} className="pl-7 text-xs text-amber-300">
              <p className="font-medium flex gap-1.5"><AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" /> {help.title}</p>
              <p className="text-muted-foreground mt-0.5">{help.steps}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
