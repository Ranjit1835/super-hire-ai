// /assess/start?context=drive|job_role|practice&id=<driveId|jobRoleId|assessmentId>
// Creates or resumes the attempt, remembers this tab's session, then opens the runner.
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Loading } from "../layout/V1Shell";
import { ApiError, assessApi } from "../lib/api";
import { Centered } from "./RunnerPage";
import { getSessionId, setSessionId } from "./session";

const CONTEXTS = ["practice", "drive", "job_role"] as const;
type Context = (typeof CONTEXTS)[number];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ctxKey = (c: string, id: string) => `hr-assess-ctx-${c}-${id}`;

export default function StartPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const context = params.get("context") ?? "";
  const id = params.get("id") ?? "";
  const valid = (CONTEXTS as readonly string[]).includes(context) && UUID.test(id);
  const [error, setError] = useState<{ message: string; signIn: boolean } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const started = useRef(-1);

  useEffect(() => {
    if (!valid || started.current === attempt) return;
    started.current = attempt;
    let prior: string | undefined;
    try { prior = sessionStorage.getItem(ctxKey(context, id)) ?? undefined; } catch { /* storage blocked */ }
    const c = context as Context;
    assessApi("start", c === "practice"
      ? { context: c, contextId: null, assessmentId: id, sessionId: prior ? getSessionId(prior) : undefined }
      : { context: c, contextId: id, sessionId: prior ? getSessionId(prior) : undefined })
      .then((st) => {
        setSessionId(st.attemptId, st.sessionId);
        try { sessionStorage.setItem(ctxKey(context, id), st.attemptId); } catch { /* storage blocked */ }
        navigate(`/assess/a/${st.attemptId}?back=${encodeURIComponent(backPath(context as Context, id))}`, { replace: true });
      })
      .catch((e: unknown) => setError({
        message: e instanceof Error ? e.message : "Couldn't start the test.",
        signIn: e instanceof ApiError && e.status === 401,
      }));
  }, [valid, context, id, attempt, navigate]);

  if (!valid) return <Centered><p className="hr-display text-lg">This test link isn't complete.</p><p className="text-sm text-[var(--hr-muted)] mt-2">Please open it again from your dashboard or invitation.</p></Centered>;
  if (error) {
    return (
      <Centered>
        <p className="hr-display text-lg">Couldn't start the test</p>
        <p className="text-sm text-[var(--hr-muted)] mt-2">{error.message}</p>
        {error.signIn ? <Link to="/auth" className="inline-block mt-5 text-sm underline underline-offset-4">Sign in</Link>
          : <Button className="mt-5" onClick={() => { setError(null); setAttempt((n) => n + 1); }}>Try again</Button>}
      </Centered>
    );
  }
  return <Loading />;
}

/** Where "Done" goes after the test: the drive's steps, the candidate's steps, or the practice zone. */
export function backPath(context: Context, id: string): string {
  if (context === "drive") return `/learn/v1/drives/${id}`;
  if (context === "job_role") return "/t";
  return "/learn/v1";
}
