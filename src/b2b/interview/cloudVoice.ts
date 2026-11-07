// Phase 3 voice, cheaper option: the room records one answer at a time and the server transcribes it (Groq
// Whisper), and the interviewer's lines are voiced on the server (Google WaveNet en-IN) and played here. Whichever
// half the server doesn't offer (RoomState.voice = "browser") stays on the browser's own speech, so nothing breaks
// without keys. Same interface as useVoiceAnswer, so the room loop doesn't care which is in use.
import { useCallback, useEffect, useRef, useState } from "react";
import { primeSpeech, speakText, stopSpeaking, type SpeakOutcome } from "@/lib/speech";
import {
  MAX_ANSWER_MS, MicError, NO_SPEECH_MS, SILENCE_MS, useVoiceAnswer, type VoiceAnswer, type VoiceAnswerMeta, type VoicePhase,
} from "@/features/b2b/hooks/useVoiceAnswer";
import type { RoomState } from "./api";
import { interviewV1Api } from "./api";

// ── Speech detection (pure, unit-tested) ─────────────────────────────────────
/** Frames are ~50 ms. The noise floor is learnt from the first frames; speech is a few frames clearly above it. */
export interface Vad {
  floor: number; calibrated: number; frames: number; loud: number; firstSpeech: number | null; lastSpeech: number | null; maxPause: number;
}
export const VAD_MIN_THRESHOLD = 0.012;
export const newVad = (): Vad => ({ floor: 0, calibrated: 0, frames: 0, loud: 0, firstSpeech: null, lastSpeech: null, maxPause: 0 });

/** Feed one frame's RMS level at time t (ms). Returns "silence" once the answer is over, else null. */
export function vadStep(v: Vad, rms: number, t: number, startedAt: number): "silence" | "no_speech" | null {
  v.frames++;
  if (v.frames <= 6) { v.floor = v.calibrated = Math.max(v.floor, rms); return null; }   // ~300 ms of room noise
  const threshold = Math.max(v.floor * 2, VAD_MIN_THRESHOLD);
  if (rms > threshold) {
    v.loud++;
    if (v.loud >= 3) {                                                            // ~150 ms of sound = speech
      if (v.firstSpeech === null) v.firstSpeech = t;
      else if (v.lastSpeech !== null) v.maxPause = Math.max(v.maxPause, t - v.lastSpeech);
      v.lastSpeech = t;
    }
  } else {
    v.loud = 0;
    // Keep learning while quiet, but never past 1.25x the calibrated room noise: a soft-spoken candidate's first
    // words must not raise the bar until they can't be heard at all.
    if (v.firstSpeech === null) v.floor = Math.min(v.floor * 0.98 + rms * 0.02, v.calibrated * 1.25);
  }
  if (v.firstSpeech === null) return t - startedAt >= NO_SPEECH_MS ? "no_speech" : null;
  return v.lastSpeech !== null && t - v.lastSpeech >= SILENCE_MS ? "silence" : null;
}

export function recorderMime(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  for (const m of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"]) {
    if (MediaRecorder.isTypeSupported?.(m)) return m;
  }
  return null;
}

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ""));
    r.onerror = () => reject(r.error ?? new Error("Couldn't read the recording."));
    r.readAsDataURL(blob);
  });
}

/** A silent WAV: played from the Start tap so later audio may autoplay. */
const SILENCE = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";

