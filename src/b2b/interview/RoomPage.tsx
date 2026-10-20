// /interview/v1/i/:interviewId — the V1 interview room (voice only, beta), wrapped in <ProctoredSession kind="interview">.
// Timestamped transcript of both sides, section progress, a light audio-reactive presence, audio re-check + resume
// on voice failure, and a small dev panel with turn-latency p50 / p95. Candidates never see scores unless the
// organisation has made results visible.
import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Loading, useB2BTheme } from "../layout/V1Shell";
import { ProctoredSession } from "../proctor";
import { LATENCY_TARGET_MS } from "../../../supabase/functions/_shared/interview-v1/stats";
import { interviewV1Api, type RoomState } from "./api";
import { Centered } from "./StartPage";
import { AudioCheck } from "./AudioCheck";
import { Presence, useMicLevel, type PresenceMode } from "./Presence";
import { useRoomSession, type RoomSession } from "./useRoomSession";

const BAND: Record<string, string> = { strong: "Strong", good: "Good", borderline: "Borderline", not_yet: "Not yet" };

function clock(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function showDevPanel() {
  try { return import.meta.env.DEV || new URLSearchParams(window.location.search).get("dev") === "1"; } catch { return false; }
}

export function Transcript({ lines }: { lines: RoomState["transcript"] }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView?.({ block: "nearest" }); }, [lines.length]);
  return (
    <ol className="space-y-3 max-h-[45vh] overflow-y-auto pr-1" aria-label="Transcript">
      {lines.map((l) => (
        <li key={`${l.turn}-${l.role}`} className={l.role === "candidate" ? "pl-6" : ""}>
          <p className="text-xs text-muted-foreground"><span className="tabular-nums">{l.at}</span> · {l.role === "candidate" ? "You" : "Interviewer"}</p>
          <p className="text-sm">{l.text}</p>
        </li>
      ))}
      <div ref={end} />
    </ol>
  );
}

function DevPanel({ s }: { s: RoomSession }) {
  const l = s.latency;
  return (
    <aside className="rounded-md border border-dashed border-border p-3 text-xs space-y-1" aria-label="Developer panel">
      <p className="font-medium">Dev: turn latency (speech end → interviewer audio)</p>
      <p data-testid="latency">turns {l.count} · p50 {l.p50 ?? "–"} ms · p95 {l.p95 ?? "–"} ms · over {LATENCY_TARGET_MS} ms: {l.overTarget}</p>
    </aside>
  );
}

function Finished({ room }: { room: RoomState }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">{room.status === "cancelled" ? "Interview cancelled" : "Interview complete"}</h2>
      <p className="text-sm text-muted-foreground">
        {room.status === "cancelled" ? "You ended before answering, so nothing was recorded. You can start again from the same link while it's open."
          : room.context === "job_role" ? "Thank you. Your responses have been recorded and the hiring team will be in touch."
          : room.resultsVisible ? "Thank you. Your results are below." : "Thank you. Your responses have been recorded. Your placement office will share results when they're released."}
      </p>
      {room.resultsVisible && room.result && (
        <div className="rounded-md border border-border p-3 space-y-2">
          <p className="text-sm">AI recommendation: <strong>{room.result.recommendation ? BAND[room.result.recommendation] : "Not enough evidence"}</strong></p>
          <ul className="text-sm grid sm:grid-cols-2 gap-1">
            {room.result.dimensions.map((d) => <li key={d.label}>{d.label}: {d.score ?? "–"} / 5</li>)}
          </ul>
          <p className="text-xs text-muted-foreground">AI recommendation; your placement team decides.</p>
        </div>
      )}
    </section>
  );
}

