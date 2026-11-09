// /share/:token — expiring, view-only candidate report for outside hiring managers (no sign-in).
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Loading } from "../layout/V1Shell";
import { ApiError, candidateApi } from "../lib/api";
import { ReportView } from "../company/ReportView";
import { expiresText } from "../company/lib/pipeline";
import { CandidateFrame } from "./TokenFlowPage";

export default function SharePage() {
  const { token = "" } = useParams();
  return <CandidateFrame><ShareView token={token} /></CandidateFrame>;
}

export function ShareView({ token }: { token: string }) {
  const q = useQuery({ queryKey: ["b2b-share", token], queryFn: () => candidateApi("viewShare", { token }, { auth: false }), retry: false });
  if (q.isLoading) return <Loading />;
  if (q.error) return <p role="alert">{q.error instanceof ApiError ? q.error.message : "Couldn't open this link."}</p>;
  const d = q.data!;
  if (d.status !== "ok" || !d.report) {
    const text = { expired: "This link has expired. Ask the person who shared it for a new one.",
      revoked: "This link was turned off by the person who shared it.", invalid: "This link isn't valid.", ok: "This link isn't valid." }[d.status];
    return <div className="space-y-2"><h1 className="hr-display text-2xl">Report not available</h1><p role="alert">{text}</p></div>;
  }
  const r = d.report;
  return (
    <div className="space-y-6">
      <div className="hr-rule-b pb-5">
        <h1 className="hr-display text-2xl">{r.candidate.fullName}</h1>
        <p className="text-sm text-muted-foreground mt-1.5">{r.role.title} · {r.role.orgName} · view-only{d.expiresAt ? ` · ${expiresText(d.expiresAt)}` : ""}</p>
      </div>
      <ReportView report={r} staff={false} />
    </div>
  );
}
