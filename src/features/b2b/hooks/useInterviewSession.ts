import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, interviewApi, type InterviewPayload } from "../lib/api";
import { MicError, STT_LANG, useVoiceAnswer, voiceSupport } from "./useVoiceAnswer";

// The live interview loop, shared by the student interview room and the public readiness
// test: speak the question → listen (or type) → submit with an idempotency key → present
// the next payload. Handles retry after a dropped connection, re-sending an in-flight answer
// after a reload, turn conflicts, and mic failures (falls back to typing).

export type SessionPhase = "idle" | "starting" | "live" | "finished";
export type LivePhase = "asking" | "answering" | "submitting" | "retry" | "empty";
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
export function newTurnId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
        (Number(c) ^ (Math.random() * 16) >> (Number(c) / 4)).toString(16));
}
export function browserInfo() {
  const ua = navigator.userAgent;
  const m = ua.match(/(Edg|Chrome|Firefox|Version)\/(\d+)/);
  const name = m ? ({ Edg: "Edge", Chrome: "Chrome", Firefox: "Firefox", Version: "Safari" } as Record<string, string>)[m[1]] : "Other";
  return { browser: `${name} ${m?.[2] ?? ""}`.trim(), platform: /Android/i.test(ua) ? "Android" : /iPhone|iPad/i.test(ua) ? "iOS" : /Windows/i.test(ua) ? "Windows" : /Mac/i.test(ua) ? "macOS" : "Other" };
}

export function useInterviewSession(opts: { onFinished?: (p: InterviewPayload) => void } = {}) {
  const voice = useVoiceAnswer();
  const support = voiceSupport();
  const [phase, setPhase] = useState<SessionPhase>("idle");
  const [live, setLive] = useState<LivePhase>("asking");
  const [data, setData] = useState<InterviewPayload | null>(null);
  const [textMode, setTextMode] = useState(!support.stt);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [clockOffset, setClockOffset] = useState(0);
  const [now, setNow] = useState(Date.now());
  const pendingRef = useRef<Pending | null>(null);
  const alive = useRef(true);
  const textModeRef = useRef(textMode);
  textModeRef.current = textMode;
  const onFinishedRef = useRef(opts.onFinished);
  onFinishedRef.current = opts.onFinished;

  useEffect(() => () => { alive.current = false; voice.cancel(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { try { window.speechSynthesis?.getVoices(); } catch { /* ignore */ } }, []);
  useEffect(() => {
    if (phase !== "live") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [phase]);

  const finish = useCallback((p: InterviewPayload) => {
    voice.cancel();
    setData(p);
    setPhase("finished");
    onFinishedRef.current?.(p);
  }, [voice]);

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
      await submit({ clientTurnId: newTurnId(), turnCount, answer: a.text, meta: a.meta as unknown as Record<string, unknown> });
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

  /** Start (or resume) with any function that yields an interview payload. Throws on failure. */
  const begin = useCallback(async (load: () => Promise<InterviewPayload>) => {
    setPhase("starting");
    setError(null);
    try {
      await presentRef.current(await load());
    } catch (e) {
      setPhase("idle");
      throw e;
    }
  }, []);

  const clientMeta = () => ({ ...browserInfo(), input_mode: textModeRef.current ? "text" : "voice", stt_lang: STT_LANG, stt_supported: support.stt });

  const submitTyped = () => {
    const text = typed.trim();
    if (!text || !data?.interview) return;
    submit({ clientTurnId: newTurnId(), turnCount: data.interview.turn_count, answer: text, meta: { input_mode: "text", ended_by: "typed" } });
  };

  const end = async () => {
    voice.cancel();
    if (!data?.interview) return;
    try { finish(await interviewApi.end(data.interview.id)); }
    catch (e) { setError((e as Error).message); }
  };

  return {
    phase, live, data, error, setError, textMode, setTextMode, typed, setTyped, voice, support,
    remainingMs: data?.interview ? Date.parse(data.interview.deadline_at) - (now + clockOffset) : 0,
    begin, clientMeta, submitTyped, end,
    retry: () => pendingRef.current && submit(pendingRef.current),
    answerAgain: () => { setError(null); if (data?.interview) listenVoice(data.interview.turn_count); },
    repeatQuestion: () => voice.speak(data?.question ?? ""),
    typeInstead: () => { setTextMode(true); setError(null); setLive("answering"); },
  };
}

export type InterviewSession = ReturnType<typeof useInterviewSession>;