export function Room({ interviewId }: { interviewId: string }) {
  const s = useRoomSession(interviewId);
  const level = useMicLevel(s.phase === "listening");
  const room = s.room;
  if (s.phase === "loading" && !room) return <Loading />;
  if (s.phase === "error" || !room) return <Centered><p className="font-medium">Couldn't open the interview</p><p className="text-sm text-muted-foreground mt-1">{s.error}</p></Centered>;

  const mode: PresenceMode = s.phase === "asking" ? "speaking" : s.phase === "listening" ? "listening" : s.phase === "submitting" ? "thinking" : "idle";
  const done = s.phase === "finished";
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="container max-w-4xl px-4 h-14 flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="font-semibold truncate">{room.title}</h1>
            <p className="text-xs text-muted-foreground">AI interview · voice <Badge variant="secondary" className="ml-1">beta</Badge></p>
          </div>
          {!done && <span className="tabular-nums text-sm" aria-label="Time left">{clock(s.remainingMs)}</span>}
          {!done && s.phase !== "ready" && (
            <AlertDialog>
              <AlertDialogTrigger asChild><Button variant="outline" size="sm">End interview</Button></AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>End the interview now?</AlertDialogTitle>
                  <AlertDialogDescription>Your answers so far are kept and assessed. You can't continue afterwards.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep going</AlertDialogCancel>
                  <AlertDialogAction onClick={() => void s.end()}>End interview</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
        {!done && (
          <ol className="container max-w-4xl px-4 pb-2 flex gap-1 overflow-x-auto text-xs" aria-label="Sections">
            {room.sections.map((sec) => (
              <li key={sec.key} aria-current={sec.key === room.section ? "step" : undefined}
                  className={`rounded-full px-2 py-0.5 whitespace-nowrap ${sec.key === room.section ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground"}`}>
                {sec.label}
              </li>
            ))}
          </ol>
        )}
      </header>
      <main className="container max-w-4xl px-4 py-6 grid gap-6 md:grid-cols-[220px_1fr]">
        <div className="flex flex-col items-center gap-4">
          <Presence mode={mode} level={level} />
          {showDevPanel() && <DevPanel s={s} />}
        </div>
        <div className="space-y-4 min-w-0">
          {done ? <Finished room={room} /> : (
            <>
              {room.question && (
                <div className="rounded-lg border border-border bg-card p-4" aria-live="polite">
                  <p className="text-xs text-muted-foreground">Interviewer</p>
                  <p className="mt-1">{room.question}</p>
                </div>
              )}
              {s.phase === "ready" && (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">
                    {room.turnCount > 0 ? "Your interview is where you left it." : `About ${room.durationMin} minutes, answered by voice. Use headphones if you can, and speak after the question finishes.`}
                  </p>
                  <Button onClick={s.begin}>{room.turnCount > 0 ? "Resume interview" : "Start interview"}</Button>
                </div>
              )}
              {s.phase === "listening" && (
                <div className="space-y-2">
                  <p className="text-sm" role="status">Listening… {s.voice.transcript && <span className="text-muted-foreground">“{s.voice.transcript}”</span>}</p>
                  <Button variant="outline" size="sm" onClick={s.voice.finishAnswer}>Done answering</Button>
                </div>
              )}
              {s.phase === "submitting" && <p className="text-sm text-muted-foreground" role="status">Thinking…</p>}
              {s.phase === "empty" && (
                <div className="space-y-2">
                  <p className="text-sm">{s.error ?? "We didn't catch an answer."}</p>
                  <Button size="sm" onClick={s.answerAgain}>Answer again</Button>
                </div>
              )}
              {s.phase === "retry" && (
                <div role="alert" className="space-y-2">
                  <p className="text-sm text-destructive">{s.error}</p>
                  <Button size="sm" onClick={s.retry}>Try again</Button>
                </div>
              )}
              {s.phase === "audio_check" && s.issue && <AudioCheck issue={s.issue} onPassed={s.recheckPassed} onResume={() => void s.resume()} />}
            </>
          )}
          <section>
            <h2 className="text-sm font-medium mb-2">Transcript</h2>
            {room.transcript.length ? <Transcript lines={room.transcript} /> : <p className="text-sm text-muted-foreground">The conversation will appear here.</p>}
          </section>
        </div>
      </main>
    </div>
  );
}

/** Loads the proctoring policy, then the proctored room. */
export default function RoomPage() {
  useB2BTheme();
  const { interviewId = "" } = useParams();
  const [policy, setPolicy] = useState<RoomState["policy"] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);
  useEffect(() => {
    interviewV1Api("room", { interviewId })
      .then((r) => { setPolicy(r.policy); setFinished(r.status !== "in_progress"); })
      .catch((e: unknown) => setFailed(e instanceof Error ? e.message : "Couldn't open the interview."));
  }, [interviewId]);
  if (failed) return <Centered><p className="font-medium">Couldn't open the interview</p><p className="text-sm text-muted-foreground mt-1">{failed}</p></Centered>;
  if (!policy) return <Loading />;
  // A finished interview has nothing left to proctor.
  if (finished) return <Room interviewId={interviewId} />;
  return (
    <ProctoredSession interviewId={interviewId} policy={policy} kind="interview">
      <Room interviewId={interviewId} />
    </ProctoredSession>
  );
}
