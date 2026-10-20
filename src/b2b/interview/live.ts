// Gemini Live spike helpers (pure, unit-tested): audio conversion for the Live API and the latency meter.
// Latency = candidate's speech end (local energy VAD) → first audio chunk of the model's reply.

/** Downsample float32 mono audio to `outRate` and encode as little-endian PCM16, base64 (Live API input format). */
export function floatToPcm16Base64(input: Float32Array, inRate: number, outRate = 16000): string {
  const ratio = inRate / outRate;
  const n = Math.floor(input.length / ratio);
  const bytes = new Uint8Array(n * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, input[Math.floor(i * ratio)] ?? 0));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/** Decode base64 little-endian PCM16 (Live API output, 24 kHz) into float32 samples for Web Audio. */
export function pcm16Base64ToFloat(b64: string): Float32Array {
  const bin = atob(b64);
  const out = new Float32Array(Math.floor(bin.length / 2));
  for (let i = 0; i < out.length; i++) {
    const v = (bin.charCodeAt(i * 2) | (bin.charCodeAt(i * 2 + 1) << 8)) << 16 >> 16;
    out[i] = v / 0x8000;
  }
  return out;
}

export function rms(frame: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
  return frame.length ? Math.sqrt(sum / frame.length) : 0;
}

/**
 * Energy VAD: speech starts above `threshold`; it ends after `hangMs` below it. `onEnd(at)` gets the time of the
 * last loud frame (the real end of speech), not the time the hang-over expired.
 */
export function createVad(opts: { threshold?: number; hangMs?: number; onEnd: (at: number) => void }) {
  const threshold = opts.threshold ?? 0.02;
  const hang = opts.hangMs ?? 600;
  let speaking = false;
  let lastLoud = 0;
  return {
    push(level: number, at: number) {
      if (level >= threshold) { speaking = true; lastLoud = at; return; }
      if (speaking && at - lastLoud >= hang) { speaking = false; opts.onEnd(lastLoud); }
    },
    get speaking() { return speaking; },
  };
}

export interface LiveTurn { turn: number; latencyMs: number }

/** Records speech end → first reply audio per turn, plus the session length. */
export function createLiveMeter() {
  let speechEnd: number | null = null;
  let waiting = false;
  let started: number | null = null;
  let ended: number | null = null;
  const turns: LiveTurn[] = [];
  return {
    sessionStarted(at: number) { started = at; },
    sessionEnded(at: number) { ended = at; },
    speechEnded(at: number) { speechEnd = at; waiting = true; },
    /** A reply audio chunk arrived; only the first after a speech end counts. Returns the latency when it counted. */
    audioChunk(at: number): number | null {
      if (!waiting || speechEnd === null) return null;
      waiting = false;
      const ms = Math.round(at - speechEnd);
      if (ms < 0 || ms > 60_000) return null;
      turns.push({ turn: turns.length + 1, latencyMs: ms });
      return ms;
    },
    get turns() { return [...turns]; },
    sessionSeconds(now: number): number | null { return started === null ? null : Math.round(((ended ?? now) - started) / 1000); },
  };
}

export const LIVE_WS_URL = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained";

export const SPIKE_SCRIPT = `You are a polite technical interviewer running a 5-question practice interview for a fresher software role in India.
Ask these questions in order, one at a time, waiting for each answer; at most one short follow-up per question:
1. Please introduce yourself briefly.
2. What is the difference between a process and a thread?
3. How does a hash map work, and what is its average lookup time?
4. Tell me about a project you built and one problem you solved in it.
5. Do you have a question for me?
Then thank the candidate and end. Never give scores or say whether answers were right.`;

export function setupMessage(model: string) {
  return {
    setup: {
      model: model.startsWith("models/") ? model : `models/${model}`,
      generationConfig: { responseModalities: ["AUDIO"] },
      systemInstruction: { parts: [{ text: SPIKE_SCRIPT }] },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
    },
  };
}
