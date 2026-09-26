import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { chunkText, micHelp, micProblemFromError, micProblemFromRecognition, pickVoice, primeSpeech, speakText } from "./speech";

type Mode = "ok" | "silent" | "not-allowed";

/** Minimal speechSynthesis fake: "ok" plays each utterance, "silent" never starts (blocked by autoplay). */
function installSynth(mode: Mode, voices: Partial<SpeechSynthesisVoice>[] = [{ name: "Local IN", lang: "en-IN", localService: true }]) {
  const spoken: SpeechSynthesisUtterance[] = [];
  const synth = {
    speaking: false,
    getVoices: () => voices as SpeechSynthesisVoice[],
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
    cancel: vi.fn(() => { synth.speaking = false; }),
    speak: vi.fn((u: SpeechSynthesisUtterance) => {
      spoken.push(u);
      if (mode === "silent") return;
      setTimeout(() => {
        if (mode === "not-allowed") { u.onerror?.({ error: "not-allowed" } as SpeechSynthesisErrorEvent); return; }
        synth.speaking = true;
        u.onstart?.({} as SpeechSynthesisEvent);
        setTimeout(() => { synth.speaking = false; u.onend?.({} as SpeechSynthesisEvent); }, 50);
      }, 10);
    }),
  };
  class Utterance { text: string; volume = 1; rate = 1; lang = ""; voice: unknown = null;
    onstart?: (e: unknown) => void; onend?: (e: unknown) => void; onerror?: (e: unknown) => void; onboundary?: (e: unknown) => void;
    constructor(t: string) { this.text = t; } }
  vi.stubGlobal("SpeechSynthesisUtterance", Utterance);
  Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true, writable: true });
  return { synth, spoken };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("speech", () => {
  it("primeSpeech speaks a silent utterance (unlocks audio inside a tap)", () => {
    const { spoken } = installSynth("ok");
    primeSpeech();
    expect(spoken).toHaveLength(1);
    expect(spoken[0].volume).toBe(0);
  });

  it("speaks long text in sentence chunks and resolves done", async () => {
    const { spoken } = installSynth("ok");
    const text = "Tell me about yourself. " + "Describe a project where you used SQL to solve a real problem for a team. ".repeat(4);
    const h = speakText(text);
    await vi.runAllTimersAsync();
    await expect(h.done).resolves.toBe("done");
    expect(spoken.length).toBeGreaterThan(2);
    expect(spoken.every((u) => u.text.length <= 180)).toBe(true);
    expect(spoken[0].lang).toBe("en-IN");
  });

  it("reports blocked when the browser never starts speech (autoplay policy)", async () => {
    installSynth("silent");
    const h = speakText("What is a primary key?");
    await vi.advanceTimersByTimeAsync(3000);
    await expect(h.done).resolves.toBe("blocked");
  });

  it("reports blocked on a not-allowed error, and cancelled when cancelled", async () => {
    installSynth("not-allowed");
    const blocked = speakText("Question one.");
    await vi.runAllTimersAsync();
    await expect(blocked.done).resolves.toBe("blocked");

    installSynth("silent");
    const h = speakText("Question two.");
    h.cancel();
    await expect(h.done).resolves.toBe("cancelled");
  });

  it("prefers an on-device Indian English voice", () => {
    const v = pickVoice([
      { name: "Google US English", lang: "en-US", localService: false },
      { name: "Microsoft Heera", lang: "en-IN", localService: true },
      { name: "Samantha", lang: "en-US", localService: true },
    ] as SpeechSynthesisVoice[]);
    expect(v?.name).toBe("Microsoft Heera");
  });

  it("chunks without breaking words", () => {
    const long = "word ".repeat(100).trim() + ".";
    const chunks = chunkText(long, 50);
    expect(chunks.every((c) => c.length <= 50)).toBe(true);
    expect(chunks.join(" ").replace(/\s+/g, " ")).toBe(long);
  });

  it("maps microphone errors to actionable help", () => {
    expect(micProblemFromError({ name: "NotAllowedError" })).toBe("denied");
    expect(micProblemFromError({ name: "NotFoundError" })).toBe("no-mic");
    expect(micProblemFromError({ name: "NotReadableError" })).toBe("in-use");
    expect(micProblemFromRecognition("not-allowed")).toBe("denied");
    expect(micProblemFromRecognition("no-speech")).toBeNull();
    expect(micHelp("denied", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)").steps).toMatch(/Settings → Safari → Microphone/);
    expect(micHelp("denied", "Mozilla/5.0 (Linux; Android 14)").steps).toMatch(/lock icon/);
  });
});
