import { useCallback, useEffect, useRef, useState } from "react";
import { speakText, stopSpeaking, type SpeakOutcome } from "@/lib/speech";

// Same browser pipeline as the B2C voice interview (Web Speech API: speechSynthesis +
// SpeechRecognition), tuned for campus interviews:
//   • en-IN recognition and an Indian-English voice when available
//   • answers end after SILENCE_MS of silence *after* speech starts (freshers pause to think),
//     or when the student taps "Done answering"; Chrome's own session ends are restarted
//   • timings needed for audio metrics are measured client-side (no audio leaves the page
//     except what the browser's recogniser already streams)

export const STT_LANG = "en-IN";
export const SILENCE_MS = 5000;
export const NO_SPEECH_MS = 15000;
export const MAX_ANSWER_MS = 3 * 60 * 1000;

export type VoicePhase = "idle" | "speaking" | "listening";

export interface VoiceAnswerMeta {
  input_mode: "voice";
  stt_lang: string;
  question_tts_ms: number | null;
  response_latency_ms: number | null;
  speech_ms: number | null;
  max_pause_ms: number | null;
  restarts: number;
  ended_by: "silence" | "button" | "max_duration";
  avg_confidence: number | null;
}

export interface VoiceAnswer {
  text: string;
  meta: VoiceAnswerMeta;
}

type RecognitionCtor = new () => SpeechRecognitionLike;
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string; confidence: number } }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onspeechstart?: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

export function getRecognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function voiceSupport(): { stt: boolean; tts: boolean } {
  return { stt: !!getRecognitionCtor(), tts: typeof window !== "undefined" && "speechSynthesis" in window };
}

export function pickVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const en = voices.filter((v) => v.lang?.toLowerCase().startsWith("en"));
  return (
    en.find((v) => v.lang.toLowerCase() === "en-in") ??
    en.find((v) => /india/i.test(v.name)) ??
    en.find((v) => v.lang.toLowerCase() === "en-gb" && /google|microsoft/i.test(v.name)) ??
    en.find((v) => /google us english/i.test(v.name)) ??
    en[0] ?? voices[0] ?? null
  );
}

class MicError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}
export { MicError };

