import { useState } from "react";
import { CheckCircle2, Keyboard, Loader2, Mic, PhoneOff, RotateCcw, Volume2, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { InterviewSession } from "../hooks/useInterviewSession";

function mmss(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** The live question / answer screen. `endCopy` explains what ending early means in this context. */
export function LiveInterviewPanel({ s, endCopy }: { s: InterviewSession; endCopy: { noAnswers: string; withAnswers: string } }) {
  const [confirmEnd, setConfirmEnd] = useState(false);
  const { live, voice, textMode, error, data } = s;
  const iv = data!.interview!;
  const progress = Math.min(100, Math.round((iv.turn_count / iv.max_turns) * 100));

  return (
    <div className="space-y-5">
      <div>
        <div className="flex justify-between text-xs text-muted-foreground mb-1">
          <span>Question {Math.min(iv.turn_count + 1, iv.max_turns)} of up to {iv.max_turns}{iv.current_topic ? ` · ${iv.current_topic}` : ""}</span>
          <span className={s.remainingMs < 60_000 ? "text-amber-300 tabular-nums" : "tabular-nums"} aria-label="Time left">{mmss(s.remainingMs)}</span>
        </div>
        <Progress value={progress} className="h-1.5" aria-label={`${progress}% of questions done`} />
      </div>

      <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-5" aria-live="polite">
        <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1.5">
          <Volume2 className={`h-3.5 w-3.5 ${voice.phase === "speaking" ? "text-violet-300 animate-pulse" : ""}`} /> Interviewer
        </p>
        <p className="text-base leading-relaxed">{data?.question}</p>
      </div>

      {!textMode && (live === "answering" || live === "asking") && (
        <div className="rounded-xl border border-border/60 p-4 min-h-24" aria-live="polite">
          <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1.5">
            <Mic className={`h-3.5 w-3.5 ${voice.phase === "listening" ? "text-emerald-400 animate-pulse" : ""}`} />
            {voice.phase === "listening" ? "Listening…" : voice.phase === "speaking" ? "Listen to the question" : "Your answer"}
          </p>
          <p className="text-sm text-muted-foreground italic">{voice.phase === "listening" ? voice.transcript || "Start speaking when you're ready." : ""}</p>
        </div>
      )}

      {textMode && live === "answering" && (
        <div className="space-y-2">
          <Label htmlFor="typed-answer" className="flex items-center gap-1.5"><Keyboard className="h-4 w-4" /> Your answer</Label>
          <Textarea id="typed-answer" rows={5} value={s.typed} onChange={(e) => s.setTyped(e.target.value)} maxLength={4000} autoFocus />
          <Button onClick={s.submitTyped} disabled={!s.typed.trim()}>Submit answer</Button>
        </div>
      )}

      {live === "submitting" && (
        <p className="text-sm text-muted-foreground flex items-center gap-2" role="status"><Loader2 className="h-4 w-4 animate-spin" /> Thinking about your answer…</p>
      )}

      {live === "retry" && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 space-y-2" role="alert">
          <p className="text-sm flex gap-2"><WifiOff className="h-4 w-4 mt-0.5 shrink-0" /> {error ?? "Couldn't send your answer."}</p>
          <Button size="sm" onClick={s.retry}><RotateCcw className="h-4 w-4 mr-1" /> Try again</Button>
        </div>
      )}

      {live === "empty" && (
        <div className="rounded-lg border border-border/60 p-4 space-y-2">
          <p className="text-sm">{error ?? "I didn't catch an answer."}</p>
          <div className="flex gap-2">
            {!textMode && <Button size="sm" onClick={s.answerAgain}><Mic className="h-4 w-4 mr-1" /> Answer again</Button>}
            {s.audioBlocked && !textMode && (
              <p role="alert" className="w-full text-sm text-amber-200 flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2">
                <Volume2 className="h-4 w-4 shrink-0" /> Your browser blocked the interviewer's voice.
                <Button size="sm" className="ml-auto" onClick={s.repeatQuestion}>Tap to hear the question</Button>
              </p>
            )}
            {!textMode && <Button size="sm" variant="ghost" onClick={s.repeatQuestion}><Volume2 className="h-4 w-4 mr-1" /> Repeat question</Button>}
            <Button size="sm" variant="ghost" onClick={s.typeInstead}><Keyboard className="h-4 w-4 mr-1" /> Type instead</Button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-2">
        {!textMode && live === "answering" && voice.phase === "listening" && (
          <Button onClick={voice.finishAnswer}><CheckCircle2 className="h-4 w-4 mr-1" /> Done answering</Button>
        )}
        <Button variant="ghost" className="text-red-300 ml-auto" onClick={() => setConfirmEnd(true)} disabled={live === "submitting"}>
          <PhoneOff className="h-4 w-4 mr-1" /> End interview
        </Button>
      </div>

      <AlertDialog open={confirmEnd} onOpenChange={setConfirmEnd}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>End the interview now?</AlertDialogTitle>
            <AlertDialogDescription>{iv.turn_count === 0 ? endCopy.noAnswers : endCopy.withAnswers}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep going</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setConfirmEnd(false); s.end(); }}>End interview</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
