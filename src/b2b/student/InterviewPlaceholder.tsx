// A drive's interview step (/learn/v1/drives/:driveId/interview): hands over to the interview room's start URL
// (track C), adding the student's finished coding attempt so the interviewer can walk through it.
import { useEffect, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import { b2bDb } from "@/features/b2b/lib/db";
import { Loading } from "../layout/V1Shell";

export default function InterviewPlaceholder() {
  const { driveId = "" } = useParams();
  const [attempt, setAttempt] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    b2bDb.rpc("b2b_my_context_attempt", { _context: "drive", _context_id: driveId })
      .then(({ data, error }) => { if (alive) setAttempt(error ? null : (data as string | null) ?? null); },
            () => { if (alive) setAttempt(null); });
    return () => { alive = false; };
  }, [driveId]);

  if (attempt === undefined) return <Loading />;
  const q = new URLSearchParams({ context: "drive", id: driveId });
  if (attempt) q.set("attempt", attempt);
  return <Navigate to={`/interview/v1/start?${q.toString()}`} replace />;
}
