// /interview/v1/i/:interviewId — the V1 interview room (voice only, beta), wrapped in <ProctoredSession kind="interview">.
// Calm and still: no 3D, no decorative motion. A simple interviewer-state tag, the current question legible, time in
// mono, the audio re-check and Resume flow, end interview clearly. Candidates never see scores unless the
// organisation has made results visible.
import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { Loading, useB2BTheme } from "../layout/V1Shell";
import { ProctoredSession } from "../proctor";
import { LATENCY_TARGET_MS } from "../../../supabase/functions/_shared/interview-v1/stats";
import { interviewV1Api, type RoomState } from "./api";
import { Centered } from "./StartPage";
import { AudioCheck } from "./AudioCheck";
import { Presence, useMicLevel, type PresenceMode } from "./Presence";
import { useRoomSession, type AudioIssue, type RoomPhase } from "./useRoomSession";
import type { LatencyStats } from "../../../supabase/functions/_shared/interview-v1/stats";

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
    <ol className="space-y-0 max-h-[45vh] overflow-y-auto pr-1" aria-label="Transcript">
      {lines.map((l) => (
        <li key={`${l.turn}-${l.role}`} className={cn("hr-rule-b py-2.5", l.role === "candidate" && "pl-6")}>
          <p className="hr-data text-xs text-[var(--hr-muted)]">
            <span className="tabular-nums">{l.at}</span> · <span className={l.role === "candidate" ? "" : "text-[var(--hr-blue-ink)]"}>{l.role === "candidate" ? "You" : "Interviewer"}</span>
          </p>
          <p className="text-sm mt-1">{l.text}</p>
        </li>
      ))}
      <div ref={end} />
    </ol>
  );
}

function DevPanel({ l }: { l: LatencyStats }) {
  return (
    <aside className="border border-dashed border-[var(--hr-rule)] p-3 text-xs space-y-1 text-[var(--hr-muted)]" aria-label="Developer panel">
      <p className="hr-label !text-[10px]">Dev: turn latency (speech end → interviewer audio)</p>
      <p data-testid="latency" className="hr-data">turns {l.count} · p50 {l.p50 ?? "–"} ms · p95 {l.p95 ?? "–"} ms · over {LATENCY_TARGET_MS} ms: {l.overTarget}</p>
    </aside>
  );
}

function Finished({ room }: { room: RoomState }) {
  return (
    <section className="space-y-4">
      <h2 className="hr-display text-2xl">{room.status === "cancelled" ? "Interview cancelled" : "Interview complete"}</h2>
      <p className="text-sm text-[var(--hr-muted)]">
        {room.status === "cancelled" ? "You ended before answering, so nothing was recorded. You can start again from the same link while it's open."
          : room.context === "job_role" ? "Thank you. Your responses have been recorded and the hiring team will be in touch."
          : room.resultsVisible ? "Thank you. Your results are below." : "Thank you. Your responses have been recorded. Your placement office will share results when they're released."}
      </p>
      {room.resultsVisible && room.result && (
        <div className="border border-[var(--hr-rule)] bg-[var(--hr-surface)] p-4 space-y-3">
          <p className="hr-label">AI recommendation</p>
          <p className="hr-display text-2xl text-[var(--hr-gold)]">{room.result.recommendation ? BAND[room.result.recommendation] : "Not enough evidence"}</p>
          <ul className="text-sm grid sm:grid-cols-2 gap-x-4 gap-y-1.5 hr-rule-t pt-3">
            {room.result.dimensions.map((d) => (
              <li key={d.label} className="hr-data">{d.label}: {d.score ?? "–"} / 5</li>
            ))}
          </ul>
          <p className="text-xs text-[var(--hr-muted)]">AI recommendation; your placement team decides.</p>
        </div>
      )}
    </section>
  );
}

/**
 * The room, as pure presentation: every value it needs comes in as a prop, nothing is fetched here. `Room` below
 * is the live wrapper (wires it to useRoomSession); the gallery renders this directly with fixture state.
 */
