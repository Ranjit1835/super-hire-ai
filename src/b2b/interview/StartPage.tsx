// /interview/v1/start?context=drive|job_role&id=<driveId|jobRoleId>[&attempt=<attemptId>]
// Creates or resumes the interview (startContext), then opens the room.
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Loading } from "../layout/V1Shell";
import { ApiError, interviewV1Api } from "./api";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function Centered({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen flex items-center justify-center p-6"><div className="max-w-md text-center">{children}</div></div>;
}

export default function StartPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const context = params.get("context") ?? "";
  const id = params.get("id") ?? "";
  const attempt = params.get("attempt") ?? "";
  const valid = (context === "drive" || context === "job_role") && UUID.test(id) && (!attempt || UUID.test(attempt));
  const [error, setError] = useState<{ message: string; signIn: boolean } | null>(null);
  const [tries, setTries] = useState(0);
  const started = useRef(-1);

  useEffect(() => {
    if (!valid || started.current === tries) return;
    started.current = tries;
    interviewV1Api("startContext", { kind: context as "drive" | "job_role", contextId: id, ...(attempt ? { attemptId: attempt } : {}) })
      .then((r) => navigate(`/interview/v1/i/${r.interviewId}`, { replace: true }))
      .catch((e: unknown) => setError({
        message: e instanceof Error ? e.message : "Couldn't start the interview.",
        signIn: e instanceof ApiError && e.status === 401,
      }));
  }, [valid, context, id, attempt, tries, navigate]);

  if (!valid) {
    return <Centered><p className="font-medium">This interview link isn't complete.</p><p className="text-sm text-muted-foreground mt-1">Please open it again from your dashboard or invitation.</p></Centered>;
  }
  if (error) {
    return (
      <Centered>
        <p className="font-medium">Couldn't start the interview</p>
        <p className="text-sm text-muted-foreground mt-1">{error.message}</p>
        {error.signIn ? <Link to="/auth" className="inline-block mt-4 underline">Sign in</Link>
          : <Button className="mt-4" onClick={() => { setError(null); setTries((n) => n + 1); }}>Try again</Button>}
      </Centered>
    );
  }
  return <Loading />;
}
