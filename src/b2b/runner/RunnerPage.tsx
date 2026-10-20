// /assess/a/:attemptId — loads the attempt (claiming this tab's single session), wraps the runner in
// proctoring, and shows "Submitted" (with scores only where results are visible) once it ends.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useB2BTheme, Loading } from "../layout/V1Shell";
import { ApiError, assessApi } from "../lib/api";
import { ProctoredSession } from "../proctor";
import type { AttemptState } from "../../../supabase/functions/_shared/contracts/assess";
import type { ProctoringPolicyV1 } from "../types";
import { Runner } from "./Runner";
import { clearAttemptStorage, getSessionId, setSessionId } from "./session";

type Phase =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "conflict" }
  | { kind: "running"; state: AttemptState }
  | { kind: "ended"; state: AttemptState | null };

const POLICIES: ProctoringPolicyV1[] = ["off", "standard", "strict", "maximum"];
const asPolicy = (p: string): ProctoringPolicyV1 => (POLICIES.includes(p as ProctoringPolicyV1) ? p as ProctoringPolicyV1 : "standard");

export function Centered({ children }: { children: ReactNode }) {
  useB2BTheme();
  return <div className="min-h-screen bg-background text-foreground grid place-items-center p-6"><div className="max-w-md w-full text-center">{children}</div></div>;
}

export default function RunnerPage() {
  const { attemptId = "" } = useParams();
  useB2BTheme();
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const finishRef = useRef<((reason: "submitted" | "violations") => Promise<void>) | null>(null);

  const load = useCallback(async () => {
    setPhase({ kind: "loading" });
    try {
      const st = await assessApi("state", { attemptId, sessionId: getSessionId(attemptId) });
      setSessionId(attemptId, st.sessionId);
      if (st.status === "in_progress" || st.status === "not_started") setPhase({ kind: "running", state: st });
      else { clearAttemptStorage(attemptId); setPhase({ kind: "ended", state: st }); }
    } catch (e) {
      if (e instanceof ApiError && e.code === "OTHER_SESSION") setPhase({ kind: "conflict" });
      else setPhase({ kind: "error", message: e instanceof Error ? e.message : "Couldn't open this test." });
    }
  }, [attemptId]);

  useEffect(() => { void load(); }, [load]);

  if (phase.kind === "loading") return <Loading />;
  if (phase.kind === "error") {
    return <Centered><p className="font-medium">Couldn't open this test</p><p className="text-sm text-muted-foreground mt-1">{phase.message}</p>
      <Button className="mt-4" onClick={() => { void load(); }}>Try again</Button></Centered>;
  }
  if (phase.kind === "conflict") {
    return (
      <Centered>
        <p className="font-medium">This test is open in another tab or device</p>
        <p className="text-sm text-muted-foreground mt-1">You can take it in one place at a time. Close the other tab, or if you already closed it,
          wait about a minute and try again. This has been noted for the reviewer.</p>
        <Button className="mt-4" onClick={() => { void load(); }}>Try again</Button>
      </Centered>
    );
  }
  if (phase.kind === "ended") return <Submitted state={phase.state} />;

  const st = phase.state;
  return (
    <ProctoredSession attemptId={attemptId} policy={asPolicy(st.proctoring.policy)} kind="assessment"
      onAutoSubmit={() => { void finishRef.current?.("violations"); }}>
      <Runner state={st} finishRef={finishRef}
        onEnded={() => { void load(); }}
        onConflict={() => setPhase({ kind: "conflict" })} />
    </ProctoredSession>
  );
}

export function Submitted({ state }: { state: AttemptState | null }) {
  const r = state?.result;
  return (
    <Centered>
      <p className="text-2xl font-semibold">Submitted</p>
      <p className="text-sm text-muted-foreground mt-2">
        {state?.status === "expired" ? "Time ran out, so your saved answers were submitted automatically." : "Your answers have been submitted."}
      </p>
      {r ? (
        <div className="mt-6 rounded-lg border border-border p-4 text-left" aria-label="Your score">
          {r.grading === "pending" && <p className="text-xs text-muted-foreground mb-2">Some code is still being checked; the score may go up.</p>}
          <p className="text-lg font-semibold">Score: {r.score ?? 0} / {r.max_score ?? 0}</p>
          <ul className="mt-2 text-sm space-y-1">
            {r.section_scores.map((s, i) => <li key={i} className="flex justify-between"><span>{s.title || `Section ${i + 1}`}</span><span className="tabular-nums">{s.score} / {s.max_score}</span></li>)}
          </ul>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground mt-4">Results will be shared by the organiser.</p>
      )}
      <Link to="/" className="inline-block mt-6 text-sm underline">Done</Link>
    </Centered>
  );
}