export function useVoiceAnswer(opts: { recognitionCtor?: RecognitionCtor | null } = {}) {
  const Ctor = opts.recognitionCtor !== undefined ? opts.recognitionCtor : getRecognitionCtor();
  const [phase, setPhase] = useState<VoicePhase>("idle");
  const [transcript, setTranscript] = useState("");
  const finishRef = useRef<((by: VoiceAnswerMeta["ended_by"]) => void) | null>(null);
  const cancelRef = useRef<(() => void) | null>(null);
  const lastTtsMs = useRef<number | null>(null);
  const ttsEndedAt = useRef<number | null>(null);

  useEffect(() => () => {
    cancelRef.current?.();
    stopSpeaking();
  }, []);

  /**
   * Speak the question (src/lib/speech.ts handles chunking, voices and autoplay).
   * Resolves with "blocked" when the browser refused audio — the caller shows "Tap to hear".
   */
  const speak = useCallback(async (text: string): Promise<SpeakOutcome> => {
    const started = performance.now();
    setPhase("speaking");
    const outcome = await speakText(text).done;
    lastTtsMs.current = outcome === "done" ? Math.round(performance.now() - started) : null;
    ttsEndedAt.current = performance.now();
    setPhase("idle");
    return outcome;
  }, []);

  /** Listen for one answer. Resolves with text ("" if nothing was heard). */
  const listen = useCallback((): Promise<VoiceAnswer> => {
    if (!Ctor) return Promise.reject(new MicError("unsupported", "Speech recognition isn't supported in this browser."));
    return new Promise((resolve, reject) => {
      const listenStart = performance.now();
      const since = ttsEndedAt.current ?? listenStart;
      let finals = "";
      let interim = "";
      let firstSpeech: number | null = null;
      let lastResult: number | null = null;
      let maxPause = 0;
      let restarts = 0;
      const confidences: number[] = [];
      let stopped = false;
      let rec: SpeechRecognitionLike | null = null;
      let silenceTimer: ReturnType<typeof setTimeout> | null = null;
      const maxTimer = setTimeout(() => finish("max_duration"), MAX_ANSWER_MS);
      const noSpeechTimer = setTimeout(() => { if (firstSpeech === null) finish("silence"); }, NO_SPEECH_MS);

      const cleanup = () => {
        stopped = true;
        clearTimeout(maxTimer);
        clearTimeout(noSpeechTimer);
        if (silenceTimer) clearTimeout(silenceTimer);
        finishRef.current = null;
        cancelRef.current = null;
        try { rec?.stop(); } catch { /* already stopped */ }
        setPhase("idle");
      };

      function finish(by: VoiceAnswerMeta["ended_by"]) {
        if (stopped) return;
        const text = `${finals} ${interim}`.replace(/\s+/g, " ").trim();
        cleanup();
        resolve({
          text,
          meta: {
            input_mode: "voice",
            stt_lang: STT_LANG,
            question_tts_ms: lastTtsMs.current,
            response_latency_ms: firstSpeech !== null ? Math.round(firstSpeech - since) : null,
            speech_ms: firstSpeech !== null && lastResult !== null ? Math.round(lastResult - firstSpeech) : null,
            max_pause_ms: firstSpeech !== null ? Math.round(maxPause) : null,
            restarts,
            ended_by: by,
            avg_confidence: confidences.length ? confidences.reduce((a, b) => a + b, 0) / confidences.length : null,
          },
        });
      }
      finishRef.current = finish;
      cancelRef.current = () => { if (!stopped) { cleanup(); try { rec?.abort(); } catch { /* ignore */ } } };

      const markSpeech = () => {
        const now = performance.now();
        if (firstSpeech === null) firstSpeech = now;
        else if (lastResult !== null) maxPause = Math.max(maxPause, now - lastResult);
        lastResult = now;
        if (silenceTimer) clearTimeout(silenceTimer);
        silenceTimer = setTimeout(() => finish("silence"), SILENCE_MS);
      };

      const begin = () => {
        rec = new Ctor();
        rec.lang = STT_LANG;
        rec.continuous = true;
        rec.interimResults = true;
        rec.onresult = (e) => {
          let fin = "";
          interim = "";
          for (let i = e.resultIndex; i < e.results.length; i++) {
            const r = e.results[i];
            if (r.isFinal) {
              fin += `${r[0].transcript} `;
              if (r[0].confidence > 0) confidences.push(r[0].confidence);
            } else interim += r[0].transcript;
          }
          if (fin) finals += fin;
          if (fin || interim.trim()) markSpeech();
          setTranscript(`${finals} ${interim}`.replace(/\s+/g, " ").trim());
        };
        rec.onerror = (e) => {
          if (e.error === "not-allowed" || e.error === "service-not-allowed") {
            cleanup();
            reject(new MicError("blocked", "Microphone access is blocked. Allow it in the browser's address bar and try again."));
          } else if (e.error === "audio-capture") {
            cleanup();
            reject(new MicError("no-mic", "No microphone found. Plug in a headset and try again."));
          }
          // "no-speech", "network", "aborted": onend fires next and we restart or finish.
        };
        rec.onend = () => {
          if (stopped) return;
          // Chrome ends continuous sessions on its own (silence, ~60 s); keep listening.
          if (restarts < 20) {
            restarts += 1;
            try { begin(); } catch { finish("silence"); }
          } else finish("silence");
        };
        rec.start();
      };

      setTranscript("");
      setPhase("listening");
      try { begin(); } catch (e) { cleanup(); reject(new MicError("start", (e as Error).message)); }
    });
  }, [Ctor]);

  /** Student tapped "Done answering". */
  const finishAnswer = useCallback(() => finishRef.current?.("button"), []);
  const cancel = useCallback(() => {
    cancelRef.current?.();
    stopSpeaking();
    setPhase("idle");
  }, []);

  return { phase, transcript, speak, listen, finishAnswer, cancel, supported: !!Ctor };
}
