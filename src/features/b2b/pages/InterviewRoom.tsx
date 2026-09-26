import { useEffect, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Loader2, Mic, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { B2BShell, CenteredSpinner, EmptyState } from "../components/B2BShell";
import { ModuleMeta } from "../components/ModuleMeta";
import { ReportPanel } from "../components/ReportPanel";
import { LiveInterviewPanel } from "../components/LiveInterviewPanel";
import { PreflightTips } from "../components/PreflightTips";
import { AudioCheck } from "@/components/interview/AudioCheck";
import { useMyMemberships, useMyQuota, useStudentModules } from "../hooks/useB2B";
import { useInterviewSession } from "../hooks/useInterviewSession";
import { interviewApi, type InterviewPayload } from "../lib/api";
import { COMPANY_PACK_DISCLAIMER } from "../lib/shared";

type PagePhase = "loading" | "preflight" | "blocked";

/** /learn/interview/:moduleId */
export default function InterviewRoom() {
  const { moduleId = "" } = useParams();
  const qc = useQueryClient();
  const memberships = useMyMemberships();
  const student = memberships.data?.find((m) => m.role === "student");
  const modules = useStudentModules(student?.org_id);
  const quota = useMyQuota();
  const s = useInterviewSession({ onFinished: () => qc.invalidateQueries({ queryKey: ["b2b"] }) });

  const [pagePhase, setPagePhase] = useState<PagePhase>("loading");
  const [existing, setExisting] = useState<InterviewPayload | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);

  const mod = modules.data?.find((m) => m.id === moduleId);
  const q = quota.data?.find((x) => x.org_id === student?.org_id);

  // Is there already a live interview?
  useEffect(() => {
    let cancelled = false;
    interviewApi.current()
      .then((r) => {
        if (cancelled) return;
        if (r.interview && r.interview.module_id !== moduleId) { setExisting(r); setPagePhase("blocked"); }
        else { setExisting(r.interview ? r : null); setPagePhase("preflight"); }
      })
      .catch((e) => { if (!cancelled) { setPageError((e as Error).message); setPagePhase("preflight"); } });
    return () => { cancelled = true; };
  }, [moduleId]);

  const begin = async (resume: boolean) => {
    setPageError(null);
    try {
      await s.begin(() => (resume && existing?.interview ? interviewApi.resume(existing.interview.id) : interviewApi.start(moduleId, s.clientMeta())));
    } catch (e) {
      setPageError((e as Error).message);
    }
  };

  if (memberships.isLoading || modules.isLoading) return <CenteredSpinner />;
  if (!student) return <Navigate to="/dashboard" replace />;
  const org = student.organizations;
  const shell = (children: React.ReactNode) => (
    <B2BShell title={org.name} subtitle={mod?.name ?? "Interview"} logoUrl={org.logo_url} isDemo={org.is_demo}>
      <div className="max-w-2xl mx-auto">{children}</div>
    </B2BShell>
  );

  if (!mod && s.phase !== "finished") {
    return shell(<EmptyState title="This module isn't available" body="It may have been archived by your institution."><Button asChild><Link to="/learn">Back to modules</Link></Button></EmptyState>);
  }

  if (s.phase === "live") {
    return shell(
      <LiveInterviewPanel s={s} endCopy={{
        noAnswers: "You haven't answered anything yet, so your interview credit will be returned.",
        withAnswers: "Your report will be based on the answers so far. This uses one of your interviews.",
      }} />,
    );
  }

  if (s.phase === "finished" && s.data?.interview) {
    const iv = s.data.interview;
    const cancelled = iv.status === "cancelled";
    return shell(
      <div className="space-y-6">
        <div className="text-center pt-8 space-y-2">
          <CheckCircle2 className={`h-12 w-12 mx-auto ${cancelled ? "text-muted-foreground" : "text-emerald-400"}`} />
          <h2 className="text-xl font-semibold">{cancelled ? "Interview cancelled" : "Interview complete"}</h2>
          <p className="text-sm text-muted-foreground">
            {cancelled
              ? "No answers were recorded, so your interview credit was returned."
              : `You answered ${iv.turn_count} question${iv.turn_count === 1 ? "" : "s"} across ${iv.topics_covered} of ${iv.topics_total} topics.`}
          </p>
        </div>
        {!cancelled && iv.turn_count > 0 && (
          <ReportPanel interviewId={iv.id} passMark={mod?.spec.pass_threshold ?? 6} moduleName={iv.module_name} />
        )}
        <div className="text-center"><Button asChild><Link to="/learn">Back to practice</Link></Button></div>
      </div>,
    );
  }

  if (pagePhase === "loading" || s.phase === "starting") {
    return shell(
      <div className="text-center py-24" role="status">
        <Loader2 className="h-8 w-8 animate-spin text-violet-400 mx-auto mb-3" />
        <p className="text-sm text-muted-foreground">{s.phase === "starting" ? "Your interviewer is getting ready…" : "Loading…"}</p>
      </div>,
    );
  }

  if (pagePhase === "blocked") {
    return shell(
      <EmptyState title="You have another interview in progress" body={`Finish or end "${existing?.interview?.module_name}" before starting a new one.`}>
        <Button asChild><Link to={`/learn/interview/${existing?.interview?.module_id}`}>Go to that interview</Link></Button>
      </EmptyState>,
    );
  }

  // Pre-flight
  const resumable = existing?.interview?.module_id === moduleId ? existing.interview : null;
  const noneLeft = !resumable && q && q.interviews_remaining <= 0;
  return shell(
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold">{mod!.name}</h2>
        {mod!.spec.description && <p className="text-sm text-muted-foreground mt-1">{mod!.spec.description}</p>}
        <div className="mt-2"><ModuleMeta m={mod!} /></div>
        {mod!.type === "company_pack" && <p className="text-xs text-muted-foreground mt-2">{COMPANY_PACK_DISCLAIMER}</p>}
      </div>

      <PreflightTips />
      <AudioCheck needMic={!s.textMode} />

      {!s.support.stt && (
        <p className="text-sm text-amber-200 flex gap-2"><AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          This browser can't do speech recognition. Use Google Chrome or Microsoft Edge for a voice interview, or type your answers below.</p>
      )}
      <div className="flex items-center gap-2">
        <Switch id="text-mode" checked={s.textMode} onCheckedChange={s.setTextMode} disabled={!s.support.stt} />
        <Label htmlFor="text-mode" className="text-sm font-normal">Type my answers instead of speaking</Label>
      </div>

      {pageError && <p className="text-sm text-red-300" role="alert">{pageError}</p>}

      {resumable ? (
        <Button size="lg" className="w-full" onClick={() => begin(true)}>
          <RotateCcw className="h-4 w-4 mr-2" /> Resume interview (question {resumable.turn_count + 1} of {resumable.max_turns})
        </Button>
      ) : (
        <>
          <Button size="lg" className="w-full" onClick={() => begin(false)} disabled={!!noneLeft}>
            <Mic className="h-4 w-4 mr-2" /> Start interview
          </Button>
          <p className="text-xs text-muted-foreground text-center">
            {noneLeft ? "You've used all your interviews." : q ? `Uses 1 of your ${q.interviews_remaining} remaining interviews.` : null}
          </p>
        </>
      )}
    </div>,
  );
}
