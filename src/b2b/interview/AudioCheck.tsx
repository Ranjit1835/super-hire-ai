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
  const soundState = soundOk === true ? "Heard it" : soundOk === false ? "Didn't hear it" : "Not tested yet";

  const playTest = async () => {
    const o = await speakText("This is a sound check. If you can hear me, tap Yes.").done;
    // Played to the end: the candidate confirms with Yes / No. Refused or failed: it clearly didn't work.
    setSoundOk(o === "done" ? null : false);
  };

  return (
    <section role="alertdialog" aria-labelledby="audio-check-title" className="border border-[var(--hr-red-ink)] bg-[var(--hr-surface)] p-5 space-y-4 max-w-md">
      <div>
        <p className="hr-label text-[var(--hr-red-ink)]">Audio check needed</p>
        <h2 id="audio-check-title" className="hr-display text-xl mt-1.5">{c.title}</h2>
        <p className="text-sm text-[var(--hr-muted)] mt-2">{c.body}</p>
        <p className="hr-data text-xs text-[var(--hr-muted)] mt-3">Your interview is paused where you left it. Nothing you said is lost.</p>
      </div>

      <div className="hr-rule-t pt-4 space-y-2">
        <div className="flex items-center justify-between">
          <p className="hr-label">Speaker check</p>
          <span className="hr-data text-xs text-[var(--hr-muted)]">{soundState}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void playTest()}><Volume2 className="h-4 w-4 mr-1" aria-hidden />Play a test sound</Button>
          <span className="text-sm text-[var(--hr-muted)]">Did you hear it?</span>
          <Button size="sm" variant={soundOk ? "default" : "outline"} onClick={() => setSoundOk(true)}>Yes</Button>
          <Button size="sm" variant="outline" onClick={() => setSoundOk(false)}>No</Button>
        </div>
        {soundOk === false && <p className="text-sm text-[var(--hr-red-ink)]">Turn the volume up, check the output device, or plug in headphones, then play it again.</p>}
      </div>

      <div className="hr-rule-t pt-4 space-y-2">
        <p className="hr-label">Microphone check</p>
        <Button variant="outline" size="sm" onClick={() => setMicOn(true)} disabled={micOn}><Mic className="h-4 w-4 mr-1" aria-hidden />Test my microphone</Button>
        {micOn && (
          <div>
            <div className="hr-strip" style={{ width: "100%" }} role="meter" aria-label="Microphone level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(level * 100)}>
              <i style={{ background: "var(--hr-blue)", transform: `scaleX(${level})` }} />
            </div>
            <p className="hr-data text-xs text-[var(--hr-muted)] mt-1.5">{heard ? "We can hear you." : "Say a few words…"}</p>
          </div>
        )}
      </div>

      <div className="hr-rule-t pt-4">
        <Button onClick={() => { onPassed(); onResume(); }} disabled={!ready}>Resume interview</Button>
        {!ready && <p className="hr-data text-xs text-[var(--hr-muted)] mt-2">Resume becomes available once you've heard the test sound and we can hear you.</p>}
      </div>
    </section>
  );
}
