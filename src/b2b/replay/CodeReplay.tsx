// R2.7 code playback for reviewers: watch a coding answer being written, scrub to any moment, jump to the moments
// flagged as unusual (code appearing at once, typing faster than people type). Flags are prompts to look, not a
// verdict; the reviewer decides.
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { b2bDb } from "@/features/b2b/lib/db";
import { cn } from "@/lib/utils";
import { Chip, type Tone } from "../ui/broadcast";
import { Loading, Empty } from "../layout/V1Shell";
import { buildReplay, clock, positionAt, type ReplayData, type ReplayFlag, type ReplayQuestion } from "./replay";

const LANGUAGE_LABEL: Record<string, string> = { python: "Python 3", java: "Java", cpp: "C++", c: "C", javascript: "JavaScript" };
const FLAG_LABEL: Record<ReplayFlag["kind"], string> = {
  large_insert: "Code appeared at once", fast_typing: "Faster than typing", little_typing: "Little was typed", paste_blocked: "Paste blocked",
};
const FLAG_TONE: Record<ReplayFlag["severity"], Tone> = { high: "red", medium: "plain", low: "muted" };
const SPEEDS = [1, 4, 16] as const;

export const driveReplayKey = (driveId: string, studentId: string) => ["b2b-v1", "replay", driveId, studentId];

export function useDriveReplay(driveId: string, studentId: string, enabled: boolean) {
  return useQuery({
    queryKey: driveReplayKey(driveId, studentId),
    enabled,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await b2bDb.rpc("b2b_drive_code_replay", { _drive_id: driveId, _student_id: studentId });
      if (error) throw error;
      return (data ?? null) as ReplayData | null;
    },
  });
}

export function DriveReplayDialog({ driveId, studentId, name, open, onOpenChange }: {
  driveId: string; studentId: string; name: string; open: boolean; onOpenChange: (open: boolean) => void;
}) {
  const q = useDriveReplay(driveId, studentId, open);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl w-[calc(100vw-2rem)] max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Code replay: {name}</DialogTitle>
          <DialogDescription>How each coding answer was written. Flags mark moments worth watching; they aren't a verdict.</DialogDescription>
        </DialogHeader>
        {q.isLoading ? <Loading /> : q.error ? (
          <Empty title="Couldn't load the replay" body="Try again in a moment." />
        ) : !q.data ? (
          <Empty title="No attempt yet" body="This student hasn't started the test in this drive." />
        ) : <CodeReplay data={q.data} />}
      </DialogContent>
    </Dialog>
  );
}

export function CodeReplay({ data }: { data: ReplayData }) {
  const [qi, setQi] = useState(0);
  if (!data.questions.length) return <Empty title="No coding questions" body="This paper had no coding questions to replay." />;
  const current = data.questions[Math.min(qi, data.questions.length - 1)];
  return (
    <div className="space-y-3">
      {data.questions.length > 1 && (
        <div role="tablist" aria-label="Questions" className="flex flex-wrap gap-1 hr-rule-b">
          {data.questions.map((q, i) => (
            <button key={q.question_id} type="button" role="tab" aria-selected={i === qi} onClick={() => setQi(i)}
                    className={cn("px-3 py-1.5 text-sm", i === qi ? "text-foreground shadow-[inset_0_-2px_0_var(--hr-orange)]" : "text-[var(--hr-muted)] hover:text-foreground")}>
              {i + 1}. {q.title}
            </button>
          ))}
        </div>
      )}
      <QuestionReplay key={current.question_id} question={current} />
    </div>
  );
}