export function useRoomVoice(interviewId: string, cfg: RoomState["voice"]) {
  const browser = useVoiceAnswer();
  const mime = recorderMime();
  const cloudStt = !!cfg && cfg.stt !== "browser" && !!mime && typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
  const cloudTts = !!cfg && cfg.tts !== "browser";
  const [phase, setPhase] = useState<VoicePhase>("idle");
  const audio = useRef<HTMLAudioElement | null>(null);
  const cache = useRef(new Map<string, { audio: string; mime: string }>());
  const finishRef = useRef<((by: VoiceAnswerMeta["ended_by"]) => void) | null>(null);
  const cancelRef = useRef<(() => void) | null>(null);
  const ttsEndedAt = useRef<number | null>(null);
  const lastTtsMs = useRef<number | null>(null);

  useEffect(() => () => { cancelRef.current?.(); audio.current?.pause(); }, []);

  /** From the Start / Resume tap: unlocks both browser speech and audio playback. */
  const prime = useCallback(() => {
    primeSpeech();
    if (!cloudTts || typeof Audio === "undefined") return;
    if (!audio.current) audio.current = new Audio();
    audio.current.src = SILENCE;
    void audio.current.play().catch(() => undefined);
  }, [cloudTts]);

  /** A line the server already voiced (turn with speak: true). */
  const preload = useCallback((s: RoomState["speech"]) => { if (s) cache.current.set(s.text.trim(), { audio: s.audio, mime: s.mime }); }, []);

  const playClip = useCallback((clip: { audio: string; mime: string }, onStart?: () => void) => new Promise<SpeakOutcome>((resolve) => {
    const el = audio.current ?? (audio.current = new Audio());
    let started = false;
    el.onplaying = () => { if (!started) { started = true; onStart?.(); } };
    el.onended = () => resolve("done");
    el.onerror = () => resolve("error");
    el.src = `data:${clip.mime};base64,${clip.audio}`;
    el.play().catch((e: unknown) => resolve(e instanceof DOMException && e.name === "NotAllowedError" ? "blocked" : "error"));
    cancelRef.current = () => { el.pause(); resolve("cancelled"); };
  }), []);

  const speak = useCallback(async (text: string, opts: { onStart?: () => void } = {}): Promise<SpeakOutcome> => {
    if (!cloudTts) return browser.speak(text, opts);
    const key = text.trim();
    const t0 = performance.now();
    setPhase("speaking");
    let clip = cache.current.get(key);
    if (!clip) clip = await interviewV1Api("speak", { interviewId, text: key }).catch(() => undefined);
    let outcome: SpeakOutcome;
    if (clip) {
      cache.current.set(key, clip);
      outcome = await playClip(clip, opts.onStart);
      // A broken clip or a refused play falls back to the browser's voice rather than stalling the interview.
      if (outcome === "error") outcome = await speakText(text, { onStart: opts.onStart }).done;
    } else {
      outcome = await speakText(text, { onStart: opts.onStart }).done;
    }
    cancelRef.current = null;
    lastTtsMs.current = outcome === "done" ? Math.round(performance.now() - t0) : null;
    ttsEndedAt.current = performance.now();
    setPhase("idle");
    return outcome;
  }, [cloudTts, browser, interviewId, playClip]);

  /** Record one answer and transcribe it on the server. onRecorded fires when recording stops (before transcription). */
  const listen = useCallback(async (opts: { onRecorded?: () => void } = {}): Promise<VoiceAnswer> => {
    if (!cloudStt || !mime) return browser.listen();
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (e) {
      const n = e instanceof DOMException ? e.name : "";
      if (n === "NotAllowedError" || n === "SecurityError") throw new MicError("blocked", "Microphone access is blocked. Allow it in the browser's address bar and try again.");
      if (n === "NotFoundError" || n === "OverconstrainedError") throw new MicError("no-mic", "No microphone found. Plug in a headset and try again.");
      throw new MicError("start", e instanceof Error ? e.message : "Couldn't start the microphone.");
    }
    setPhase("listening");
    const since = ttsEndedAt.current ?? performance.now();
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    const rec = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 32_000 });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    const vad = newVad();
    const started = performance.now();

    const ended = await new Promise<VoiceAnswerMeta["ended_by"] | "cancelled">((resolve) => {
      let done = false;
      const stop = (by: VoiceAnswerMeta["ended_by"] | "cancelled") => {
        if (done) return;
        done = true;
        clearInterval(tick);
        clearTimeout(cap);
        finishRef.current = null;
        cancelRef.current = null;
        rec.onstop = () => resolve(by);
        try { rec.stop(); } catch { resolve(by); }
      };
      const tick = setInterval(() => {
        analyser.getFloatTimeDomainData(samples);
        let sum = 0;
        for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
        const r = vadStep(vad, Math.sqrt(sum / samples.length), performance.now(), started);
        if (r) stop("silence");
      }, 50);
      const cap = setTimeout(() => stop("max_duration"), MAX_ANSWER_MS);
      finishRef.current = (by) => stop(by);
      cancelRef.current = () => stop("cancelled");
      rec.start(1000);
    });
    stream.getTracks().forEach((t) => t.stop());
    void ctx.close().catch(() => undefined);
    setPhase("idle");

    const meta: VoiceAnswerMeta = {
      input_mode: "voice", stt_lang: "en-IN", question_tts_ms: lastTtsMs.current,
      response_latency_ms: vad.firstSpeech !== null ? Math.max(0, Math.round(vad.firstSpeech - since)) : null,
      speech_ms: vad.firstSpeech !== null && vad.lastSpeech !== null ? Math.round(vad.lastSpeech - vad.firstSpeech) : null,
      max_pause_ms: vad.firstSpeech !== null ? Math.round(vad.maxPause) : null,
      restarts: 0, ended_by: ended === "cancelled" ? "button" : ended, avg_confidence: null,
    };
    // Nothing said (or cancelled): no upload, no cost.
    if (ended === "cancelled" || (vad.firstSpeech === null && ended !== "button")) return { text: "", meta };
    opts.onRecorded?.();
    const blob = new Blob(chunks, { type: mime });
    const durationMs = Math.round(performance.now() - started);
    const r = await interviewV1Api("transcribe", { interviewId, audio: await toBase64(blob), mime, durationMs }, { timeoutMs: 60_000 });
    return { text: r.text, meta };
  }, [cloudStt, mime, browser, interviewId]);

  const finishAnswer = useCallback(() => { if (finishRef.current) finishRef.current("button"); else browser.finishAnswer(); }, [browser]);
  const cancel = useCallback(() => {
    cancelRef.current?.();
    audio.current?.pause();
    stopSpeaking();
    browser.cancel();
    setPhase("idle");
  }, [browser]);

  return {
    phase: cloudStt || cloudTts ? (phase !== "idle" ? phase : browser.phase) : browser.phase,
    transcript: cloudStt ? "" : browser.transcript,
    speak, listen, finishAnswer, cancel, prime, preload,
    supported: cloudStt || browser.supported,
    cloud: { stt: cloudStt, tts: cloudTts },
  };
}

export type RoomVoice = ReturnType<typeof useRoomVoice>;
