// /interview/v1/start?context=drive|job_role&id=<driveId|jobRoleId>[&attempt=<attemptId>]
// Creates or resumes the interview (startContext), then opens the room. The most dramatic surface of the interview
// area: nobody is mid-task yet, so this is the one screen in the area allowed a <Stage>. It never runs once the
// room is open (see RoomPage, which carries no 3D at all).
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useB2BTheme } from "../layout/V1Shell";
import { Stage } from "../three/Stage";
import { ApiError, interviewV1Api } from "./api";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function Centered({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-6"><div className="max-w-md w-full text-center">{children}</div></div>;
}

/** Same background and centring as `Centered`, but without its narrow centred-text column: the start state lays
 *  itself out as a left-aligned pre-match at md+ (see `StartIntro`). */
function StartLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-6">{children}</div>;
}

/**
 * The pre-interview moment: nobody is mid-task yet, so this is the one place in the area a <Stage> belongs.
 * Nothing starts until the person presses Start interview (owner decision 2026-10-24): the room, the microphone and
 * the clock begin on their click, not on page load.
 */
function StartIntro({ onStart, starting }: { onStart?: () => void; starting?: boolean }) {
  return (
    <div className="max-w-4xl w-full grid gap-8 items-center text-left md:grid-cols-[minmax(0,1fr)_280px]">
      <Stage className="h-40 md:h-[280px] order-first md:order-last" frozen={starting} />
      <div className="order-last md:order-first">
        <h1 className="hr-display text-2xl">Your voice interview</h1>
        <p className="text-sm text-[var(--hr-muted)] mt-3">
          You answer every question by voice. There is no typing. Keep the code you submitted in mind: the interviewer
          will ask you to explain it in your own words.
        </p>
        <ul className="text-sm text-left mt-5 hr-rule-t">
          <li className="py-2.5 hr-rule-b">Find a quiet place and use headphones if you can.</li>
          <li className="py-2.5 hr-rule-b">Your microphone is checked before the first question.</li>
          <li className="py-2.5 hr-rule-b">If the audio drops, you can fix it and resume where you left off.</li>
        </ul>
        {starting ? (
          <p role="status" className="hr-data text-xs text-[var(--hr-muted)] mt-6">Setting up the room…</p>
        ) : (
          <Button className="mt-6 w-full sm:w-auto" onClick={onStart}>Start interview</Button>
        )}
      </div>
    </div>
  );
}

/** Pure preview of the screen above, with no network call: for the gallery only. */
export function StartPreview() {
  useB2BTheme();
  return <StartLayout><StartIntro onStart={() => {}} /></StartLayout>;
}

export default function StartPage() {
  useB2BTheme();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const context = params.get("context") ?? "";
  const id = params.get("id") ?? "";
  const attempt = params.get("attempt") ?? "";
  const valid = (context === "drive" || context === "job_role") && UUID.test(id) && (!attempt || UUID.test(attempt));
  const [error, setError] = useState<{ message: string; signIn: boolean } | null>(null);
  // 0 until the person presses Start interview; each press (or Try again) bumps it and fires one startContext.
  const [tries, setTries] = useState(0);
  const started = useRef(0);

  useEffect(() => {
    if (!valid || tries === 0 || started.current === tries) return;
    started.current = tries;
    interviewV1Api("startContext", { kind: context as "drive" | "job_role", contextId: id, ...(attempt ? { attemptId: attempt } : {}) })
      .then((r) => navigate(`/interview/v1/i/${r.interviewId}`, { replace: true }))
      .catch((e: unknown) => setError({
        message: e instanceof Error ? e.message : "Couldn't start the interview.",
        signIn: e instanceof ApiError && e.status === 401,
      }));
  }, [valid, context, id, attempt, tries, navigate]);

  if (!valid) {
    return (
      <Centered>
        <p className="hr-display text-xl">This interview link isn't complete.</p>
        <p className="text-sm text-[var(--hr-muted)] mt-2">Please open it again from your dashboard or invitation.</p>
      </Centered>
    );
  }
  if (error) {
    return (
      <Centered>
        <p className="hr-display text-xl">Couldn't start the interview</p>
        <p className="text-sm text-[var(--hr-muted)] mt-2">{error.message}</p>
        {error.signIn ? <Link to="/auth" className="inline-block mt-4 text-sm text-[var(--hr-blue-ink)] underline">Sign in</Link>
          : <Button className="mt-4" onClick={() => { setError(null); setTries((n) => n + 1); }}>Try again</Button>}
      </Centered>
    );
  }
  return <StartLayout><StartIntro starting={tries > 0} onStart={() => setTries((n) => n + 1)} /></StartLayout>;
}