function QuestionReplay({ question }: { question: ReplayQuestion }) {
  const replay = useMemo(() => buildReplay(question), [question]);
  const [pos, setPos] = useState(replay.length);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(4);
  const total = replay.playT[replay.length] ?? 0;

  // Playback: advance a clock by real elapsed time × speed, show the last event at or before it.
  const clockRef = useRef(0);
  useEffect(() => {
    if (!playing) return;
    clockRef.current = replay.playT[pos] ?? 0;
    let last = performance.now();
    const id = window.setInterval(() => {
      const now = performance.now();
      clockRef.current += (now - last) * speed;
      last = now;
      const next = positionAt(replay.playT, clockRef.current);
      setPos(next);
      if (next >= replay.length) setPlaying(false);
    }, 50);
    return () => window.clearInterval(id);
    // pos is read only when playback starts
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, speed, replay]);

  const view = useMemo(() => replay.at(pos), [replay, pos]);
  const elapsed = replay.t0 == null || pos === 0 ? 0 : (question.events[pos - 1]?.t ?? replay.t0) - replay.t0;

  if (replay.length === 0) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-[var(--hr-muted)]">No edits were recorded for this question.</p>
        {question.final_code && <CodeView code={question.final_code} />}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--hr-muted)]">
        <span>Writing time <span className="hr-data text-foreground">{clock(replay.stats.durationMs)}</span></span>
        <span>Typed <span className="hr-data text-foreground">{replay.stats.typedChars}</span> of <span className="hr-data text-foreground">{replay.stats.insertedChars}</span> characters added</span>
        <span>Deleted <span className="hr-data text-foreground">{replay.stats.deletedChars}</span></span>
        <span>{replay.length} edits</span>
      </div>

      {!replay.exact && (
        <p role="note" className="text-xs text-[var(--hr-muted)] shadow-[inset_2px_0_0_var(--hr-rule)] pl-2">
          {question.truncated
            ? "This log is very long and was cut short, so the replay stops before the final answer."
            : "The replay doesn't end exactly at the saved answer (for example after a reload in another language). Use it as a guide; the saved answer is what was graded."}
        </p>
      )}

      {replay.flags.length > 0 ? (
        <ul aria-label="Replay flags" className="space-y-1.5">
          {replay.flags.map((f, i) => (
            <li key={i} className="flex flex-wrap items-center gap-2 text-sm">
              <Chip tone={FLAG_TONE[f.severity]} solid={f.severity === "high"}>{FLAG_LABEL[f.kind]}</Chip>
              <span className="text-[var(--hr-muted)]">{f.detail}</span>
              {replay.t0 != null && <span className="hr-data text-xs text-[var(--hr-muted)]">at {clock(f.t - replay.t0)}</span>}
              <Button size="sm" variant="ghost" onClick={() => { setPlaying(false); setPos(Math.max(0, f.index)); }}>
                Watch from here
              </Button>
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-[var(--hr-muted)]">Nothing unusual in how this was written.</p>}

      <div className="space-y-1.5">
        <div className="relative h-2 bg-[var(--hr-rule)]" aria-hidden>
          <div className="absolute inset-y-0 left-0 bg-[var(--hr-muted)]" style={{ width: `${total ? (replay.playT[pos] / total) * 100 : 100}%` }} />
          {replay.flags.map((f, i) => (
            <span key={i} className="absolute -top-1 h-4 w-[3px]"
                  style={{ left: `${total ? (replay.playT[Math.min(replay.length, f.index + 1)] / total) * 100 : 0}%`,
                           background: f.severity === "high" ? "var(--hr-red)" : "var(--hr-muted)" }} />
          ))}
        </div>
        <input type="range" min={0} max={replay.length} value={pos} aria-label="Replay position" className="w-full"
               onChange={(e) => { setPlaying(false); setPos(Number(e.target.value)); }} />
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => { if (pos >= replay.length) setPos(0); setPlaying((p) => !p); }}>
            {playing ? "Pause" : pos >= replay.length ? "Replay from start" : "Play"}
          </Button>
          <div role="group" aria-label="Speed" className="flex">
            {SPEEDS.map((s) => (
              <button key={s} type="button" aria-pressed={speed === s} onClick={() => setSpeed(s)}
                      className={cn("px-2 py-1 text-xs hr-data shadow-[inset_0_0_0_1px_var(--hr-rule)]", speed === s && "bg-[var(--hr-surface)] text-foreground")}>
                {s}×
              </button>
            ))}
          </div>
          <span className="hr-data text-xs text-[var(--hr-muted)]" aria-live="off">
            {clock(elapsed)} · edit {pos} of {replay.length}
          </span>
          <Chip tone="muted">{LANGUAGE_LABEL[view.lang] ?? view.lang}</Chip>
        </div>
      </div>

      <CodeView code={view.code} />
    </div>
  );
}

function CodeView({ code }: { code: string }) {
  const lines = code.split("\n");
  return (
    <pre aria-label="Code at this point" className="hr-data text-xs leading-5 bg-[var(--hr-surface)] shadow-[inset_0_0_0_1px_var(--hr-rule)] p-3 overflow-auto max-h-[50vh]">
      {lines.map((l, i) => (
        <div key={i} className="flex">
          <span aria-hidden className="select-none w-8 shrink-0 text-right pr-3 text-[var(--hr-muted)]">{i + 1}</span>
          <span className="whitespace-pre">{l || " "}</span>
        </div>
      ))}
    </pre>
  );
}
