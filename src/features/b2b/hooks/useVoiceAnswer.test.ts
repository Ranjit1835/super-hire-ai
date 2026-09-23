import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { NO_SPEECH_MS, SILENCE_MS, pickVoice, useVoiceAnswer, type VoiceAnswer } from "./useVoiceAnswer";

type Handler<T> = ((e: T) => void) | null;
class FakeRecognition {
  static instances: FakeRecognition[] = [];
  lang = "";
  continuous = false;
  interimResults = false;
  onresult: Handler<unknown> = null;
  onend: (() => void) | null = null;
  onerror: Handler<{ error: string }> = null;
  started = false;
  constructor() { FakeRecognition.instances.push(this); }
  start() { this.started = true; }
  stop() { this.started = false; this.onend?.(); }
  abort() { this.started = false; }
  /** Emit results the way Chrome does: cumulative list with resultIndex. */
  say(parts: Array<[string, boolean, number?]>) {
    this.onresult?.({
      resultIndex: 0,
      results: parts.map(([t, isFinal, c]) => ({ isFinal, 0: { transcript: t, confidence: c ?? 0.9 } })),
    });
  }
  static last() { return FakeRecognition.instances[FakeRecognition.instances.length - 1]; }
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeRecognition.instances = [];
});
afterEach(() => vi.useRealTimers());

const Ctor = FakeRecognition as unknown as ConstructorParameters<typeof Object>[0];

describe("useVoiceAnswer", () => {
  it("uses en-IN, ends after silence following speech, and reports timings", async () => {
    const { result } = renderHook(() => useVoiceAnswer({ recognitionCtor: Ctor }));
    let p!: Promise<VoiceAnswer>;
    act(() => { p = result.current.listen(); });
    const rec = FakeRecognition.last();
    expect(rec.lang).toBe("en-IN");
    expect(rec.continuous).toBe(true);
    expect(result.current.phase).toBe("listening");

    await act(async () => { vi.advanceTimersByTime(2000); });   // thinking pause before answering
    act(() => rec.say([["An inner join", false]]));
    await act(async () => { vi.advanceTimersByTime(3000); });   // mid-answer pause < SILENCE_MS
    act(() => rec.say([["An inner join returns matching rows", true, 0.8]]));
    expect(result.current.transcript).toBe("An inner join returns matching rows");
    await act(async () => { vi.advanceTimersByTime(SILENCE_MS + 10); });

    const a = await p;
    expect(a.text).toBe("An inner join returns matching rows");
    expect(a.meta).toMatchObject({ input_mode: "voice", stt_lang: "en-IN", ended_by: "silence", restarts: 0, avg_confidence: 0.8 });
    expect(a.meta.response_latency_ms).toBeGreaterThanOrEqual(2000);
    expect(a.meta.max_pause_ms).toBeGreaterThanOrEqual(3000);
    expect(result.current.phase).toBe("idle");
  });

  it("finishes immediately when the student taps Done", async () => {
    const { result } = renderHook(() => useVoiceAnswer({ recognitionCtor: Ctor }));
    let p!: Promise<VoiceAnswer>;
    act(() => { p = result.current.listen(); });
    act(() => FakeRecognition.last().say([["Polymorphism means many forms", false]]));
    act(() => result.current.finishAnswer());
    const a = await p;
    expect(a.text).toBe("Polymorphism means many forms"); // interim text is kept
    expect(a.meta.ended_by).toBe("button");
  });

  it("restarts when Chrome ends the session on its own and keeps the earlier words", async () => {
    const { result } = renderHook(() => useVoiceAnswer({ recognitionCtor: Ctor }));
    let p!: Promise<VoiceAnswer>;
    act(() => { p = result.current.listen(); });
    const first = FakeRecognition.last();
    act(() => first.say([["Encapsulation hides data", true]]));
    act(() => first.onend?.()); // browser-initiated end
    const second = FakeRecognition.last();
    expect(second).not.toBe(first);
    expect(second.started).toBe(true);
    act(() => second.say([["using private fields", true]]));
    act(() => result.current.finishAnswer());
    const a = await p;
    expect(a.text).toBe("Encapsulation hides data using private fields");
    expect(a.meta.restarts).toBe(1);
  });

  it("returns empty text if the student never speaks", async () => {
    const { result } = renderHook(() => useVoiceAnswer({ recognitionCtor: Ctor }));
    let p!: Promise<VoiceAnswer>;
    act(() => { p = result.current.listen(); });
    await act(async () => { vi.advanceTimersByTime(NO_SPEECH_MS + 10); });
    const a = await p;
    expect(a.text).toBe("");
    expect(a.meta.response_latency_ms).toBeNull();
  });

  it("rejects with a clear message when the mic is blocked", async () => {
    const { result } = renderHook(() => useVoiceAnswer({ recognitionCtor: Ctor }));
    let p!: Promise<unknown>;
    act(() => { p = result.current.listen(); });
    act(() => FakeRecognition.last().onerror?.({ error: "not-allowed" }));
    await expect(p).rejects.toThrow(/Microphone access is blocked/);
  });

  it("reports unsupported browsers", async () => {
    const { result } = renderHook(() => useVoiceAnswer({ recognitionCtor: null }));
    expect(result.current.supported).toBe(false);
    await expect(result.current.listen()).rejects.toThrow(/isn't supported/);
  });
});

describe("pickVoice", () => {
  const v = (name: string, lang: string) => ({ name, lang }) as SpeechSynthesisVoice;
  it("prefers an Indian-English voice", () => {
    expect(pickVoice([v("Google US English", "en-US"), v("Microsoft Heera", "en-IN")])!.name).toBe("Microsoft Heera");
    expect(pickVoice([v("Google US English", "en-US"), v("Hindi", "hi-IN")])!.name).toBe("Google US English");
  });
});
