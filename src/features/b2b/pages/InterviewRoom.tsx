import { useCallback, useEffect, useRef, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Keyboard, Loader2, Mic, PhoneOff, RotateCcw, Volume2, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { B2BShell, CenteredSpinner, EmptyState } from "../components/B2BShell";
import { ModuleMeta } from "../components/ModuleMeta";
import { useMyMemberships, useMyQuota, useStudentModules } from "../hooks/useB2B";
import { MicError, STT_LANG, useVoiceAnswer, voiceSupport } from "../hooks/useVoiceAnswer";
import { ApiError, interviewApi, type InterviewPayload } from "../lib/api";
import { COMPANY_PACK_DISCLAIMER } from "../lib/shared";

type Phase = "loading" | "preflight" | "starting" | "live" | "finished" | "blocked";
type Live = "asking" | "answering" | "submitting" | "retry" | "empty";
interface Pending { clientTurnId: string; turnCount: number; answer: string; meta: Record<string, unknown> }

const pendingKey = (id: string) => `hiresume_b2b_pending_${id}`;
function loadPending(id: string): Pending | null {
  try { return JSON.parse(sessionStorage.getItem(pendingKey(id)) ?? "null"); } catch { return null; }
}
function savePending(id: string, p: Pending | null) {
  try {
    if (p) sessionStorage.setItem(pendingKey(id), JSON.stringify(p));
    else sessionStorage.removeItem(pendingKey(id));
  } catch { /* storage blocked */ }
}
function uuid(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
        (Number(c) ^ (Math.random() * 16) >> (Number(c) / 4)).toString(16));
}
function browserInfo() {
  const ua = navigator.userAgent;
  const m = ua.match(/(Edg|Chrome|Firefox|Version)\/(\d+)/);
  const name = m ? ({ Edg: "Edge", Chrome: "Chrome", Firefox: "Firefox", Version: "Safari" } as Record<string, string>)[m[1]] : "Other";
  return { browser: `${name} ${m?.[2] ?? ""}`.trim(), platform: /Android/i.test(ua) ? "Android" : /iPhone|iPad/i.test(ua) ? "iOS" : /Windows/i.test(ua) ? "Windows" : /Mac/i.test(ua) ? "macOS" : "Other" };
}
function mmss(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** /learn/interview/:moduleId */
export default function InterviewRoom() {
  const { moduleId = "" } = useParams();
  const qc = useQueryClient();
  const memberships = useMyMemberships();
  const student = memberships.data?.find((m) => m.role === "student");
  const modules = useStudentModules(student?.org_id);
  const quota = useMyQuota();
  const voice = useVoiceAnswer();
  const support = voiceSupport();

  const [phase, setPhase] = useState<Phase>("loading");
  const [live, setLive] = useState<Live>("asking");
  const [data, setData] = useState<InterviewPayload | null>(null);
  const [existing, setExisting] = useState<InterviewPayload | null>(null);
  const [textMode, setTextMode] = useState(!support.stt);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [clockOffset, setClockOffset] = useState(0);
  const [now, setNow] = useState(Date.now());
  const pendingRef = useRef<Pending | null>(null);
  const alive = useRef(true);
  const textModeRef = useRef(textMode);
  textModeRef.current = textMode;

  const mod = modules.data?.find((m) => m.id === moduleId);
  const q = quota.data?.find((x) => x.org_id === student?.org_id);

  useEffect(() => () => { alive.current = false; voice.cancel(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { try { window.speechSynthesis?.getVoices(); } catch { /* ignore */ } }, []);
  useEffect(() => {
    if (phase !== "live") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [phase]);

  // Is there already a live interview?
  useEffect(() => {
    let cancelled = false;
    interviewApi.current()
      .then((r) => {
        if (cancelled) return;
        if (r.interview && r.interview.module_id !== moduleId) { setExisting(r); setPhase("blocked"); }
        else { setExisting(r.interview ? r : null); setPhase("preflight"); }
      })
      .catch((e) => { if (!cancelled) { setError((e as Error).message); setPhase("preflight"); } });
    return () => { cancelled = true; };
  }, [moduleId]);

  const finish = useCallback((p: InterviewPayload) => {
    voice.cancel();
    setData(p);
    setPhase("finished");
    qc.invalidateQueries({ queryKey: ["b2b"] });
  }, [qc, voice]);

  // ── Core loop ──────────────────────────────────────────────────────────────
  // Refs, not state, carry the interview id and callbacks between async steps, so a
  // recovered answer can be re-sent before React has re-rendered.
  const ivIdRef = useRef<string | null>(null);
  const presentRef = useRef<(p: InterviewPayload) => Promise<void>>(async () => {});

  const submit = useCallback(async (p: Pending) => {
    const id = ivIdRef.current;
    if (!id) return;
    pendingRef.current = p;
    savePending(id, p);
    setLive("submitting");
    setError(null);
    try {
      const res = await interviewApi.answer({ interviewId: id, ...p });
      pendingRef.current = null;
      savePending(id, null);
      await presentRef.current(res);
    } catch (e) {
      if (!alive.current) return;
      if (e instanceof ApiError && e.code === "TURN_CONFLICT" && e.data) {
        pendingRef.current = null;
        savePending(id, null);
        await presentRef.current(e.data as InterviewPayload);
      } else if (e instanceof ApiError && e.code === "NOT_IN_PROGRESS") {
        savePending(id, null);
        try { finish(await interviewApi.resume(id)); } catch { setLive("retry"); }
      } else {
        setError(e instanceof ApiError && e.status === 0
          ? "Connection lost. Your answer is saved on this device — tap Try again."
          : (e as Error).message);
        setLive("retry");
      }
    }
  }, [finish]);

  const listenVoice = useCallback(async (turnCount: number) => {
    setLive("answering");
    try {
      const a = await voice.listen();
      if (!alive.current) return;
      if (!a.text) { setLive("empty"); return; }
      await submit({ clientTurnId: uuid(), turnCount, answer: a.text, meta: a.meta as unknown as Record<string, unknown> });
    } catch (e) {
      if (!alive.current) return;
      setError(e instanceof MicError ? e.message : (e as Error).message);
      if (e instanceof MicError && (e.code === "blocked" || e.code === "no-mic" || e.code === "unsupported")) setTextMode(true);
      setLive("empty");
    }
  }, [voice, submit]);

  presentRef.current = async (p: InterviewPayload) => {
    if (!alive.current || !p.interview) return;
    ivIdRef.current = p.interview.id;
    setData(p);
    setClockOffset(Date.parse(p.interview.server_now) - Date.now());
    if (p.interview.status !== "in_progress") {
      if (p.closing && !textModeRef.current) { setLive("asking"); await voice.speak(p.closing); }
      finish(p);
      return;
    }
    setPhase("live");
    // Re-send an answer that was in flight when the page was closed or reloaded.
    const saved = loadPending(p.interview.id);
    if (saved && saved.turnCount === p.interview.turn_count) {
      await submit(saved);
      return;
    }
    if (saved) savePending(p.interview.id, null);
    setTyped("");
    if (textModeRef.current) { setLive("answering"); return; }
    setLive("asking");
    await voice.speak(p.question ?? "");
    if (!alive.current) return;
    await listenVoice(p.interview.turn_count);
  };

  const begin = async (resume: boolean) => {
    setPhase("starting");
    setError(null);
    try {
      const meta = { ...browserInfo(), input_mode: textMode ? "text" : "voice", stt_lang: STT_LANG, stt_supported: support.stt };
      const p = resume && existing?.interview ? await interviewApi.resume(existing.interview.id) : await interviewApi.start(moduleId, meta);
      await presentRef.current(p);
    } catch (e) {
      setError((e as Error).message);
      setPhase("preflight");
    }
  };

  const submitTyped = () => {
    const text = typed.trim();
    if (!text || !data?.interview) return;
    submit({ clientTurnId: uuid(), turnCount: data.interview.turn_count, answer: text, meta: { input_mode: "text", ended_by: "typed" } });
  };

  const endInterview = async () => {
    setConfirmEnd(false);
    voice.cancel();
    if (!data?.interview) return;
    try { finish(await interviewApi.end(data.interview.id)); }
    catch (e) { setError((e as Error).message); }
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  if (memberships.isLoading || modules.isLoading) return <CenteredSpinner />;
  if (!student) return <Navigate to="/dashboard" replace />;
  const org = student.organizations;
  const shell = (children: React.ReactNode) => (
    <B2BShell title={org.name} subtitle={mod?.name ?? "Interview"} logoUrl={org.logo_url} isDemo={org.is_demo}>
      <div className="max-w-2xl mx-auto">{children}</div>
    </B2BShell>
  );

  if (!mod && phase !== "finished") {
    return shell(<EmptyState title="This module isn't available" body="It may have been archived by your institution."><Button asChild><Link to="/learn">Back to modules</Link></Button></EmptyState>);
  }

  if (phase === "loading" || phase === "starting") {
    return shell(
      <div className="text-center py-24" role="status">
        <Loader2 className="h-8 w-8 animate-spin text-violet-400 mx-auto mb-3" />
        <p className="text-sm text-muted-foreground">{phase === "starting" ? "Your interviewer is getting ready…" : "Loading…"}</p>
      </div>,
    );
  }

  if (phase === "blocked") {
    return shell(
      <EmptyState title="You have another interview in progress" body={`Finish or end "${existing?.interview?.module_name}" before starting a new one.`}>
        <Button asChild><Link to={`/learn/interview/${existing?.interview?.module_id}`}>Go to that interview</Link></Button>
      </EmptyState>,
    );
  }

  if (phase === "finished" && data?.interview) {
    const iv = data.interview;
    const cancelled = iv.status === "cancelled";
    return shell(
      <div className="text-center py-12 space-y-3">
        <CheckCircle2 className={`h-12 w-12 mx-auto ${cancelled ? "text-muted-foreground" : "text-emerald-400"}`} />
        <h2 className="text-xl font-semibold">{cancelled ? "Interview cancelled" : "Interview complete"}</h2>
        <p className="text-sm text-muted-foreground">
          {cancelled
            ? "No answers were recorded, so your interview credit was returned."
            : `You answered ${iv.turn_count} question${iv.turn_count === 1 ? "" : "s"} across ${iv.topics_covered} of ${iv.topics_total} topics.`}
        </p>
        {!cancelled && <p className="text-sm text-muted-foreground">Your detailed report is being prepared and will appear on your practice page.</p>}
        <Button asChild className="mt-2"><Link to="/learn">Back to practice</Link></Button>
      </div>,
    );
  }

  if (phase === "preflight") {
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

        <ul className="text-sm space-y-1.5 rounded-lg border border-border/60 p-4">
          <li className="flex gap-2"><Mic className="h-4 w-4 mt-0.5 text-violet-300 shrink-0" /> Use a headset if you can, in a quiet spot. Allow the microphone when asked.</li>
          <li className="flex gap-2"><Volume2 className="h-4 w-4 mt-0.5 text-violet-300 shrink-0" /> The interviewer speaks each question. Take a moment to think, then answer out loud.</li>
          <li className="flex gap-2"><CheckCircle2 className="h-4 w-4 mt-0.5 text-violet-300 shrink-0" /> Tap <strong>Done answering</strong> when you finish, or just pause for a few seconds.</li>
          <li className="flex gap-2"><WifiOff className="h-4 w-4 mt-0.5 text-violet-300 shrink-0" /> If your connection drops, reopen this page — you'll continue where you left off.</li>
        </ul>

        {!support.stt && (
          <p className="text-sm text-amber-200 flex gap-2"><AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            This browser can't do speech recognition. Use Google Chrome or Microsoft Edge for a voice interview, or type your answers below.</p>
        )}
        <div className="flex items-center gap-2">
          <Switch id="text-mode" checked={textMode} onCheckedChange={setTextMode} disabled={!support.stt} />
          <Label htmlFor="text-mode" className="text-sm font-normal">Type my answers instead of speaking</Label>
        </div>

        {error && <p className="text-sm text-red-300" role="alert">{error}</p>}

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

  // ── Live ───────────────────────────────────────────────────────────────────
  const iv = data!.interview!;
  const remaining = Date.parse(iv.deadline_at) - (now + clockOffset);
  const progress = Math.min(100, Math.round((iv.turn_count / iv.max_turns) * 100));
  return shell(
    <div className="space-y-5">
      <div>
        <div className="flex justify-between text-xs text-muted-foreground mb-1">
          <span>Question {Math.min(iv.turn_count + 1, iv.max_turns)} of up to {iv.max_turns}{iv.current_topic ? ` · ${iv.current_topic}` : ""}</span>
          <span className={remaining < 60_000 ? "text-amber-300 tabular-nums" : "tabular-nums"} aria-label="Time left">{mmss(remaining)}</span>
        </div>
        <Progress value={progress} className="h-1.5" aria-label={`${progress}% of questions done`} />
      </div>

      <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-5" aria-live="polite">
        <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1.5">
          <Volume2 className={`h-3.5 w-3.5 ${voice.phase === "speaking" ? "text-violet-300 animate-pulse" : ""}`} /> Interviewer
        </p>
        <p className="text-base leading-relaxed">{data?.question}</p>
      </div>

      {!textMode && (live === "answering" || live === "asking") && (
        <div className="rounded-xl border border-border/60 p-4 min-h-24" aria-live="polite">
          <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1.5">
            <Mic className={`h-3.5 w-3.5 ${voice.phase === "listening" ? "text-emerald-400 animate-pulse" : ""}`} />
            {voice.phase === "listening" ? "Listening…" : voice.phase === "speaking" ? "Listen to the question" : "Your answer"}
          </p>
          <p className="text-sm text-muted-foreground italic">{voice.phase === "listening" ? voice.transcript || "Start speaking when you're ready." : ""}</p>
        </div>
      )}

      {textMode && live === "answering" && (
        <div className="space-y-2">
          <Label htmlFor="typed-answer" className="flex items-center gap-1.5"><Keyboard className="h-4 w-4" /> Your answer</Label>
          <Textarea id="typed-answer" rows={5} value={typed} onChange={(e) => setTyped(e.target.value)} maxLength={4000} autoFocus />
          <Button onClick={submitTyped} disabled={!typed.trim()}>Submit answer</Button>
        </div>
      )}

      {live === "submitting" && (
        <p className="text-sm text-muted-foreground flex items-center gap-2" role="status"><Loader2 className="h-4 w-4 animate-spin" /> Thinking about your answer…</p>
      )}

      {live === "retry" && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 space-y-2" role="alert">
          <p className="text-sm flex gap-2"><WifiOff className="h-4 w-4 mt-0.5 shrink-0" /> {error ?? "Couldn't send your answer."}</p>
          <Button size="sm" onClick={() => pendingRef.current && submit(pendingRef.current)}><RotateCcw className="h-4 w-4 mr-1" /> Try again</Button>
        </div>
      )}

      {live === "empty" && (
        <div className="rounded-lg border border-border/60 p-4 space-y-2">
          <p className="text-sm">{error ?? "I didn't catch an answer."}</p>
          <div className="flex gap-2">
            {!textMode && <Button size="sm" onClick={() => { setError(null); listenVoice(iv.turn_count); }}><Mic className="h-4 w-4 mr-1" /> Answer again</Button>}
            {!textMode && <Button size="sm" variant="ghost" onClick={() => voice.speak(data?.question ?? "")}><Volume2 className="h-4 w-4 mr-1" /> Repeat question</Button>}
            <Button size="sm" variant="ghost" onClick={() => { setTextMode(true); setError(null); setLive("answering"); }}><Keyboard className="h-4 w-4 mr-1" /> Type instead</Button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-2">
        {!textMode && live === "answering" && voice.phase === "listening" && (
          <Button onClick={voice.finishAnswer}><CheckCircle2 className="h-4 w-4 mr-1" /> Done answering</Button>
        )}
        <Button variant="ghost" className="text-red-300 ml-auto" onClick={() => setConfirmEnd(true)} disabled={live === "submitting"}>
          <PhoneOff className="h-4 w-4 mr-1" /> End interview
        </Button>
      </div>

      <AlertDialog open={confirmEnd} onOpenChange={setConfirmEnd}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>End the interview now?</AlertDialogTitle>
            <AlertDialogDescription>
              {iv.turn_count === 0
                ? "You haven't answered anything yet, so your interview credit will be returned."
                : "Your report will be based on the answers so far. This uses one of your interviews."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep going</AlertDialogCancel>
            <AlertDialogAction onClick={endInterview}>End interview</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>,
  );
}
