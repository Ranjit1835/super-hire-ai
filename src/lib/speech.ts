// Browser speech (Web Speech API) shared by every interview: B2C voice interview, the text
// interview's voice mode, and the B2B interview room.
//
// Why this exists — the ways speechSynthesis fails silently:
//  1. Autoplay: mobile browsers only let speech start inside (or shortly after) a user gesture.
//     iOS Safari needs the first speak() inside the tap itself; Android Chrome allows ~5 s.
//     The first question arrives after a 10–25 s AI call, so it was silently refused.
//     → primeSpeech() must be called synchronously in the Start tap to unlock speech.
//  2. speak() straight after cancel() is dropped by Chrome. → small delay after cancel.
//  3. Chrome's network voices stop after ~15 s of continuous speech. → speak sentence chunks
//     (replaces the pause()/resume() keep-alive, which itself stops speech on Android).
//  4. Utterances that are only referenced locally can be garbage-collected before `onend`.
//     → keep them in a module-level set until they finish.
//  5. Blocked speech usually fires neither `onstart` nor `onerror`. → treat "never started"
//     within START_TIMEOUT_MS as blocked, so the UI can ask the user to tap.

/** "no-voices": the device has no speech voice installed (common on Android without Google's speech engine). */
export type SpeakOutcome = "done" | "blocked" | "error" | "unsupported" | "cancelled" | "no-voices";

const START_TIMEOUT_MS = 2500;
const MAX_CHUNK = 180;
const live = new Set<SpeechSynthesisUtterance>();

const synth = (): SpeechSynthesis | null =>
  typeof window !== "undefined" && "speechSynthesis" in window ? window.speechSynthesis : null;

export const isTtsSupported = () => !!synth();

type RecognitionCtor = new () => unknown;
export function getRecognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}
export const isSttSupported = () => !!getRecognitionCtor();

let primed = false;
/**
 * Call synchronously inside a click/tap handler, before any await. Speaks a silent utterance,
 * which unlocks speechSynthesis for the rest of the session on iOS Safari and Android Chrome.
 */
export function primeSpeech(): void {
  const s = synth();
  if (!s) return;
  try {
    s.cancel();
    const u = new SpeechSynthesisUtterance(" ");
    u.volume = 0;
    live.add(u);
    u.onend = u.onerror = () => live.delete(u);
    s.speak(u);
    s.getVoices(); // also kicks off voice loading on Chrome
    primed = true;
  } catch { /* ignore */ }
}
export const isSpeechPrimed = () => primed;

/** Prefer voices installed on the device (reliable offline, no 15 s cut-off), Indian English first. */
export function pickVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const en = voices.filter((v) => v.lang?.toLowerCase().replace("_", "-").startsWith("en"));
  const lang = (v: SpeechSynthesisVoice) => v.lang.toLowerCase().replace("_", "-");
  const local = en.filter((v) => v.localService);
  return (
    local.find((v) => lang(v) === "en-in") ??
    en.find((v) => lang(v) === "en-in") ??
    local.find((v) => lang(v) === "en-gb") ??
    local.find((v) => lang(v) === "en-us") ??
    local[0] ??
    en.find((v) => /google (uk|us) english/i.test(v.name)) ??
    en[0] ?? voices[0] ?? null
  );
}

/** Voices load asynchronously on Chrome; wait briefly for them. */
export function waitForVoices(timeoutMs = 1200): Promise<SpeechSynthesisVoice[]> {
  const s = synth();
  if (!s) return Promise.resolve([]);
  const now = s.getVoices();
  if (now.length) return Promise.resolve(now);
  return new Promise((resolve) => {
    const done = () => { clearTimeout(t); s.removeEventListener?.("voiceschanged", done); resolve(s.getVoices()); };
    const t = setTimeout(done, timeoutMs);
    s.addEventListener?.("voiceschanged", done);
  });
}