export function RoomView({ room, phase, error, issue, voiceTranscript, level, remainingMs, latency, begin, resume,
  end, answerAgain, retry, recheckPassed, finishAnswer }: {
  room: RoomState; phase: RoomPhase; error: string | null; issue: AudioIssue | null; voiceTranscript: string;
  level: number; remainingMs: number; latency: LatencyStats;
  begin: () => void; resume: () => void; end: () => void; answerAgain: () => void; retry: () => void;
  recheckPassed: () => void; finishAnswer: () => void;
}) {
  const mode: PresenceMode = phase === "asking" ? "speaking" : phase === "listening" ? "listening" : phase === "submitting" ? "thinking" : "idle";
  const done = phase === "finished";
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="hr-rule-b">
        <div className="mx-auto max-w-4xl px-4 h-16 flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="hr-display text-lg truncate">{room.title}</h1>
            <p className="hr-label !text-[10px] mt-0.5">AI interview · voice</p>
          </div>
          {!done && <span className="hr-numeral text-2xl" aria-label="Time left">{clock(remainingMs)}</span>}
          {!done && phase !== "ready" && (
            <AlertDialog>
              <AlertDialogTrigger asChild><Button variant="outline" size="sm">End interview</Button></AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>End the interview now?</AlertDialogTitle>
                  <AlertDialogDescription>Your answers so far are kept and assessed. You can't continue afterwards.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep going</AlertDialogCancel>
                  <AlertDialogAction onClick={end}>End interview</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
        {!done && (
          <ol className="mx-auto max-w-4xl px-4 pb-2.5 flex gap-1 overflow-x-auto" aria-label="Sections">
            {room.sections.map((sec) => (
              <li key={sec.key} aria-current={sec.key === room.section ? "step" : undefined}
                  className={cn("hr-label !text-[10px] px-2 py-1 whitespace-nowrap",
                    sec.key === room.section ? "bg-[var(--hr-blue)] !text-[#07090F]" : "shadow-[inset_0_0_0_1px_var(--hr-rule)] !text-[var(--hr-muted)]")}>
                {sec.label}
              </li>
            ))}
          </ol>
        )}
      </header>
      <main className={cn("mx-auto max-w-4xl px-4 py-6 grid gap-6 md:grid-cols-[200px_1fr]", phase === "listening" && "pb-24 sm:pb-6")}>
        <div className="flex flex-col items-center gap-4">
          <Presence mode={mode} level={level} />
          {showDevPanel() && <DevPanel l={latency} />}
        </div>
        <div className="space-y-4 min-w-0">
          {done ? <Finished room={room} /> : (
            <>
              {room.question && (
                <div className="border border-[var(--hr-rule)] bg-[var(--hr-surface)] p-4" aria-live="polite">
                  <p className="hr-label text-[var(--hr-blue-ink)]">Interviewer</p>
                  <p className="mt-1.5 text-lg leading-snug">{room.question}</p>
                </div>
              )}
              {phase === "ready" && (
                <div className="space-y-3">
                  <p className="text-sm text-[var(--hr-muted)]">
                    {room.turnCount > 0 ? "Your interview is where you left it." : `About ${room.durationMin} minutes, answered by voice. Use headphones if you can, and speak after the question finishes.`}
                  </p>
                  {room.voice && room.voice.stt !== "browser" && (
                    <p className="text-xs text-[var(--hr-muted)]">
                      {room.voice.stt === "groq"
                        ? "Each spoken answer is sent to a speech-to-text service (Groq, in the United States) to be written down. HiResume keeps the text, not the recording."
                        : "Each spoken answer is sent to a speech-to-text service (Sarvam, in India) to be written down. HiResume keeps the text, not the recording."}
                    </p>
                  )}
                  <Button onClick={begin}>{room.turnCount > 0 ? "Resume interview" : "Start interview"}</Button>
                </div>
              )}
              {phase === "listening" && (
                <div className="space-y-2">
                  <p className="text-sm" role="status">Listening… {voiceTranscript && <span className="text-[var(--hr-muted)]">“{voiceTranscript}”</span>}</p>
                  <div className="fixed inset-x-0 bottom-0 z-30 bg-[var(--hr-ground)] shadow-[inset_0_1px_0_var(--hr-rule)] px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:static sm:inset-auto sm:z-auto sm:bg-transparent sm:shadow-none sm:p-0">
                    <Button variant="outline" onClick={finishAnswer} className="w-full h-11 sm:w-auto sm:h-8 sm:px-3 sm:text-xs">Done answering</Button>
                  </div>
                </div>
              )}
              {phase === "submitting" && <p className="text-sm text-[var(--hr-muted)]" role="status">Thinking…</p>}
              {phase === "empty" && (
                <div className="space-y-2">
                  <p className="text-sm">{error ?? "We didn't catch an answer."}</p>
                  <Button size="sm" onClick={answerAgain}>Answer again</Button>
                </div>
              )}
              {phase === "retry" && (
                <div role="alert" className="space-y-2">
                  <p className="text-sm text-[var(--hr-red-ink)]">{error}</p>
                  <Button size="sm" onClick={retry}>Try again</Button>
                </div>
              )}
              {phase === "audio_check" && issue && <AudioCheck issue={issue} onPassed={recheckPassed} onResume={resume} />}
            </>
          )}
          <section>
            <h2 className="hr-label mb-2">Transcript</h2>
            {room.transcript.length ? <Transcript lines={room.transcript} /> : <p className="text-sm text-[var(--hr-muted)]">The conversation will appear here.</p>}
          </section>
        </div>
      </main>
    </div>
  );
}

/** The live room: wires useRoomSession to RoomView. */
export function Room({ interviewId }: { interviewId: string }) {
  const s = useRoomSession(interviewId);
  const level = useMicLevel(s.phase === "listening");
  const room = s.room;
  if (s.phase === "loading" && !room) return <Loading />;
  if (s.phase === "error" || !room) return <Centered><p className="hr-display text-xl">Couldn't open the interview</p><p className="text-sm text-[var(--hr-muted)] mt-2">{s.error}</p></Centered>;
  return (
    <RoomView room={room} phase={s.phase} error={s.error} issue={s.issue} voiceTranscript={s.voice.transcript}
      level={level} remainingMs={s.remainingMs} latency={s.latency} begin={s.begin} resume={() => void s.resume()}
      end={() => void s.end()} answerAgain={s.answerAgain} retry={s.retry} recheckPassed={s.recheckPassed}
      finishAnswer={s.voice.finishAnswer} />
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
  if (failed) return <Centered><p className="hr-display text-xl">Couldn't open the interview</p><p className="text-sm text-[var(--hr-muted)] mt-2">{failed}</p></Centered>;
  if (!policy) return <Loading />;
  // A finished interview has nothing left to proctor.
  if (finished) return <Room interviewId={interviewId} />;
  return (
    <ProctoredSession interviewId={interviewId} policy={policy} kind="interview">
      <Room interviewId={interviewId} />
    </ProctoredSession>
  );
}
