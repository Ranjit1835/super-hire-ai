import { describe, it, expect } from "vitest";
import { newVad, vadStep, VAD_MIN_THRESHOLD } from "./cloudVoice";
import { NO_SPEECH_MS, SILENCE_MS } from "@/features/b2b/hooks/useVoiceAnswer";

/** Feed `ms` of frames at level `rms` (50 ms frames); returns the first end signal, if any. */
function feed(v: ReturnType<typeof newVad>, clock: { t: number }, ms: number, rms: number) {
  for (let i = 0; i < ms / 50; i++) {
    clock.t += 50;
    const r = vadStep(v, rms, clock.t, 0);
    if (r) return r;
  }
  return null;
}

describe("answer detection (Phase 3 cloud voice)", () => {
  it("learns the room noise, hears speech, and ends after the silence window", () => {
    const v = newVad(); const c = { t: 0 };
    expect(feed(v, c, 500, 0.004)).toBeNull();                     // a quiet room
    expect(feed(v, c, 3000, 0.08)).toBeNull();                      // speaking
    expect(v.firstSpeech).not.toBeNull();
    expect(feed(v, c, 2000, 0.004)).toBeNull();                     // thinking pause shorter than the window
    expect(feed(v, c, 2000, 0.08)).toBeNull();                      // speaks again
    expect(v.maxPause).toBeGreaterThanOrEqual(2000);
    expect(feed(v, c, SILENCE_MS + 100, 0.004)).toBe("silence");
  });

  it("a click or a cough isn't speech", () => {
    const v = newVad(); const c = { t: 0 };
    feed(v, c, 400, 0.004);
    feed(v, c, 100, 0.2);                                           // 2 frames
    feed(v, c, 500, 0.004);
    expect(v.firstSpeech).toBeNull();
  });

  it("a soft-spoken candidate is still heard after a quiet start", () => {
    const v = newVad(); const c = { t: 0 };
    feed(v, c, 400, 0.006);
    feed(v, c, 4000, 0.011);                                        // murmuring below the bar for a while
    feed(v, c, 600, 0.02);                                          // then speaks softly
    expect(v.firstSpeech).not.toBeNull();
  });

  it("gives up when nothing is said, and a noisy room raises the bar", () => {
    const quiet = newVad(); const c = { t: 0 };
    expect(feed(quiet, c, NO_SPEECH_MS + 200, 0.003)).toBe("no_speech");
    const fan = newVad(); const c2 = { t: 0 };
    feed(fan, c2, 400, 0.03);                                       // a fan at 0.03
    feed(fan, c2, 1000, 0.05);                                      // barely above the fan: not speech
    expect(fan.firstSpeech).toBeNull();
    feed(fan, c2, 1000, 0.2);
    expect(fan.firstSpeech).not.toBeNull();
    expect(VAD_MIN_THRESHOLD).toBeGreaterThan(0);
  });
});
