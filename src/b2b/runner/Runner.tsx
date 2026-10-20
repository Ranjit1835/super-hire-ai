// The test runner (inside <ProctoredSession>): question navigator, coding (Monaco, run, submit) and MCQ,
// server-synced countdown, autosave every ~5 s and on blur with an offline queue, heartbeat for the single
// active session, watermark, auto-submit at the deadline.
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, CloudOff, Loader2, Play, Send, Wifi } from "lucide-react";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { ApiError, assessApi } from "../lib/api";
import { useProctor } from "../proctor";
import type { AttemptState, JudgeResult, RunnerQuestion } from "../../../supabase/functions/_shared/contracts/assess";
import type { Language as LanguageSchema } from "../../../supabase/functions/_shared/contracts/common";
import { AutosaveQueue, storedSaves, type EditEvent, type SaveStatus } from "./autosave";
import { formatRemaining, useCountdown, type ServerTime } from "./clock";
import { queueKey, safeLocalStorage } from "./session";
import { Watermark } from "./Watermark";

type Language = z.infer<typeof LanguageSchema>;
const CodeEditor = lazy(() => import("./CodeEditor"));

export const LANGUAGE_LABEL: Record<string, string> = { python: "Python 3", java: "Java", cpp: "C++", c: "C", javascript: "JavaScript" };

interface Answer { language: string; codeByLang: Record<string, string>; mcq: string[] }

export function initialAnswers(questions: RunnerQuestion[], stored: { questionId: string; seq: number; language?: string; code?: string; mcq_choice?: string[] }[]) {
  const answers: Record<string, Answer> = {};
  const seqs: Record<string, number> = {};
  for (const q of questions) {
    const langs = q.languages ?? [];
    const savedLang = q.saved?.language && langs.includes(q.saved.language as Language) ? q.saved.language : langs[0] ?? "python";
    const a: Answer = { language: savedLang, codeByLang: {}, mcq: q.saved?.mcq_choice ?? [] };
    for (const l of langs) a.codeByLang[l] = q.starter_code?.[l] ?? "";
    if (q.saved?.code != null) a.codeByLang[savedLang] = q.saved.code;
    seqs[q.id] = q.saved?.seq ?? 0;
    const local = stored.find((s) => s.questionId === q.id);
    if (local && local.seq > seqs[q.id]) {   // unsent answers from before a refresh win over the server copy
      if (local.language && langs.includes(local.language as Language)) a.language = local.language;
      if (local.code !== undefined) a.codeByLang[a.language] = local.code;
      if (local.mcq_choice) a.mcq = local.mcq_choice;
      seqs[q.id] = local.seq;
    }
    answers[q.id] = a;
  }
  return { answers, seqs };
}

export interface RunnerProps {
  state: AttemptState;
  /** The attempt ended (finished here, deadline, or refused as ended). */
  onEnded: () => void;
  /** Another tab or device took over. */
  onConflict: () => void;
  /** Registers the runner's finish so the page can call it (strict-policy auto-submit). */
  finishRef?: { current: ((reason: "submitted" | "violations") => Promise<void>) | null };
  heartbeatMs?: number;
  autosaveMs?: number;
}

