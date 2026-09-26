import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, CheckCircle2, Clock, Loader2, MessageSquare, Mic, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { CenteredSpinner } from "../components/B2BShell";
import { LiveInterviewPanel } from "../components/LiveInterviewPanel";
import { PreflightTips } from "../components/PreflightTips";
import { AudioCheck } from "@/components/interview/AudioCheck";
import { ReportPanel } from "../components/ReportPanel";
import { useInterviewSession } from "../hooks/useInterviewSession";
import { ApiError, ensureVisitorSession, interviewApi, publicTestApi, type InterviewPayload, type PublicTestInfo } from "../lib/api";
import { validateLead, publicTestConsentText, type LeadErrors } from "../lib/shared";
import { supabase } from "@/integrations/supabase/client";

function Frame({ org, children }: { org?: PublicTestInfo["org"]; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      {org?.is_demo && <div className="bg-amber-500/15 text-amber-200 text-xs text-center py-1.5">Demo institution</div>}
      <header className="border-b border-border/60">
        <div className="max-w-2xl mx-auto px-4 h-16 flex items-center gap-3">
          {org?.logo_url ? <img src={org.logo_url} alt="" className="h-10 w-10 rounded-md object-contain bg-white/5" /> : null}
          <div className="min-w-0">
            <p className="font-semibold truncate">{org?.name ?? "Readiness test"}</p>
            <p className="text-xs text-muted-foreground">Free interview readiness test · powered by HiResume</p>
          </div>
        </div>
      </header>
      <main className="max-w-2xl mx-auto px-4 py-8">{children}</main>
    </div>
  );
}

