// Phase 3 voice, cheaper option (docs/b2b/VOICE_STACK_RESEARCH.md): one answer at a time, transcribed by
// Groq Whisper (or Sarvam), and the interviewer voiced by Google WaveNet en-IN (or Sarvam Bulbul V4 Flash).
// Providers are picked by env; a missing key means that half stays on the browser's own speech (no regression).
//
//   B2B_VOICE_STT   groq | sarvam | browser     (default: groq when GROQ_API_KEY is set, else browser)
//   B2B_VOICE_TTS   google | sarvam | browser   (default: google when GOOGLE_TTS_API_KEY is set, else browser)
//   GROQ_API_KEY, GOOGLE_TTS_API_KEY, SARVAM_API_KEY
//   B2B_VOICE_GOOGLE_VOICE   default en-IN-Wavenet-D       B2B_VOICE_SARVAM_SPEAKER   optional
//
// Keys are read here and sent only to their own vendor; nothing is logged but sizes, durations and status codes.

export type SttProvider = "groq" | "sarvam" | "browser";
export type TtsProvider = "google" | "sarvam" | "browser";
export interface VoiceConfig { stt: SttProvider; tts: TtsProvider }

type Env = (key: string) => string | undefined;
const val = (env: Env, k: string) => (env(k) ?? "").trim();

export function voiceConfig(env: Env): VoiceConfig {
  const sttWanted = val(env, "B2B_VOICE_STT") as SttProvider | "";
  const ttsWanted = val(env, "B2B_VOICE_TTS") as TtsProvider | "";
  const has = { groq: !!val(env, "GROQ_API_KEY"), google: !!val(env, "GOOGLE_TTS_API_KEY"), sarvam: !!val(env, "SARVAM_API_KEY") };
  const stt: SttProvider = sttWanted === "browser" ? "browser"
    : sttWanted === "sarvam" ? (has.sarvam ? "sarvam" : "browser")
    : sttWanted === "groq" || sttWanted === "" ? (has.groq ? "groq" : "browser") : "browser";
  const tts: TtsProvider = ttsWanted === "browser" ? "browser"
    : ttsWanted === "sarvam" ? (has.sarvam ? "sarvam" : "browser")
    : ttsWanted === "google" || ttsWanted === "" ? (has.google ? "google" : "browser") : "browser";
  return { stt, tts };
}

export class VoiceError extends Error {
  constructor(public code: "PROVIDER_ERROR" | "BAD_AUDIO" | "NOT_CONFIGURED", message: string) { super(message); }
}

/** Accepted recordings: what MediaRecorder produces in Chromium (webm/opus) and Safari (mp4/aac). */
export const AUDIO_TYPES: Record<string, string> = { "audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/mpeg": "mp3", "audio/wav": "wav" };
/** One answer is at most 3 minutes; opus at ~32 kbps is ~0.7 MB, so 4 MB is ample. */
export const MAX_AUDIO_BYTES = 4 * 1024 * 1024;
export const MAX_ANSWER_SECONDS = 185;

export function baseMime(mime: string): string { return mime.split(";")[0].trim().toLowerCase(); }

/** Whisper invents words ("Thank you.") from silence or noise; these are dropped. */
const HALLUCINATIONS = /^(thank you\.?|thanks for watching!?|you|bye\.?|\.|subtitles by .*)$/i;

export interface SttResult { text: string; seconds: number; providerKey: string }

