// /t/:token — the candidate's steps (no password): resolve the link → anonymous session linked on first use →
// itemised consent → system check → coding test (track A) → AI interview (track C) → done. Candidates never see scores.
import { useEffect, useState, type ReactNode } from "react";
import { Navigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Circle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { ensureVisitorSession } from "@/features/b2b/lib/api";
import { useB2BTheme, Loading } from "../layout/V1Shell";
import { Wordmark } from "../ui/broadcast";
import { Stage } from "../three/Stage";
import { ApiError, candidateApi } from "../lib/api";
import type { CandidateState } from "../../../supabase/functions/_shared/contracts/company";
import { CANDIDATE_CONSENT_VERSION, consentText, type CandidatePurpose } from "../../../supabase/functions/_shared/company-logic";

const TOKEN_KEY = "hr-candidate-token";
const PURPOSE_TITLE: Record<CandidatePurpose, string> = {
  account: "Your details", assessment: "Scoring and sharing", interview_audio: "Microphone for the interview", recording: "Interview transcript",
  proctoring_screen: "Screen sharing", proctoring_camera: "Camera", proctoring_audio: "Microphone during the test",
};

export function CandidateFrame({ children }: { children: ReactNode }) {
  useB2BTheme();
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="hr-rule-b"><div className="container max-w-3xl flex items-center h-14 px-4">
        <Wordmark />
      </div></header>
      <main className="container max-w-3xl px-4 py-8">{children}</main>
    </div>
  );
}

/** /t without a token: continue the last invitation opened in this browser. */
export function ResumeLastToken() {
  let t: string | null = null;
  try { t = localStorage.getItem(TOKEN_KEY); } catch { /* storage blocked */ }
  return t ? <Navigate to={`/t/${t}`} replace /> : <CandidateFrame><p>Open the link from your invitation email to continue.</p></CandidateFrame>;
}

export default function TokenFlowPage() {
  const { token = "" } = useParams();
  return <CandidateFrame><TokenFlow token={token} /></CandidateFrame>;
}

