import { useEffect, useRef, useState } from "react";
import { evaluateApi, type EvaluationRow } from "../lib/api";

export type EvalState =
  | { phase: "working" }
  | { phase: "ready"; evaluation: EvaluationRow }
  | { phase: "failed"; message: string }
  | { phase: "unavailable"; message: string };

const POLL_MS = 4000;
const GIVE_UP_MS = 3 * 60 * 1000;

/**
 * Ask the server to evaluate (it may already be running in the background from the last
 * answer), then poll until a report exists. Stops polling on unmount.
 */
export function useEvaluation(interviewId: string | null | undefined, enabled = true): EvalState {
  const [state, setState] = useState<EvalState>({ phase: "working" });
  const stopped = useRef(false);

  useEffect(() => {
    if (!interviewId || !enabled) return;
    stopped.current = false;
    const started = Date.now();
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      if (stopped.current) return;
      try {
        const r = await evaluateApi.get(interviewId);
        if (stopped.current) return;
        if (r.status === "completed" && r.evaluation) return setState({ phase: "ready", evaluation: r.evaluation });
        if (r.status === "failed") return setState({ phase: "failed", message: "We couldn't score this interview right now. It will be retried automatically." });
      } catch { /* transient; keep polling */ }
      if (Date.now() - started > GIVE_UP_MS) {
        return setState({ phase: "failed", message: "Your report is taking longer than usual. It will appear on your practice page when ready." });
      }
      timer = setTimeout(poll, POLL_MS);
    };

    (async () => {
      try {
        const r = await evaluateApi.evaluate(interviewId);
        if (stopped.current) return;
        if (r.status === "completed" && r.evaluation) return setState({ phase: "ready", evaluation: r.evaluation });
        if (r.status === "unavailable") {
          return setState({ phase: "unavailable", message: r.reason === "NO_ANSWERS" ? "No answers were recorded, so there is nothing to score." : "This interview can't be scored yet." });
        }
      } catch { /* the request may time out while scoring continues server-side: fall through to polling */ }
      timer = setTimeout(poll, POLL_MS);
    })();

    return () => {
      stopped.current = true;
      if (timer) clearTimeout(timer);
    };
  }, [interviewId, enabled]);

  return state;
}