/** Split into sentence-sized chunks so no single utterance runs long enough to be cut off. */
export function chunkText(text: string, max = MAX_CHUNK): string[] {
  const sentences = text.replace(/\s+/g, " ").trim().match(/[^.!?]+[.!?]*\s*/g) ?? [];
  const out: string[] = [];
  for (const raw of sentences) {
    const s = raw.trim();
    if (!s) continue;
    if (s.length <= max) { out.push(s); continue; }
    let cur = "";
    for (const word of s.split(" ")) {
      if ((cur + " " + word).trim().length > max && cur) { out.push(cur); cur = word; }
      else cur = (cur + " " + word).trim();
    }
    if (cur) out.push(cur);
  }
  return out;
}

export interface SpeakOptions {
  rate?: number;
  lang?: string;
  onStart?: () => void;
  /** Word boundaries, for lip-sync / captions. charIndex is relative to the whole text. */
  onBoundary?: (charIndex: number) => void;
}

export interface SpeakHandle {
  done: Promise<SpeakOutcome>;
  cancel: () => void;
}

/** Speak text reliably. Resolves "blocked" when the browser refused to start (needs a tap). */
export function speakText(text: string, opts: SpeakOptions = {}): SpeakHandle {
  const s = synth();
  if (!s) return { done: Promise.resolve("unsupported"), cancel: () => {} };
  const chunks = chunkText(text);
  if (!chunks.length) return { done: Promise.resolve("done"), cancel: () => {} };

  let cancelled = false;
  let settle: (o: SpeakOutcome) => void = () => {};
  const done = new Promise<SpeakOutcome>((resolve) => { settle = resolve; });
  const timers: ReturnType<typeof setTimeout>[] = [];
  let finished = false;
  const finish = (o: SpeakOutcome) => {
    if (finished) return;
    finished = true;
    timers.forEach(clearTimeout);
    settle(o);
  };

  const run = async () => {
    const voices = await waitForVoices();
    const voice = pickVoice(voices);
    let offset = 0;
    let startedAny = false;
    for (let i = 0; i < chunks.length; i++) {
      if (cancelled) return finish("cancelled");
      const chunk = chunks[i];
      const chunkOffset = text.indexOf(chunk, offset);
      offset = chunkOffset >= 0 ? chunkOffset + chunk.length : offset;
      const outcome = await new Promise<SpeakOutcome | "next">((resolve) => {
        const u = new SpeechSynthesisUtterance(chunk);
        u.rate = opts.rate ?? 0.95;
        u.lang = voice?.lang ?? opts.lang ?? "en-IN";
        if (voice) u.voice = voice;
        live.add(u);
        let began = false;
        const end = (r: SpeakOutcome | "next") => { live.delete(u); clearTimeout(startTimer); clearTimeout(safety); resolve(r); };
        u.onstart = () => {
          began = true;
          if (!startedAny) { startedAny = true; opts.onStart?.(); }
        };
        u.onboundary = (e: SpeechSynthesisEvent) => { if (chunkOffset >= 0) opts.onBoundary?.(chunkOffset + e.charIndex); };
        u.onend = () => end("next");
        u.onerror = (e: SpeechSynthesisErrorEvent) => {
          if (e.error === "interrupted" || e.error === "canceled") end(cancelled ? "cancelled" : "next");
          else if (e.error === "not-allowed") end("blocked");
          else end("error");
        };
        // Only the first chunk decides "blocked"; later chunks were already allowed.
        const startTimer = setTimeout(() => { if (!began && !s.speaking && i === 0) { s.cancel(); end("blocked"); } }, START_TIMEOUT_MS);
        // Never hang: generous upper bound for this chunk (~6 chars/s at the slowest).
        const safety = setTimeout(() => end("next"), START_TIMEOUT_MS + (chunk.length / 6) * 1000 + 2000);
        timers.push(startTimer, safety);
        s.speak(u);
      });
      // Never started and the device reports no voices: tapping won't help — say what will.
      if (outcome === "blocked" && voices.length === 0) return finish("no-voices");
      if (outcome !== "next") return finish(outcome);
    }
    finish("done");
  };

  // Chrome drops speak() issued in the same tick as cancel().
  s.cancel();
  timers.push(setTimeout(() => { void run(); }, 60));

  return {
    done,
    cancel: () => { cancelled = true; s.cancel(); finish("cancelled"); },
  };
}

