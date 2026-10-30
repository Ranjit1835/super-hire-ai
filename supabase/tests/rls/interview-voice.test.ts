// @vitest-environment node
// Phase 3 voice, cheaper option (migration 0037 + _shared/voice.ts + b2b-interview transcribe/speak/turn speak):
// providers chosen by env, the candidate-only and live-only gate, per-interview caps, cost logging, the speak
// endpoint refusing arbitrary text, and Whisper's silence hallucinations dropped. Vendors are faked (no network).
import { describe, it, expect, beforeAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { GatewayRequest, GatewayResult } from "../../functions/_shared/ai-gateway/core";
import { makeV1Handlers, V1Error, type V1Deps } from "../../functions/b2b-interview/v1";
import { voiceConfig, transcribe, synthesize } from "../../functions/_shared/voice";
import { interviewContract } from "../../functions/_shared/contracts/interview";
import { buildFixture, type Fixture } from "../helpers/interview-v1-fixture";

let f: Fixture;
let iv = "";
beforeAll(async () => { f = await buildFixture(); }, 180_000);

const ENV: Record<string, string> = { GROQ_API_KEY: "test-groq", GOOGLE_TTS_API_KEY: "test-google" };
const env = (over: Record<string, string> = {}) => (k: string) => ({ ...ENV, ...over })[k];

const ai = async <T>(req: GatewayRequest<T>): Promise<GatewayResult<T>> => {
  const out = req.schemaName === "ask_question" ? { question: "Hello, please introduce yourself." }
    : { answer_signal: "adequate", answer_score: 6, move_kind: "new", question: "Tell me about a project you built." };
  const p = req.parse(out);
  return p.success ? { ok: true, data: p.data, cacheHit: false } : { ok: false, code: "INVALID_OUTPUT", message: "bad" };
};

interface Sent { url: string; headers: Record<string, string>; body: unknown }
function vendors(groq: unknown = { text: " I built a library app in Python. ", duration: 12.4, segments: [{ text: " I built a library app in Python.", no_speech_prob: 0.01, avg_logprob: -0.2 }] }) {
  const sent: Sent[] = [];
  const fetchFake = vi.fn(async (url: string, init: RequestInit) => {
    sent.push({ url, headers: init.headers as Record<string, string>, body: init.body });
    if (url.includes("api.groq.com")) return new Response(JSON.stringify(groq), { status: 200 });
    if (url.includes("texttospeech.googleapis.com")) return new Response(JSON.stringify({ audioContent: "SUQzBAAAAAAA" }), { status: 200 });
    if (url.includes("api.sarvam.ai/text-to-speech")) return new Response(JSON.stringify({ audios: ["SUQzBAAAAAAA"] }), { status: 200 });
    if (url.includes("api.sarvam.ai/speech-to-text")) return new Response(JSON.stringify({ transcript: "Main ne ek app banaya" }), { status: 200 });
    return new Response("nope", { status: 500 });
  });
  return { fetch: fetchFake as unknown as typeof fetch, sent };
}

function handlers(over: Partial<V1Deps> = {}) {
  return makeV1Handlers({ rpc: (fn, args) => f.svc(fn, args), ai, evaluateLater: vi.fn(), env: env(), fetch: vendors().fetch, ...over });
}
async function rejects(p: Promise<unknown>) {
  try { await p; } catch (e) { return e instanceof V1Error ? { status: e.status, code: e.code } : { message: (e as Error).message }; }
  throw new Error("expected a refusal");
}
const AUDIO = Buffer.alloc(4000, 7).toString("base64");
const usage = async (kind: string) => (await f.db.query<{ n: number; cost: string; units: string; provider_key: string }>(
  `SELECT count(*)::int AS n, COALESCE(sum(cost_inr), 0)::text AS cost,
          COALESCE(sum(CASE WHEN kind = 'stt' THEN stt_seconds ELSE tts_chars END), 0)::text AS units, max(provider_key) AS provider_key
     FROM b2b_usage_log WHERE interview_id = $1 AND kind = $2`, [iv, kind])).rows[0];

describe("provider choice", () => {
  it("uses Groq + Google when their keys are set, Sarvam on request, and the browser when keys are missing", () => {
    expect(voiceConfig(env())).toEqual({ stt: "groq", tts: "google" });
    expect(voiceConfig(env({ SARVAM_API_KEY: "s", B2B_VOICE_STT: "sarvam", B2B_VOICE_TTS: "sarvam" }))).toEqual({ stt: "sarvam", tts: "sarvam" });
    expect(voiceConfig(() => undefined)).toEqual({ stt: "browser", tts: "browser" });
    expect(voiceConfig(env({ B2B_VOICE_TTS: "sarvam" }))).toEqual({ stt: "groq", tts: "browser" });   // asked for Sarvam, no key
  });
});

describe("vendor calls", () => {
  it("Groq: Whisper turbo, English, the key only in the header; silence hallucinations are dropped", async () => {
    const v = vendors();
    const r = await transcribe(voiceConfig(env()), env(), v.fetch, new Uint8Array(4000), "audio/webm;codecs=opus", 12);
    expect(r).toEqual({ text: "I built a library app in Python.", seconds: 12.4, providerKey: "stt:groq:whisper-large-v3-turbo" });
    expect(v.sent[0].headers).toEqual({ Authorization: "Bearer test-groq" });
    const form = v.sent[0].body as FormData;
    expect(form.get("model")).toBe("whisper-large-v3-turbo");
    expect(form.get("language")).toBe("en");
    expect((form.get("file") as File).name).toBe("answer.webm");
    const quiet = vendors({ text: "Thank you.", segments: [{ text: "Thank you.", no_speech_prob: 0.9, avg_logprob: -1.4 }] });
    expect((await transcribe(voiceConfig(env()), env(), quiet.fetch, new Uint8Array(4000), "audio/webm", 3)).text).toBe("");
    await expect(transcribe(voiceConfig(env()), env(), v.fetch, new Uint8Array(4000), "video/x-msvideo", 3)).rejects.toThrow(/Unsupported/);
  });

  it("Google: an en-IN WaveNet voice as MP3; Sarvam: Bulbul V4 Flash", async () => {
    const v = vendors();
    expect(await synthesize(voiceConfig(env()), env(), v.fetch, "Tell me about yourself.")).toMatchObject({ mime: "audio/mpeg", chars: 23, providerKey: "tts:google:wavenet" });
    expect(JSON.parse(v.sent[0].body as string)).toMatchObject({ voice: { languageCode: "en-IN", name: "en-IN-Wavenet-D" }, audioConfig: { audioEncoding: "MP3" } });
    const s = env({ SARVAM_API_KEY: "test-sarvam", B2B_VOICE_TTS: "sarvam" });
    await synthesize(voiceConfig(s), s, v.fetch, "Hello.");
    expect(JSON.parse(v.sent[1].body as string)).toMatchObject({ model: "bulbul:v4-flash", language_code: "en-IN", output_audio_codec: "mp3" });
    expect(v.sent[1].headers).toMatchObject({ "api-subscription-key": "test-sarvam" });
  });
});

describe("interview voice endpoints", () => {
  it("the room says which voice is on; the candidate's answer is transcribed and logged at cost", async () => {
    const h = handlers();
    iv = (await h.startContext({ kind: "drive", contextId: f.ids.drive }, f.u.stuA)).interviewId;
    expect((await h.room({ interviewId: iv }, f.u.stuA)).voice).toEqual({ stt: "groq", tts: "google" });
    expect(await h.transcribe({ interviewId: iv, audio: AUDIO, mime: "audio/webm", durationMs: 12_000 }, f.u.stuA))
      .toEqual({ text: "I built a library app in Python." });
    const u = await usage("stt");
    expect(u).toMatchObject({ n: 1, provider_key: "stt:groq:whisper-large-v3-turbo" });
    expect(Number(u.units)).toBeCloseTo(12.4);
    expect(Number(u.cost)).toBeCloseTo(12.4 / 60 * 0.0587, 4);
  });

  it("nobody else can use the interview's voice, and nothing is sent to a vendor for them", async () => {
    const v = vendors();
    const h = handlers({ fetch: v.fetch });
    for (const actor of [f.u.stuA2, f.u.tpoA]) {
      expect(await rejects(h.transcribe({ interviewId: iv, audio: AUDIO, mime: "audio/webm", durationMs: 5000 }, actor))).toMatchObject({ message: expect.stringMatching(/FORBIDDEN/) });
      expect(await rejects(h.speak({ interviewId: iv, text: "Hello, please introduce yourself." }, actor))).toMatchObject({ status: 404, code: "NOT_FOUND" });
    }
    expect(v.sent).toHaveLength(0);
  });

  it("speak voices only this interview's own interviewer lines", async () => {
    const v = vendors();
    const h = handlers({ fetch: v.fetch });
    expect(await h.speak({ interviewId: iv, text: "Hello,  please introduce yourself." }, f.u.stuA)).toEqual({ audio: "SUQzBAAAAAAA", mime: "audio/mpeg" });
    expect(await rejects(h.speak({ interviewId: iv, text: "Read me a bedtime story about dragons." }, f.u.stuA)))
      .toMatchObject({ status: 400, code: "NOT_INTERVIEW_TEXT" });
    expect(v.sent).toHaveLength(1);
    expect((await usage("tts")).provider_key).toBe("tts:google:wavenet");
  });

  it("a turn can return the next question already voiced", async () => {
    const h = handlers();
    const room = await h.turn({ ...interviewContract.turn.input.parse({ interviewId: iv, clientTurnId: randomUUID(), turnCount: 0,
      answer: "I built a library app in Python.", meta: {} }), speak: true }, f.u.stuA);
    expect(room.speech).toEqual({ text: "Tell me about a project you built.", audio: "SUQzBAAAAAAA", mime: "audio/mpeg" });
    expect(interviewContract.turn.output.safeParse(room).success).toBe(true);
  });

  it("a broken vendor doesn't break the turn: the room falls back to the browser's voice", async () => {
    const down = vi.fn(async () => new Response("down", { status: 503 })) as unknown as typeof fetch;
    const h = handlers({ fetch: down });
    const room = await h.turn({ ...interviewContract.turn.input.parse({ interviewId: iv, clientTurnId: randomUUID(), turnCount: 1,
      answer: "A REST API for the library.", meta: {} }), speak: true }, f.u.stuA);
    expect(room.speech).toBeUndefined();
    expect(room.question).toBeTruthy();
    expect(await rejects(h.transcribe({ interviewId: iv, audio: AUDIO, mime: "audio/webm", durationMs: 4000 }, f.u.stuA)))
      .toMatchObject({ status: 502, code: "STT_FAILED" });
  });

  it("per-interview caps stop runaway use", async () => {
    await f.db.query(`INSERT INTO b2b_usage_log (org_id, interview_id, kind, provider_key, stt_seconds)
      SELECT org_id, id, 'stt', 'stt:groq:whisper-large-v3-turbo', 5400 FROM b2b_interviews WHERE id = $1`, [iv]);
    expect(await rejects(handlers().transcribe({ interviewId: iv, audio: AUDIO, mime: "audio/webm", durationMs: 4000 }, f.u.stuA)))
      .toMatchObject({ status: 429, code: "VOICE_LIMIT" });
  });

  it("without keys the endpoints say so and the room stays on browser speech", async () => {
    const h = handlers({ env: () => undefined });
    expect((await h.room({ interviewId: iv }, f.u.stuA)).voice).toEqual({ stt: "browser", tts: "browser" });
    expect(await rejects(h.transcribe({ interviewId: iv, audio: AUDIO, mime: "audio/webm", durationMs: 4000 }, f.u.stuA)))
      .toMatchObject({ status: 503, code: "VOICE_NOT_CONFIGURED" });
  });
});
