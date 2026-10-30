// The V1 interview loop (voice only, beta): speak the question → listen → submit with an idempotency key → present
// the server's next state. The server owns the transcript and the state machine, so any failure can resume from it.
// Voice failures never switch to typing (owner decision 2026-09-29): they open an audio re-check, are logged, and
// "Resume" re-asks the current question from the server's state.
import { useCallback, useEffect, useRef, useState } from "react";
import { isEchoOfPrompt, waitForSpeechEnd, type SpeakOutcome } from "@/lib/speech";
import { createTurnTimer } from "@/lib/turn-latency";
import { MicError, SILENCE_MS } from "@/features/b2b/hooks/useVoiceAnswer";
import { detectInjection } from "../../../supabase/functions/_shared/interview-v1/injection";
import { latencyStats, type LatencyStats } from "../../../supabase/functions/_shared/interview-v1/stats";
import { useProctor } from "../proctor";
import { ApiError, interviewV1Api, type RoomState } from "./api";
import { useRoomVoice } from "./cloudVoice";

export type RoomPhase = "loading" | "ready" | "asking" | "listening" | "submitting" | "empty" | "retry" | "audio_check" | "finished" | "error";
export type AudioIssue =
  | "tts_blocked" | "tts_error" | "no_voices" | "tts_unsupported" | "mic_denied" | "mic_missing" | "mic_busy"
  | "stt_unsupported" | "stt_error" | "no_speech";

interface Pending { clientTurnId: string; turnCount: number; answer: string; meta: Record<string, unknown> }

export function newTurnId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID()
    : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => (Number(c) ^ (Math.random() * 16) >> (Number(c) / 4)).toString(16));
}

const ttsIssue = (o: SpeakOutcome): AudioIssue | null =>
  o === "blocked" ? "tts_blocked" : o === "no-voices" ? "no_voices" : o === "unsupported" ? "tts_unsupported" : o === "error" ? "tts_error" : null;

function micIssue(e: unknown): AudioIssue {
  const code = e instanceof MicError ? e.code : "";
  if (code === "blocked") return "mic_denied";
  if (code === "no-mic") return "mic_missing";
  if (code === "unsupported") return "stt_unsupported";
  return "stt_error";
}

