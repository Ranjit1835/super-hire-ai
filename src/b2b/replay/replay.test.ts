import { describe, it, expect } from "vitest";
import { buildReplay, positionAt, type ReplayEvent, type ReplayQuestion } from "./replay";

const q = (events: ReplayEvent[], over: Partial<ReplayQuestion> = {}): ReplayQuestion => ({
  question_id: "q1", title: "Two sum", languages: ["python", "java"], starter_code: { python: "", java: "class A {}" },
  final_language: "python", final_code: null, events, truncated: false, ...over,
});
/** Types `text` one character at a time from `at`, `ms` apart, starting at `t`. */
const typeOut = (text: string, at: number, t: number, ms = 200): ReplayEvent[] =>
  [...text].map((c, i) => ({ t: t + i * ms, op: "ins", at: at + i, text: c }));

describe("code replay (R2.7)", () => {
  it("rebuilds the answer key by key and ends exactly at the saved code", () => {
    const ev = [...typeOut("def f():", 0, 1000), { t: 5000, op: "del", at: 4, len: 1 }, { t: 5100, op: "ins", at: 4, text: "g" }];
    const r = buildReplay(q(ev, { final_code: "def g():" }));
    expect(r.exact).toBe(true);
    expect(r.at(0).code).toBe("");
    expect(r.at(3).code).toBe("def");
    expect(r.at(r.length).code).toBe("def g():");
    expect(r.flags).toEqual([]);
    expect(r.stats).toMatchObject({ typedChars: 9, deletedChars: 1 });
  });

  it("follows language switches; each language keeps its own buffer from the starter code", () => {
    const ev: ReplayEvent[] = [
      ...typeOut("x", 0, 1000),
      { t: 2000, op: "lang", text: "java" },
      { t: 2100, op: "ins", at: 9, text: " " },
      { t: 2200, op: "lang", text: "python" },
      { t: 2300, op: "ins", at: 1, text: "y" },
    ];
    const r = buildReplay(q(ev, { final_code: "xy" }));
    expect(r.at(3)).toEqual({ lang: "java", code: "class A { }" });
    expect(r.at(r.length)).toEqual({ lang: "python", code: "xy" });
    expect(r.exact).toBe(true);
  });

  it("flags code that appears at once, but not copying the student's own code", () => {
    const sol = "def solve(nums, target):\n    seen = {}\n    for i, n in enumerate(nums):\n        if target - n in seen:\n            return [seen[target - n], i]\n        seen[n] = i\n";
    const r = buildReplay(q([{ t: 60_000, op: "ins", at: 0, text: sol }], { final_code: sol }));
    expect(r.flags.map((f) => f.kind)).toContain("large_insert");
    expect(r.flags.find((f) => f.kind === "large_insert")).toMatchObject({ index: 0, severity: "high" });

    const typed = typeOut(sol, 0, 0, 300);
    const dup = buildReplay(q([...typed, { t: 999_999, op: "ins", at: sol.length, text: sol }], { final_code: sol + sol }));
    expect(dup.flags.map((f) => f.kind)).not.toContain("large_insert");
  });

  it("flags typing faster than a person can, once per burst", () => {
    const fast = typeOut("a".repeat(400), 0, 0, 10);      // 100 chars/s
    const r = buildReplay(q(fast, { final_code: "a".repeat(400) }));
    expect(r.flags.filter((f) => f.kind === "fast_typing")).toHaveLength(1);
    const human = buildReplay(q(typeOut("a".repeat(400), 0, 0, 150), { final_code: "a".repeat(400) }));
    expect(human.flags).toEqual([]);
  });

  it("flags answers that were mostly not typed, and blocked pastes", () => {
    const chunk = (i: number) => `line_${i} = compute_something_long(${i})\n`;   // under the large-insert size
    const ev: ReplayEvent[] = Array.from({ length: 10 }, (_, i) => ({ t: i * 20_000, op: "ins", at: i * chunk(0).length, text: chunk(i) }));
    ev.push({ t: 300_000, op: "paste_blocked", len: 500 });
    const final = Array.from({ length: 10 }, (_, i) => chunk(i)).join("");
    const r = buildReplay(q(ev, { final_code: final }));
    expect(r.flags.map((f) => f.kind)).toEqual(["little_typing", "paste_blocked"]);
  });

  it("says so when the log doesn't end at the saved answer", () => {
    expect(buildReplay(q(typeOut("abc", 0, 0), { final_code: "abcd" })).exact).toBe(false);
    expect(buildReplay(q([{ t: 0, op: "del", at: 5, len: 2 }], { final_code: "" })).exact).toBe(false);
    expect(buildReplay(q(typeOut("abc", 0, 0), { final_code: "abc", truncated: true })).exact).toBe(false);
  });

  it("shortens long pauses in playback and finds positions by time", () => {
    const r = buildReplay(q([...typeOut("ab", 0, 0, 100), ...typeOut("c", 2, 600_000)], { final_code: "abc" }));
    expect(r.playT).toEqual([0, 0, 100, 3100]);
    expect(positionAt(r.playT, 50)).toBe(1);
    expect(positionAt(r.playT, 3000)).toBe(2);
    expect(positionAt(r.playT, 99_999)).toBe(3);
    expect(r.stats.durationMs).toBe(600_000);
  });

  it("replays long logs from checkpoints with the same result", () => {
    const text = "x".repeat(1000);
    const r = buildReplay(q(typeOut(text, 0, 0, 300), { final_code: text }));
    expect(r.at(457).code).toBe("x".repeat(457));
    expect(r.exact).toBe(true);
  });
});
