// A drive's interview step (/learn/v1/drives/:driveId/interview): hands over to the interview room's start URL
// (track C), adding the student's finished coding attempt so the interviewer can walk through it.
import { useEffect, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import { b2bDb } from "@/features/b2b/lib/db";
import { Loading, useB2BTheme } from "../layout/V1Shell";
import { LogoMark } from "../ui/broadcast";

export default function InterviewPlaceholder() {
  useB2BTheme();
  const { driveId = "" } = useParams();
  const [attempt, setAttempt] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    b2bDb.rpc("b2b_my_context_attempt", { _context: "drive", _context_id: driveId })
      .then(({ data, error }) => { if (alive) setAttempt(error ? null : (data as string | null) ?? null); },
            () => { if (alive) setAttempt(null); });
    return () => { alive = false; };
  }, [driveId]);

  if (attempt === undefined) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center px-4">
        <div className="flex flex-col items-center gap-4 text-center">
          <LogoMark className="h-11 w-16" title="HiResume" />
          <p className="hr-display text-lg">Opening your interview</p>
          <Loading />
        </div>
      </div>
    );
  }
  const q = new URLSearchParams({ context: "drive", id: driveId });
  if (attempt) q.set("attempt", attempt);
  return <Navigate to={`/interview/v1/start?${q.toString()}`} replace />;
}