export function stopSpeaking() {
  synth()?.cancel();
}

// ── Microphone ────────────────────────────────────────────────────────────────

export type MicProblem = "denied" | "no-mic" | "in-use" | "insecure" | "unsupported" | "unknown";

export function micProblemFromError(err: unknown): MicProblem {
  const name = (err as { name?: string })?.name ?? "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError") return "denied";
  if (name === "NotFoundError" || name === "DevicesNotFoundError" || name === "OverconstrainedError") return "no-mic";
  if (name === "NotReadableError" || name === "TrackStartError" || name === "AbortError") return "in-use";
  return "unknown";
}

/** Map SpeechRecognition error codes to a problem (null = not a real problem, e.g. no speech). */
export function micProblemFromRecognition(code: string): MicProblem | null {
  if (code === "not-allowed" || code === "service-not-allowed") return "denied";
  if (code === "audio-capture") return "no-mic";
  if (code === "no-speech" || code === "aborted") return null;
  return "unknown";
}

/** Human instructions for fixing each microphone problem on the user's browser. */
export const NO_VOICES_HELP =
  "No speaking voice is installed on this device. On Android, open Settings → Text-to-speech and install “Speech Services by Google”. Questions are still shown on screen.";

export function micHelp(problem: MicProblem, ua = typeof navigator !== "undefined" ? navigator.userAgent : ""): { title: string; steps: string } {
  const ios = /iPhone|iPad|iPod/i.test(ua);
  const android = /Android/i.test(ua);
  switch (problem) {
    case "denied":
      return {
        title: "Microphone permission denied",
        steps: ios
          ? "Open Settings → Safari → Microphone and choose Allow (or tap “aA” in the address bar → Website Settings → Microphone → Allow), then reload this page."
          : android
            ? "Tap the lock icon next to the address → Permissions → Microphone → Allow, then reload this page."
            : "Click the lock icon next to the address → Site settings → Microphone → Allow, then reload this page.",
      };
    case "no-mic":
      return { title: "No microphone found", steps: "Plug in a headset or check that your microphone is enabled in your system settings." };
    case "in-use":
      return { title: "Microphone is busy", steps: "Close other apps or tabs that are using the microphone (Zoom, Meet, another interview tab) and try again." };
    case "insecure":
      return { title: "Microphone needs a secure page", steps: "Open this page at https://hiresume.in." };
    case "unsupported":
      return { title: "Voice answers aren't supported in this browser", steps: "Use Google Chrome, Microsoft Edge or Safari, or type your answers instead." };
    default:
      return { title: "Microphone problem", steps: "Check your microphone and try again." };
  }
}

/** Live microphone level (0–1) for the pre-interview check. Call stop() when done. */
export async function startMicLevel(onLevel: (level: number) => void): Promise<{ stop: () => void }> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    throw Object.assign(new Error("unsupported"), { name: typeof window !== "undefined" && !window.isSecureContext ? "SecurityError" : "NotSupportedError" });
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx();
  if (ctx.state === "suspended") await ctx.resume().catch(() => {});
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  ctx.createMediaStreamSource(stream).connect(analyser);
  const buf = new Uint8Array(analyser.fftSize);
  let raf = 0;
  const tick = () => {
    analyser.getByteTimeDomainData(buf);
    let sum = 0;
    for (const v of buf) { const x = (v - 128) / 128; sum += x * x; }
    onLevel(Math.min(1, Math.sqrt(sum / buf.length) * 4));
    raf = requestAnimationFrame(tick);
  };
  tick();
  return {
    stop: () => {
      cancelAnimationFrame(raf);
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close().catch(() => {});
    },
  };
}