export function useRoomSession(interviewId: string) {
  const proctor = useProctor();
  const [phase, setPhase] = useState<RoomPhase>("loading");
  const [room, setRoom] = useState<RoomState | null>(null);
  // Cloud voice when the server offers it (Phase 3: Groq Whisper + Google WaveNet), else the browser's speech.
  const voice = useRoomVoice(interviewId, room?.voice);
  const [error, setError] = useState<string | null>(null);
  const [issue, setIssue] = useState<AudioIssue | null>(null);
  const [samples, setSamples] = useState<number[]>([]);
  const [now, setNow] = useState(Date.now());
  const [offset, setOffset] = useState(0);
  const alive = useRef(true);
  const pending = useRef<Pending | null>(null);
  const samplesRef = useRef<number[]>([]);
  const timer = useRef(createTurnTimer()).current;
  const reportRef = useRef(proctor.report);
  reportRef.current = proctor.report;

  useEffect(() => () => { alive.current = false; voice.cancel(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (phase === "finished" || phase === "loading") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [phase]);

  const show = useCallback((s: RoomState) => {
    setRoom(s);
    setOffset(Date.parse(s.serverNow) - Date.now());
  }, []);

  const flagAudio = useCallback((kind: AudioIssue | "recheck_passed" | "resumed", detail?: string) => {
    void interviewV1Api("audioIssue", { interviewId, kind, ...(detail ? { detail: detail.slice(0, 200) } : {}) }).catch(() => undefined);
  }, [interviewId]);

  const toAudioCheck = useCallback((kind: AudioIssue, detail?: string) => {
    voice.cancel();
    setIssue(kind);
    setPhase("audio_check");
    flagAudio(kind, detail);
  }, [voice, flagAudio]);

  const finishWith = useCallback(async (s: RoomState) => {
    show(s);
    voice.cancel();
    if (s.closing) { setPhase("asking"); await voice.speak(s.closing); }
    if (!alive.current) return;
    setPhase("finished");
    if (samplesRef.current.length) {
      void interviewV1Api("latency", { interviewId, samples: samplesRef.current.slice(0, 100) }).catch(() => undefined);
    }
  }, [interviewId, show, voice]);

  // presentRef breaks the present → listen → submit → present cycle without stale closures.
  const presentRef = useRef<(s: RoomState) => Promise<void>>(async () => {});

  const submit = useCallback(async (p: Pending) => {
    pending.current = p;
    setPhase("submitting");
    setError(null);
    try {
      const clientLatency = timer.take();
      if (clientLatency) {
        samplesRef.current = [...samplesRef.current, clientLatency.turn_end_to_first_audio_ms];
        setSamples(samplesRef.current);
      }
      timer.sent();
      const next = await interviewV1Api("turn", { interviewId, ...p, meta: p.meta, clientLatency, speak: voice.cloud.tts });
      timer.replied();
      pending.current = null;
      voice.preload(next.speech);
      await presentRef.current(next);
    } catch (e) {
      if (!alive.current) return;
      if (e instanceof ApiError && (e.code === "TURN_CONFLICT" || e.code === "NOT_IN_PROGRESS")) {
        pending.current = null;
        try { await presentRef.current(await interviewV1Api("room", { interviewId })); } catch { setPhase("retry"); }
        return;
      }
      setError(e instanceof ApiError && e.status === 0
        ? "Connection lost. Your answer is kept on this page; tap Try again."
        : e instanceof Error ? e.message : "Something went wrong.");
      setPhase("retry");
    }
  }, [interviewId, timer, voice]);

  const listen = useCallback(async (s: RoomState) => {
    setPhase("listening");
    timer.reset();
    try {
      await waitForSpeechEnd();
      if (!alive.current) return;
      const a = await voice.listen({ onRecorded: () => setPhase("submitting") });
      if (!alive.current) return;
      if (!a.text) { setPhase("empty"); return; }
      if (isEchoOfPrompt(a.text, s.question ?? "")) {
        setError("Your microphone picked up the interviewer's voice. Use headphones or lower the volume, then answer again.");
        setPhase("empty");
        return;
      }
      const inj = detectInjection(a.text);
      if (inj.detected) reportRef.current({ type: "prompt_injection", severity: "medium", meta: { patterns: inj.patterns, turn: s.turnCount + 1 } });
      timer.heard(performance.now() - (a.meta.ended_by === "silence" ? SILENCE_MS : 0));
      timer.closed();
      await submit({ clientTurnId: newTurnId(), turnCount: s.turnCount, answer: a.text, meta: a.meta as unknown as Record<string, unknown> });
    } catch (e) {
      if (!alive.current) return;
      // The server couldn't transcribe this answer (network or vendor): ask again, it isn't a microphone problem.
      if (e instanceof ApiError) {
        setError(e.status === 0 ? "Connection lost while sending your answer. Please answer again." : e.message);
        setPhase("empty");
        return;
      }
      toAudioCheck(micIssue(e), e instanceof Error ? e.message : undefined);
    }
  }, [voice, submit, timer, toAudioCheck]);

  presentRef.current = async (s: RoomState) => {
    if (!alive.current) return;
    show(s);
    if (s.status !== "in_progress") { await finishWith(s); return; }
    setPhase("asking");
    const outcome = await voice.speak(s.question ?? "", { onStart: timer.audible });
    if (!alive.current) return;
    const bad = ttsIssue(outcome);
    if (bad) { toAudioCheck(bad); return; }
    await listen(s);
  };

  // Initial load.
  useEffect(() => {
    let cancelled = false;
    interviewV1Api("room", { interviewId })
      .then((s) => {
        if (cancelled) return;
        show(s);
        setPhase(s.status === "in_progress" ? "ready" : "finished");
      })
      .catch((e: unknown) => { if (!cancelled) { setError(e instanceof Error ? e.message : "Couldn't open the interview."); setPhase("error"); } });
    return () => { cancelled = true; };
  }, [interviewId, show]);

  /** Start / resume (from a tap: unlocks speech on phones before the first await). */
  const begin = useCallback(() => {
    voice.prime();
    if (room) void presentRef.current(room);
  }, [room, voice]);

  /** After the audio re-check: fetch the server's state and re-ask the current question. */
  const resume = useCallback(async () => {
    voice.prime();
    setIssue(null);
    flagAudio("resumed");
    setPhase("loading");
    try {
      await presentRef.current(await interviewV1Api("room", { interviewId }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't resume.");
      setPhase("retry");
    }
  }, [interviewId, flagAudio, voice]);

  const end = useCallback(async () => {
    voice.cancel();
    try { await finishWith(await interviewV1Api("finish", { interviewId })); }
    catch (e) { setError(e instanceof Error ? e.message : "Couldn't end the interview."); }
  }, [interviewId, voice, finishWith]);

  const latency: LatencyStats = latencyStats(samples);
  return {
    phase, room, error, issue, voice, latency,
    remainingMs: room ? Date.parse(room.deadlineAt) - (now + offset) : 0,
    begin, resume, end,
    answerAgain: () => { setError(null); if (room) void listen(room); },
    retry: () => { if (pending.current) void submit(pending.current); else void resume(); },
    recheckPassed: () => flagAudio("recheck_passed"),
  };
}

export type RoomSession = ReturnType<typeof useRoomSession>;
