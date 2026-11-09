import { describe, it, expect } from "vitest";
import { createTurnTimer } from "./turn-latency";

function fakeClock() {
  let t = 0;
  return { now: () => t, at: (v: number) => { t = v; } };
}

describe("turn latency timer", () => {
  it("splits the gap from last speech to the next question's first audio", () => {
    const c = fakeClock();
    const timer = createTurnTimer(c.now);
    c.at(1000); timer.heard();
    c.at(3500); timer.closed();   // 2.5 s silence timeout
    c.at(3510); timer.sent();
    c.at(7510); timer.replied();  // 4 s request
    c.at(7900); timer.audible();  // 0.39 s TTS start
    expect(timer.take()).toEqual({
      turn_end_to_first_audio_ms: 6900, silence_wait_ms: 2500, request_ms: 4000, audio_start_ms: 390,
    });
    expect(timer.take()).toBeNull(); // reported once
  });

  it("ignores audio that didn't follow a reply (re-prompts, replaying the question)", () => {
    const c = fakeClock();
    const timer = createTurnTimer(c.now);
    c.at(100); timer.heard();
    c.at(200); timer.closed();
    c.at(300); timer.audible(); // "I didn't catch that" — no request was made
    expect(timer.take()).toBeNull();
  });

  it("uses the close time when no speech time is known, and drops absurd gaps", () => {
    const c = fakeClock();
    const timer = createTurnTimer(c.now);
    c.at(0); timer.closed(); timer.sent();
    c.at(1000); timer.replied();
    c.at(1200); timer.audible();
    expect(timer.take()).toMatchObject({ turn_end_to_first_audio_ms: 1200, silence_wait_ms: 0 });

    c.at(0); timer.heard(); timer.closed(); timer.sent();
    c.at(10 * 60 * 1000); timer.replied(); timer.audible(); // laptop slept
    expect(timer.take()).toBeNull();
  });

  it("an explicit heard time can be back-dated (answer closed by a known silence timeout)", () => {
    const c = fakeClock();
    const timer = createTurnTimer(c.now);
    c.at(10_000); timer.heard(5_000); timer.closed(); timer.sent();
    c.at(11_000); timer.replied();
    c.at(11_500); timer.audible();
    expect(timer.take()).toMatchObject({ turn_end_to_first_audio_ms: 6500, silence_wait_ms: 5000 });
  });
});