export function TokenFlow({ token }: { token: string }) {
  const qc = useQueryClient();
  const info = useQuery({ queryKey: ["b2b-candidate", "resolve", token], queryFn: () => candidateApi("resolveInvite", { token }, { auth: false }), retry: false });
  const [state, setState] = useState<CandidateState | null>(null);
  const [startError, setStartError] = useState<string | null>(null);

  const valid = info.data?.status === "valid";
  useEffect(() => {
    if (!valid || state || startError) return;
    let cancelled = false;
    (async () => {
      try {
        await ensureVisitorSession();
        const s = await candidateApi("startCandidate", { token });
        try { localStorage.setItem(TOKEN_KEY, token); } catch { /* storage blocked */ }
        if (!cancelled) setState(s);
      } catch (e) {
        if (!cancelled) setStartError(e instanceof Error ? e.message : "Couldn't open your assessment.");
      }
    })();
    return () => { cancelled = true; };
  }, [valid, token, state, startError]);

  // Coming back from the test or interview tab: refresh the steps.
  useEffect(() => {
    if (!state) return;
    const onFocus = () => { void candidateApi("state", { token }).then(setState).catch(() => {}); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [state, token]);

  if (info.isLoading) return <Loading />;
  if (info.error) return <p role="alert">{info.error instanceof ApiError ? info.error.message : "Couldn't open this link. Check your connection and try again."}</p>;
  const d = info.data!;
  if (d.status !== "valid") {
    const text = {
      invalid: "This link isn't valid. Please use the latest link from your invitation email.",
      expired: "This invitation has expired. Please ask the recruiter for a new link.",
      revoked: "This invitation is no longer active.",
      closed: "This role is no longer accepting assessments.",
    }[d.status];
    return <div className="space-y-2"><h1 className="hr-display text-2xl">Link not available</h1><p role="alert">{text}</p></div>;
  }
  if (startError) return <div className="space-y-2"><h1 className="hr-display text-2xl">{d.role?.title}</h1><p role="alert">{startError}</p></div>;
  if (!state) return <Loading />;
  return <Steps info={d as Info} state={state} token={token} onState={(s) => { setState(s); void qc.invalidateQueries({ queryKey: ["b2b-candidate"] }); }} />;
}

type Info = { company?: { name: string } ; role?: { title: string }; candidate?: { fullName: string; emailMasked: string }; purposes?: CandidatePurpose[]; proctored?: boolean };

function StepItem({ status, title, children }: { status: "todo" | "in_progress" | "done" | "locked"; title: string; children?: ReactNode }) {
  return (
    <li className="flex gap-3 hr-rule-b pb-5" aria-label={`${title}: ${status === "done" ? "done" : status === "in_progress" ? "in progress" : "to do"}`}>
      {status === "done" ? <CheckCircle2 className="h-5 w-5 text-[var(--hr-gold)] shrink-0" />
        : status === "in_progress" ? <Loader2 className="h-5 w-5 text-[var(--hr-blue-ink)] shrink-0 animate-spin" />
        : <Circle className="h-5 w-5 text-[var(--hr-muted)] shrink-0" />}
      <div className="space-y-2 flex-1"><p className="hr-display text-base">{title}</p>{children}</div>
    </li>
  );
}

export function Steps({ info, state, token, onState }: { info: Info; state: CandidateState; token: string; onState: (s: CandidateState) => void }) {
  const company = info.company?.name ?? "The company";
  const purposes = info.purposes ?? [];
  const [agreed, setAgreed] = useState<CandidatePurpose[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const s = state.steps;
  const consented = s.consent === "done";
  const codingDone = s.coding === null || s.coding === "done";

  async function run(fn: () => Promise<CandidateState>) {
    setBusy(true); setError(null);
    try { onState(await fn()); } catch (e) { setError(e instanceof Error ? e.message : "Something went wrong."); } finally { setBusy(false); }
  }

  if (state.completed) {
    return (
      <div className="space-y-3">
        <CheckCircle2 className="h-9 w-9 text-[var(--hr-gold)]" aria-hidden />
        <h1 className="hr-display text-2xl">All done. Thank you, {info.candidate?.fullName}!</h1>
        <p>You've finished every step for {info.role?.title} at {company}. {company}'s team will review your work and get in touch.</p>
        <p className="text-sm text-muted-foreground">Results aren't shown to candidates. You can close this page.</p>
      </div>
    );
  }

  return (
    <div className={cn("grid gap-6 items-start", !consented && "lg:grid-cols-[minmax(0,1fr)_240px]")}>
      <div className="space-y-6 order-last lg:order-none min-w-0">
        <div>
          <h1 className="hr-display text-2xl">{info.role?.title} at {company}</h1>
          <p className="text-sm text-muted-foreground mt-1.5">Hi {info.candidate?.fullName} ({info.candidate?.emailMasked}). Use a laptop or desktop with Chrome or Edge, a webcam and a microphone. Your progress is saved; you can come back to this link in this browser.</p>
        </div>
        {error && <p role="alert" className="text-sm text-[var(--hr-red-ink)]">{error}</p>}
        <ol className="space-y-5">
          <StepItem status={s.consent} title="1. Your consent">
            {consented ? <p className="text-sm text-muted-foreground">Thanks, recorded.</p> : (
              <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void run(() => candidateApi("recordConsent", { token, purposes: agreed, version: CANDIDATE_CONSENT_VERSION })); }}>
                <p className="text-sm">Please read each item. You can stop at any time; ask {company} to delete your data.</p>
                {purposes.map((p) => (
                  <div key={p} className="flex items-start gap-2 text-sm shadow-[inset_0_0_0_1px_var(--hr-rule)] p-3">
                    <Checkbox id={`consent-${p}`} checked={agreed.includes(p)}
                      onCheckedChange={(v) => setAgreed(v === true ? [...agreed, p] : agreed.filter((x) => x !== p))} className="mt-0.5" />
                    <Label htmlFor={`consent-${p}`} className="text-sm font-normal leading-snug"><b>{PURPOSE_TITLE[p]}.</b> {consentText(p, company)}</Label>
                  </div>
                ))}
                <Button type="submit" disabled={busy || purposes.some((p) => !agreed.includes(p))}
                  aria-describedby={purposes.some((p) => !agreed.includes(p)) ? "consent-gate-hint" : undefined}>I agree and continue</Button>
                {purposes.some((p) => !agreed.includes(p)) && (
                  <p id="consent-gate-hint" className="text-xs text-muted-foreground">Tick each item above to continue.</p>
                )}
              </form>
            )}
          </StepItem>
          <StepItem status={consented ? s.system_check : "locked"} title="2. Check your system">
            <p className="text-sm text-muted-foreground">Camera, microphone, screen sharing and internet speed.</p>
            {consented && s.system_check !== "done" && (
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" asChild><a href="/proctor/check" target="_blank" rel="noreferrer">Open the system check</a></Button>
                <Button onClick={() => void run(() => candidateApi("markSystemCheck", { token }))} disabled={busy}>My system check passed</Button>
              </div>
            )}
          </StepItem>
          {s.coding !== null && (
            <StepItem status={s.coding} title="3. Coding test">
              {s.coding === "done" ? <p className="text-sm text-muted-foreground">Submitted.</p>
                : consented ? <Button asChild><a href={`/assess/start?context=job_role&id=${state.jobRoleId}`}>{s.coding === "in_progress" ? "Continue the test" : "Start the coding test"}</a></Button>
                : <p className="text-sm text-muted-foreground">Available after you give consent.</p>}
            </StepItem>
          )}
          {s.interview !== null && (
            <StepItem status={s.interview} title={`${s.coding !== null ? 4 : 3}. AI interview`}>
              {s.interview === "done" ? <p className="text-sm text-muted-foreground">Finished.</p>
                : consented && codingDone ? (
                  <Button asChild><a href={`/interview/v1/start?context=job_role&id=${state.jobRoleId}${state.attemptId ? `&attempt=${state.attemptId}` : ""}`}>
                    {s.interview === "in_progress" ? "Continue the interview" : "Start the AI interview"}</a></Button>
                ) : <p className="text-sm text-muted-foreground">{consented ? "Available after the coding test. The interviewer may ask you to explain your code." : "Available after you give consent."}</p>}
            </StepItem>
          )}
          <StepItem status={s.done} title="Done">
            <p className="text-sm text-muted-foreground">Finish every step above. Results aren't shown to candidates; {company}'s team decides.</p>
            <Button variant="ghost" size="sm" onClick={() => void run(() => candidateApi("state", { token }))} disabled={busy}>Refresh my progress</Button>
          </StepItem>
        </ol>
      </div>
      {!consented && (
        // Decision D3: the stage shows the candidate's own real sequence (never the logo); consent is always
        // the current step here since the Stage is only shown before it's given.
        <Stage
          steps={[
            { label: "Consent", state: "current" },
            { label: "System check", state: "todo" },
            ...(s.coding !== null ? [{ label: "Test", state: "todo" as const }] : []),
            ...(s.interview !== null ? [{ label: "Interview", state: "todo" as const }] : []),
          ]}
          className="hidden lg:block h-64 shadow-[inset_0_0_0_1px_var(--hr-rule)] bg-[var(--hr-surface)]"
        />
      )}
    </div>
  );
}