/** /test/:slug — public, no account. */
export default function PublicTest() {
  const { slug = "" } = useParams();
  const info = useQuery({ queryKey: ["public-test", slug], queryFn: () => publicTestApi.info(slug), staleTime: 60_000, retry: 1 });
  const s = useInterviewSession();
  const [moduleId, setModuleId] = useState<string | null>(null);
  const [form, setForm] = useState({ full_name: "", phone: "", email: "", target_course: "" });
  const [errors, setErrors] = useState<LeadErrors>({});
  const [consent, setConsent] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [resumable, setResumable] = useState<InterviewPayload | null>(null);

  // A visitor who reloads mid-test (same browser) can continue.
  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session || cancelled) return;
      interviewApi.current().then((r) => { if (!cancelled && r.interview) setResumable(r); }).catch(() => {});
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (info.data?.modules.length === 1) setModuleId(info.data.modules[0].id);
  }, [info.data]);

  const start = async () => {
    setPageError(null);
    const { lead, errors: errs } = validateLead(form);
    setErrors(errs);
    if (!lead || !moduleId || !consent) return;
    try {
      await s.begin(async () => {
        await ensureVisitorSession();
        const { interviewId } = await publicTestApi.start({
          slug, moduleId, clientMeta: s.clientMeta(),
          lead: { full_name: lead.full_name, phone: lead.phone, email: lead.email, target_course: lead.target_course ?? "" },
        });
        return interviewApi.resume(interviewId);
      });
    } catch (e) {
      setPageError(e instanceof ApiError || e instanceof Error ? e.message : "Something went wrong.");
    }
  };

  const resume = async () => {
    setPageError(null);
    try { await s.begin(() => interviewApi.resume(resumable!.interview!.id)); }
    catch (e) { setPageError((e as Error).message); }
  };

  if (info.isLoading) return <CenteredSpinner />;
  const d = info.data;
  if (info.error || !d) {
    return (
      <Frame>
        <h1 className="text-xl font-semibold">This test isn't available</h1>
        <p className="text-sm text-muted-foreground mt-2">{info.error ? (info.error as Error).message : "Check the link with the institute."}</p>
      </Frame>
    );
  }
  const org = d.org;
  const cta = org.cta_url ? (
    <Button asChild size="lg" className="w-full">
      <a href={org.cta_url} target="_blank" rel="noopener noreferrer">{org.cta_label || "Enquire about our course"} <ArrowRight className="h-4 w-4 ml-1" /></a>
    </Button>
  ) : null;

  if (s.phase === "live") {
    return (
      <Frame org={org}>
        <LiveInterviewPanel s={s} endCopy={{
          noAnswers: "You haven't answered anything yet. Your test won't be counted.",
          withAnswers: "Your report will be based on the answers so far.",
        }} />
      </Frame>
    );
  }

  if (s.phase === "finished" && s.data?.interview) {
    const iv = s.data.interview;
    return (
      <Frame org={org}>
        <div className="space-y-6">
          <div className="text-center space-y-2">
            <CheckCircle2 className="h-12 w-12 mx-auto text-emerald-400" />
            <h1 className="text-xl font-semibold">{iv.status === "cancelled" ? "Test cancelled" : "Your readiness report"}</h1>
            {iv.status !== "cancelled" && <p className="text-sm text-muted-foreground">{iv.module_name} · {iv.turn_count} answers</p>}
          </div>
          {iv.status !== "cancelled" && iv.turn_count > 0 && <ReportPanel interviewId={iv.id} passMark={6} moduleName={iv.module_name} compact />}
          <div className="rounded-xl border border-violet-500/25 bg-violet-500/5 p-5 space-y-3 text-center">
            <p className="font-medium">Want to close these gaps?</p>
            <p className="text-sm text-muted-foreground">{org.name} will get in touch with you about its course. You can also reach out now.</p>
            {cta}
          </div>
        </div>
      </Frame>
    );
  }

  if (s.phase === "starting") {
    return (
      <Frame org={org}>
        <div className="text-center py-20" role="status">
          <Loader2 className="h-8 w-8 animate-spin text-violet-400 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Your interviewer is getting ready…</p>
        </div>
      </Frame>
    );
  }

  const field = (k: keyof typeof form, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div>
      <Label htmlFor={`f-${k}`}>{label}</Label>
      <Input id={`f-${k}`} value={form[k]} onChange={(e) => { setForm({ ...form, [k]: e.target.value }); setErrors({ ...errors, [k]: undefined }); }}
        aria-invalid={!!errors[k]} aria-describedby={errors[k] ? `e-${k}` : undefined} {...props} />
      {errors[k] && <p id={`e-${k}`} className="text-xs text-red-300 mt-1">{errors[k]}</p>}
    </div>
  );

  return (
    <Frame org={org}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">How interview-ready are you?</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Take a free {d.modules[0] ? `${Math.max(...d.modules.map((m) => m.minutes))}-minute` : ""} voice interview with an AI interviewer and get an instant gap report.
          </p>
        </div>

        {resumable?.interview && (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 flex items-center gap-3">
            <p className="text-sm flex-1">You have a test in progress ({resumable.interview.module_name}).</p>
            <Button size="sm" onClick={resume}><RotateCcw className="h-4 w-4 mr-1" /> Continue</Button>
          </div>
        )}

        {!d.available ? (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 space-y-3">
            <p className="text-sm flex gap-2"><AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> Free tests are fully booked right now. Please contact {org.name} directly.</p>
            {cta}
          </div>
        ) : !d.modules.length ? (
          <p className="text-sm text-muted-foreground">No tests are open at the moment.</p>
        ) : (
          <>
            <fieldset>
              <legend className="text-sm font-medium mb-2">Choose a test</legend>
              <div className="grid sm:grid-cols-2 gap-2">
                {d.modules.map((m) => (
                  <button key={m.id} type="button" onClick={() => setModuleId(m.id)} aria-pressed={moduleId === m.id}
                    className={cn("rounded-lg border p-3 text-left", moduleId === m.id ? "border-violet-400 bg-violet-500/10" : "border-border/60 hover:bg-white/5")}>
                    <p className="font-medium text-sm">{m.name}</p>
                    {m.description && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{m.description}</p>}
                    <p className="text-xs text-muted-foreground mt-1 flex gap-3">
                      <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{m.minutes} min</span>
                      <span className="inline-flex items-center gap-1"><MessageSquare className="h-3 w-3" />{m.questions} questions</span>
                    </p>
                  </button>
                ))}
              </div>
            </fieldset>

            <div className="grid sm:grid-cols-2 gap-3">
              {field("full_name", "Your name", { autoComplete: "name" })}
              {field("phone", "Mobile number", { autoComplete: "tel", inputMode: "tel", placeholder: "98765 43210" })}
              {field("email", "Email", { autoComplete: "email", type: "email" })}
              {field("target_course", "Course you're interested in (optional)", { placeholder: "e.g. Java Full Stack" })}
            </div>

            <PreflightTips />
            <AudioCheck needMic={!s.textMode} />
            {!s.support.stt && (
              <p className="text-sm text-amber-200 flex gap-2"><AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                This browser can't do speech recognition. Use Chrome or Edge to answer by voice, or type your answers.</p>
            )}
            <div className="flex items-center gap-2">
              <Switch id="text-mode" checked={s.textMode} onCheckedChange={s.setTextMode} disabled={!s.support.stt} />
              <Label htmlFor="text-mode" className="text-sm font-normal">Type my answers instead of speaking</Label>
            </div>

            <div className="flex items-start gap-2">
              <Checkbox id="consent" checked={consent} onCheckedChange={(v) => setConsent(v === true)} className="mt-0.5" />
              <Label htmlFor="consent" className="text-sm font-normal leading-snug">{publicTestConsentText(org.name)}</Label>
            </div>

            {pageError && <p className="text-sm text-red-300" role="alert">{pageError}</p>}
            <Button size="lg" className="w-full" onClick={start} disabled={!moduleId || !consent}>
              <Mic className="h-4 w-4 mr-2" /> Start my free test
            </Button>
          </>
        )}
      </div>
    </Frame>
  );
}