export function Runner({ state, onEnded, onConflict, finishRef, heartbeatMs = 15_000, autosaveMs = 5_000 }: RunnerProps) {
  const proctor = useProctor();
  const attemptId = state.attemptId;
  const sessionId = state.sessionId;
  const questions = state.questions;
  const storage = safeLocalStorage();

  const init = useMemo(() => initialAnswers(questions, storedSaves(storage, queueKey(attemptId))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [attemptId]);
  const [answers, setAnswers] = useState<Record<string, Answer>>(init.answers);
  const answersRef = useRef(answers);
  answersRef.current = answers;
  const seqs = useRef<Record<string, number>>(init.seqs);
  const edits = useRef<Record<string, EditEvent[]>>({});
  const dirty = useRef(new Set<string>());

  const [index, setIndex] = useState(0);
  const [time, setTime] = useState<ServerTime>({ deadlineAt: state.deadline_at, serverNow: state.server_now, receivedAt: Date.now() });
  const [serverPaused, setServerPaused] = useState(state.paused);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const [runs, setRuns] = useState<Record<string, JudgeResult | { error: string }>>({});
  const [running, setRunning] = useState(false);
  const [customInput, setCustomInput] = useState("");
  const [useCustom, setUseCustom] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmFinish, setConfirmFinish] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const finishingRef = useRef(false);
  const cbs = useRef({ onEnded, onConflict });
  cbs.current = { onEnded, onConflict };

  const paused = serverPaused || proctor.paused;
  const q = questions[index];

  const [queue] = useState(() => new AutosaveQueue({
    storage, storageKey: queueKey(attemptId),
    send: async (item) => {
      const r = await assessApi("autosave", {
        attemptId, sessionId, questionId: item.questionId, seq: item.seq, language: item.language as Language | undefined,
        code: item.code, mcq_choice: item.mcq_choice, edits: item.edits,
      });
      setTime({ deadlineAt: r.deadline_at, serverNow: r.server_now, receivedAt: Date.now() });
    },
    onStatus: (s) => setSaveStatus(s),
    onFatal: (code) => {
      if (code === "OTHER_SESSION") cbs.current.onConflict();
      else if (code === "PAUSED") setServerPaused(true);
      else cbs.current.onEnded();
    },
  }));

  /** Queue every changed answer and send. */
  const saveDirty = useCallback(() => {
    for (const qid of dirty.current) {
      const a = answersRef.current[qid];
      const question = questions.find((x) => x.id === qid);
      if (!a || !question) continue;
      seqs.current[qid] = (seqs.current[qid] ?? 0) + 1;
      const ev = edits.current[qid] ?? [];
      edits.current[qid] = [];
      queue.put(question.type === "coding"
        ? { questionId: qid, seq: seqs.current[qid], language: a.language, code: a.codeByLang[a.language] ?? "", edits: ev.length ? ev : undefined }
        : { questionId: qid, seq: seqs.current[qid], mcq_choice: a.mcq });
    }
    dirty.current.clear();
    return queue.flush();
  }, [queue, questions]);

  // Autosave timer, blur / tab hidden, back online; flush anything restored from storage straight away.
  useEffect(() => {
    void queue.flush();
    const h = setInterval(() => { void saveDirty(); }, autosaveMs);
    const onHidden = () => { if (document.visibilityState === "hidden") void saveDirty(); };
    const onBlur = () => { void saveDirty(); };
    const onOnline = () => { setOnline(true); void queue.flush(); };
    const onOffline = () => setOnline(false);
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("blur", onBlur);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      clearInterval(h);
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [queue, saveDirty, autosaveMs]);

  useEffect(() => () => queue.stop(), [queue]);

  // Heartbeat: keeps this tab the active session and re-syncs the clock and pause state.
  useEffect(() => {
    const beat = async () => {
      try {
        const r = await assessApi("heartbeat", { attemptId, sessionId });
        if (r.reason === "OTHER_SESSION") { queue.stop(); cbs.current.onConflict(); return; }
        if (r.reason === "ENDED") { queue.stop(); cbs.current.onEnded(); return; }
        setTime({ deadlineAt: r.deadline_at, serverNow: r.server_now, receivedAt: Date.now() });
        setServerPaused(r.paused);
      } catch { /* offline: the save indicator already says so */ }
    };
    const h = setInterval(() => { void beat(); }, heartbeatMs);
    return () => clearInterval(h);
  }, [attemptId, sessionId, heartbeatMs, queue]);

  const finish = useCallback(async (reason: "submitted" | "violations") => {
    if (finishingRef.current) return;
    finishingRef.current = true;
    setFinishing(true);
    await Promise.race([saveDirty(), new Promise((r) => setTimeout(r, 8000))]);
    try {
      await assessApi("finish", { attemptId, sessionId, reason });
    } catch (e) {
      if (e instanceof ApiError && e.code === "OTHER_SESSION") { cbs.current.onConflict(); return; }
      if (!(e instanceof ApiError && ["ENDED", "DEADLINE_PASSED"].includes(e.code))) {
        // The server ends the attempt at the deadline anyway; tell the subject what happened.
        finishingRef.current = false;
        setFinishing(false);
        setNotice(e instanceof Error ? `Couldn't submit: ${e.message}` : "Couldn't submit. Please try again.");
        return;
      }
    }
    queue.stop();
    try { storage?.removeItem(queueKey(attemptId)); } catch { /* ignore */ }
    cbs.current.onEnded();
  }, [attemptId, sessionId, queue, saveDirty, storage]);
  if (finishRef) finishRef.current = finish;

  const left = useCountdown(time, { paused, onExpire: () => { void finish("submitted"); } });

  const update = (qid: string, patch: Partial<Answer>) => {
    setAnswers((prev) => {
      const next = { ...prev, [qid]: { ...prev[qid], ...patch } };
      answersRef.current = next;
      return next;
    });
    dirty.current.add(qid);
  };

  const report = (type: "paste_attempt" | "large_paste" | "typing_burst", meta: Record<string, unknown>) => {
    proctor.report({ type, severity: type === "typing_burst" ? "low" : "medium", meta: { ...meta, questionId: q?.id } });
    if (type === "paste_attempt" && q) {
      (edits.current[q.id] ??= []).push({ t: Date.now(), op: "paste_blocked", len: Number(meta.length ?? 0) });
      dirty.current.add(q.id);
      setNotice("Pasting from outside the test is turned off. Type your answer instead.");
    }
  };

  const go = (i: number) => { void saveDirty(); setIndex(i); setNotice(null); };

  const run = async () => {
    if (!q || q.type !== "coding") return;
    const a = answers[q.id];
    setRunning(true);
    try {
      const r = await assessApi("run", { attemptId, sessionId, questionId: q.id, language: a.language as Language,
                                         code: a.codeByLang[a.language] ?? "", customInput: useCustom ? customInput : undefined },
                                { timeoutMs: 90_000 });
      setRuns((p) => ({ ...p, [q.id]: r }));
    } catch (e) {
      setRuns((p) => ({ ...p, [q.id]: { error: e instanceof Error ? e.message : "Couldn't run your code." } }));
    } finally {
      setRunning(false);
    }
  };

  const submitQuestion = async () => {
    if (!q) return;
    const a = answers[q.id];
    try {
      await saveDirty();
      await assessApi("submitQuestion", q.type === "coding"
        ? { attemptId, sessionId, questionId: q.id, language: a.language as Language, code: a.codeByLang[a.language] ?? "" }
        : { attemptId, sessionId, questionId: q.id, mcq_choice: a.mcq }, { timeoutMs: 90_000 });
      setNotice("Answer submitted. You can still change it until you finish the test.");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Couldn't submit this answer.");
    }
  };

  const answered = (qq: RunnerQuestion) => {
    const a = answers[qq.id];
    if (!a) return false;
    if (qq.type === "mcq") return a.mcq.length > 0;
    const code = a.codeByLang[a.language] ?? "";
    return code.trim() !== "" && code !== (qq.starter_code?.[a.language] ?? "");
  };

  if (!q) return <p className="p-8 text-center">This test has no questions.</p>;
  const a = answers[q.id];
  const result = runs[q.id];
  const lowTime = left !== null && left < 5 * 60_000;

  return (
    <div className="relative min-h-screen bg-background text-foreground flex flex-col">
      <Watermark text={state.watermark ?? attemptId} />
      <header className="border-b border-border flex items-center gap-3 px-4 h-14 sticky top-0 bg-background z-20">
        <h1 className="font-semibold truncate flex-1">{state.title ?? "Test"}</h1>
        <SaveIndicator status={saveStatus} online={online} />
        <div role="timer" aria-label="Time left" className={cn("font-mono tabular-nums text-lg px-2 rounded", lowTime && "text-destructive")}>
          {left === null ? "--:--" : formatRemaining(left)}
        </div>
        <Button size="sm" onClick={() => setConfirmFinish(true)} disabled={finishing}>
          {finishing ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}Finish test
        </Button>
      </header>

      <div className="flex flex-1 min-h-0">
        <nav aria-label="Questions" className="w-20 sm:w-28 border-r border-border p-2 flex flex-col gap-1 overflow-y-auto">
          {questions.map((qq, i) => (
            <button key={qq.id} type="button" onClick={() => go(i)} aria-current={i === index ? "step" : undefined}
              aria-label={`Question ${i + 1}${answered(qq) ? ", answered" : ""}`}
              className={cn("rounded-md border px-2 py-1.5 text-sm text-left flex items-center justify-between",
                i === index ? "border-primary bg-primary/10" : "border-border hover:bg-muted")}>
              <span>Q{i + 1}</span>
              {answered(qq) && <CheckCircle2 className="h-3.5 w-3.5 text-primary" aria-hidden />}
            </button>
          ))}
        </nav>

        <main className="flex-1 min-w-0 grid lg:grid-cols-2 gap-4 p-4">
          <section aria-label="Question" className="min-w-0 overflow-y-auto">
            <div className="flex items-center gap-2 flex-wrap mb-2">
              {q.section && <Badge variant="outline">{q.section}</Badge>}
              <Badge variant="secondary" className="capitalize">{q.difficulty}</Badge>
              <span className="text-xs text-muted-foreground">{q.points} {q.points === 1 ? "point" : "points"}</span>
            </div>
            <h2 className="text-lg font-semibold mb-2">{index + 1}. {q.title}</h2>
            <div className="whitespace-pre-wrap text-sm leading-relaxed">{q.statement}</div>
            {q.constraints && <div className="mt-3 text-sm"><b>Constraints</b><div className="whitespace-pre-wrap">{q.constraints}</div></div>}
            {q.samples && q.samples.length > 0 && (
              <div className="mt-4 space-y-2">
                {q.samples.map((s, i) => (
                  <div key={i} className="grid grid-cols-2 gap-2 text-xs">
                    <div><p className="font-medium mb-1">Sample input {i + 1}</p><pre className="bg-muted rounded p-2 overflow-x-auto">{s.input}</pre></div>
                    <div><p className="font-medium mb-1">Expected output</p><pre className="bg-muted rounded p-2 overflow-x-auto">{s.output}</pre></div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section aria-label="Answer" className="min-w-0 flex flex-col gap-3">
            {q.type === "mcq" ? (
              <McqOptions question={q} value={a.mcq} onChange={(mcq) => update(q.id, { mcq })} />
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <label className="text-sm" htmlFor="lang">Language</label>
                  <select id="lang" className="border border-border rounded-md bg-background px-2 py-1 text-sm" value={a.language}
                    onChange={(e) => { update(q.id, { language: e.target.value }); }}>
                    {(q.languages ?? []).map((l) => <option key={l} value={l}>{LANGUAGE_LABEL[l] ?? l}</option>)}
                  </select>
                </div>
                <div className="flex-1 min-h-[320px]">
                  <Suspense fallback={<div className="h-[320px] grid place-items-center text-sm text-muted-foreground">Loading editor…</div>}>
                    <CodeEditor key={`${q.id}:${a.language}`} language={a.language} value={a.codeByLang[a.language] ?? ""}
                      readOnly={paused}
                      onChange={(code, ev) => {
                        (edits.current[q.id] ??= []).push(...ev);
                        update(q.id, { codeByLang: { ...answersRef.current[q.id].codeByLang, [a.language]: code } });
                      }}
                      onBlur={() => { void saveDirty(); }}
                      onSignal={report} />
                  </Suspense>
                </div>
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={useCustom} onChange={(e) => setUseCustom(e.target.checked)} /> Also run with my own input
                  </label>
                  {useCustom && <Textarea aria-label="Custom input" rows={3} value={customInput} onChange={(e) => setCustomInput(e.target.value)} className="font-mono text-xs" />}
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => { void run(); }} disabled={running || paused}>
                      {running ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Play className="h-4 w-4 mr-1" />}Run samples
                    </Button>
                  </div>
                  {result && <RunPanel result={result} />}
                </div>
              </>
            )}
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={() => { void submitQuestion(); }} disabled={paused}><Send className="h-4 w-4 mr-1" />Submit answer</Button>
              {index < questions.length - 1 && <Button size="sm" variant="ghost" onClick={() => go(index + 1)}>Next question</Button>}
            </div>
            {notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
          </section>
        </main>
      </div>

      {paused && (
        <div role="alertdialog" aria-label="Test paused" className="fixed inset-0 z-40 bg-background/95 grid place-items-center p-6 text-center">
          <div><p className="text-lg font-semibold">The test is paused</p>
            <p className="text-sm text-muted-foreground mt-1">Fix the proctoring issue shown on screen to continue.</p></div>
        </div>
      )}

      <AlertDialog open={confirmFinish} onOpenChange={setConfirmFinish}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Finish the test?</AlertDialogTitle>
            <AlertDialogDescription>
              You've answered {questions.filter(answered).length} of {questions.length} questions. You can't change your answers after this.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep working</AlertDialogCancel>
            <AlertDialogAction onClick={() => { void finish("submitted"); }}>Finish</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function McqOptions({ question, value, onChange }: { question: RunnerQuestion; value: string[]; onChange: (v: string[]) => void }) {
  const multi = !!question.multi_select;
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm text-muted-foreground mb-2">{multi ? "Select all that apply" : "Select one answer"}</legend>
      {(question.options ?? []).map((o) => {
        const checked = value.includes(o.id);
        return (
          <label key={o.id} className={cn("flex items-start gap-3 rounded-md border p-3 cursor-pointer text-sm", checked ? "border-primary bg-primary/5" : "border-border")}>
            <input type={multi ? "checkbox" : "radio"} name={`q-${question.id}`} checked={checked} className="mt-0.5"
              onChange={() => onChange(multi ? (checked ? value.filter((x) => x !== o.id) : [...value, o.id]) : [o.id])} />
            <span className="whitespace-pre-wrap">{o.text}</span>
          </label>
        );
      })}
    </fieldset>
  );
}

function RunPanel({ result }: { result: JudgeResult | { error: string } }) {
  if ("error" in result) return <p role="alert" className="text-sm text-destructive">{result.error}</p>;
  return (
    <div className="rounded-md border border-border p-3 text-xs space-y-2" aria-label="Run results">
      <p className="font-medium">{result.passed} of {result.total} sample tests passed</p>
      {result.compile_output && <pre className="bg-muted rounded p-2 overflow-x-auto text-destructive">{result.compile_output}</pre>}
      {result.tests.map((t, i) => (
        <div key={i}>
          <p>Sample {i + 1}: <b className={t.passed ? "text-primary" : "text-destructive"}>{t.passed ? "passed" : t.status.replace(/_/g, " ")}</b>
            {t.time_ms !== null && <span className="text-muted-foreground"> · {t.time_ms} ms</span>}</p>
          {!t.passed && t.stdout !== undefined && (
            <div className="grid grid-cols-2 gap-2 mt-1">
              <pre className="bg-muted rounded p-2 overflow-x-auto">{t.stdout || "(no output)"}</pre>
              <pre className="bg-muted rounded p-2 overflow-x-auto">{t.expected}</pre>
            </div>
          )}
        </div>
      ))}
      {result.custom && (
        <div>
          <p className="font-medium">Your input: {result.custom.status === "ok" ? "ran" : result.custom.status.replace(/_/g, " ")}</p>
          <pre className="bg-muted rounded p-2 overflow-x-auto">{result.custom.stdout || "(no output)"}</pre>
          {result.custom.stderr && <pre className="bg-muted rounded p-2 overflow-x-auto text-destructive">{result.custom.stderr}</pre>}
        </div>
      )}
    </div>
  );
}

export function SaveIndicator({ status, online }: { status: SaveStatus; online: boolean }) {
  const offline = !online || status === "offline";
  return (
    <span role="status" aria-label="Connection" className={cn("hidden sm:inline-flex items-center gap-1 text-xs", offline ? "text-destructive" : "text-muted-foreground")}>
      {offline ? <><CloudOff className="h-3.5 w-3.5" /> Offline, answers kept on this device</>
        : status === "saving" ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</>
        : <><Wifi className="h-3.5 w-3.5" /> All answers saved</>}
    </span>
  );
}