export async function transcribe(cfg: VoiceConfig, env: Env, f: typeof fetch,
                                 audio: Uint8Array, mime: string, clientSeconds: number): Promise<SttResult> {
  const type = baseMime(mime);
  const ext = AUDIO_TYPES[type];
  if (!ext) throw new VoiceError("BAD_AUDIO", "Unsupported audio format.");
  if (audio.byteLength < 200 || audio.byteLength > MAX_AUDIO_BYTES) throw new VoiceError("BAD_AUDIO", "The recording is empty or too long.");
  const seconds = Math.min(Math.max(clientSeconds, 0.1), MAX_ANSWER_SECONDS);
  const form = new FormData();
  form.append("file", new Blob([audio as unknown as BlobPart], { type }), `answer.${ext}`);

  if (cfg.stt === "groq") {
    form.append("model", "whisper-large-v3-turbo");
    form.append("language", "en");
    form.append("temperature", "0");
    form.append("response_format", "verbose_json");
    // Context helps Whisper with Indian English and tech words; it never contains the candidate's data.
    form.append("prompt", "A campus placement interview in India. The candidate answers in Indian English, sometimes mixing Hindi words.");
    const res = await f("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST", headers: { Authorization: `Bearer ${val(env, "GROQ_API_KEY")}` }, body: form,
    }).catch(() => null);
    if (!res?.ok) throw new VoiceError("PROVIDER_ERROR", `Groq transcription failed (${res?.status ?? "network"}).`);
    const d = await res.json() as { text?: string; duration?: number; segments?: { text: string; no_speech_prob?: number; avg_logprob?: number }[] };
    // Keep only segments that are speech (Whisper's own no-speech estimate).
    const segs = Array.isArray(d.segments) ? d.segments.filter((s) => !((s.no_speech_prob ?? 0) > 0.6 && (s.avg_logprob ?? 0) < -1)) : null;
    const text = clean(segs ? segs.map((s) => s.text).join(" ") : d.text ?? "");
    return { text, seconds: typeof d.duration === "number" ? Math.min(d.duration, MAX_ANSWER_SECONDS) : seconds, providerKey: "stt:groq:whisper-large-v3-turbo" };
  }
  if (cfg.stt === "sarvam") {
    form.append("model", "saaras:v3");
    form.append("language_code", "en-IN");
    form.append("mode", "codemix");
    const res = await f("https://api.sarvam.ai/speech-to-text", {
      method: "POST", headers: { "api-subscription-key": val(env, "SARVAM_API_KEY") }, body: form,
    }).catch(() => null);
    if (!res?.ok) throw new VoiceError("PROVIDER_ERROR", `Sarvam transcription failed (${res?.status ?? "network"}).`);
    const d = await res.json() as { transcript?: string };
    return { text: clean(d.transcript ?? ""), seconds, providerKey: "stt:sarvam" };
  }
  throw new VoiceError("NOT_CONFIGURED", "Cloud transcription isn't configured.");
}

function clean(s: string): string {
  const t = s.replace(/\s+/g, " ").trim();
  return HALLUCINATIONS.test(t) ? "" : t.slice(0, 4000);
}

export interface TtsResult { audio: string; mime: string; chars: number; providerKey: string }

/** Speak one interviewer line. Returns base64 audio. */
export async function synthesize(cfg: VoiceConfig, env: Env, f: typeof fetch, text: string): Promise<TtsResult> {
  const t = text.replace(/\s+/g, " ").trim().slice(0, 2400);
  if (!t) throw new VoiceError("BAD_AUDIO", "Nothing to say.");
  if (cfg.tts === "google") {
    const res = await f(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(val(env, "GOOGLE_TTS_API_KEY"))}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: { text: t },
        voice: { languageCode: "en-IN", name: val(env, "B2B_VOICE_GOOGLE_VOICE") || "en-IN-Wavenet-D" },
        audioConfig: { audioEncoding: "MP3", speakingRate: 0.95 },
      }),
    }).catch(() => null);
    if (!res?.ok) throw new VoiceError("PROVIDER_ERROR", `Google speech failed (${res?.status ?? "network"}).`);
    const d = await res.json() as { audioContent?: string };
    if (!d.audioContent) throw new VoiceError("PROVIDER_ERROR", "Google returned no audio.");
    return { audio: d.audioContent, mime: "audio/mpeg", chars: t.length, providerKey: "tts:google:wavenet" };
  }
  if (cfg.tts === "sarvam") {
    const speaker = val(env, "B2B_VOICE_SARVAM_SPEAKER");
    const res = await f("https://api.sarvam.ai/text-to-speech", {
      method: "POST", headers: { "Content-Type": "application/json", "api-subscription-key": val(env, "SARVAM_API_KEY") },
      body: JSON.stringify({ text: t, language_code: "en-IN", model: "bulbul:v4-flash", output_audio_codec: "mp3", pace: 0.95,
                             ...(speaker ? { speaker } : {}) }),
    }).catch(() => null);
    if (!res?.ok) throw new VoiceError("PROVIDER_ERROR", `Sarvam speech failed (${res?.status ?? "network"}).`);
    const d = await res.json() as { audios?: string[] };
    if (!d.audios?.[0]) throw new VoiceError("PROVIDER_ERROR", "Sarvam returned no audio.");
    return { audio: d.audios[0], mime: "audio/mpeg", chars: t.length, providerKey: "tts:sarvam:bulbul-v4-flash" };
  }
  throw new VoiceError("NOT_CONFIGURED", "Cloud speech isn't configured.");
}

export function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
