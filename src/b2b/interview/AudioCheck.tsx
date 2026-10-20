// Audio re-check after a voice failure. The interview stays where it was on the server; once the speaker and the
// microphone work again, "Resume interview" re-asks the current question. There is no typed-answer mode.
import { useEffect, useState } from "react";
import { Mic, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { micHelp, NO_VOICES_HELP, speakText } from "@/lib/speech";
import { useMicLevel } from "./Presence";
import type { AudioIssue } from "./useRoomSession";

const COPY: Record<AudioIssue, { title: string; body: string }> = {
  tts_blocked: { title: "The browser blocked the interviewer's voice", body: "Tap “Play a test sound” to allow audio on this page." },
  tts_error: { title: "The interviewer's voice stopped working", body: "Check your speaker or headphones, then play a test sound." },
  no_voices: { title: "No speaking voice on this device", body: NO_VOICES_HELP },
  tts_unsupported: { title: "This browser can't speak the questions", body: "Use Google Chrome or Microsoft Edge on a laptop." },
  mic_denied: { title: micHelp("denied").title, body: micHelp("denied").steps },
  mic_missing: { title: micHelp("no-mic").title, body: micHelp("no-mic").steps },
  mic_busy: { title: micHelp("in-use").title, body: micHelp("in-use").steps },
  stt_unsupported: { title: "Voice answers aren't supported in this browser", body: "Use Google Chrome or Microsoft Edge on a laptop. This interview is voice only." },
  stt_error: { title: "We couldn't hear you", body: "Check your microphone, then try the level meter below." },
  no_speech: { title: "We didn't hear an answer", body: "Check your microphone, then try the level meter below." },
};

export function AudioCheck({ issue, onResume, onPassed }: { issue: AudioIssue; onResume: () => void; onPassed: () => void }) {
  const [soundOk, setSoundOk] = useState<boolean | null>(null);
  const [micOn, setMicOn] = useState(false);
  const [heard, setHeard] = useState(false);
  const level = useMicLevel(micOn);
  useEffect(() => { if (micOn && level > 0.08) setHeard(true); }, [micOn, level]);
  const ready = soundOk === true && heard;
  const c = COPY[issue];

  const playTest = async () => {
    const o = await speakText("This is a sound check. If you can hear me, tap Yes.").done;
    // Played to the end: the candidate confirms with Yes / No. Refused or failed: it clearly didn't work.
    setSoundOk(o === "done" ? null : false);
  };

  return (
    <section role="alertdialog" aria-labelledby="audio-check-title" className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-4 space-y-4">
      <div>
        <h2 id="audio-check-title" className="font-semibold">{c.title}</h2>
        <p className="text-sm mt-1">{c.body}</p>
        <p className="text-xs text-muted-foreground mt-2">Your interview is paused where you left it. Nothing you said is lost.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => void playTest()}><Volume2 className="h-4 w-4 mr-1" aria-hidden />Play a test sound</Button>
        <span className="text-sm">Did you hear it?</span>
        <Button size="sm" variant={soundOk ? "default" : "outline"} onClick={() => setSoundOk(true)}>Yes</Button>
        <Button size="sm" variant="outline" onClick={() => setSoundOk(false)}>No</Button>
      </div>
      {soundOk === false && <p className="text-sm">Turn the volume up, check the output device, or plug in headphones, then play it again.</p>}
      <div className="space-y-2">
        <Button variant="outline" size="sm" onClick={() => setMicOn(true)} disabled={micOn}><Mic className="h-4 w-4 mr-1" aria-hidden />Test my microphone</Button>
        {micOn && (
          <div>
            <div className="h-2 rounded bg-muted overflow-hidden" role="meter" aria-label="Microphone level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(level * 100)}>
              <div className="h-full bg-primary" style={{ width: `${Math.round(level * 100)}%` }} />
            </div>
            <p className="text-xs text-muted-foreground mt-1">{heard ? "We can hear you." : "Say a few words…"}</p>
          </div>
        )}
      </div>
      <Button onClick={() => { onPassed(); onResume(); }} disabled={!ready}>Resume interview</Button>
      {!ready && <p className="text-xs text-muted-foreground">Resume becomes available once you've heard the test sound and we can hear you.</p>}
    </section>
  );
}

