import { describe, it, expect } from "vitest";
// @ts-expect-error plain .mjs data module
import { MCQS, CODING } from "../../../scripts/seed/global-bank.mjs";
import { repeats } from "../../functions/_shared/question-dedupe";

interface Mcq { title: string; statement: string; category: string; topics: string[]; options: { id: string; text: string }[]; answer: string[]; difficulty: string }
interface Coding { title: string; statement: string; difficulty: string; topics: string[]; tests: { input: string; expected_output: string; is_sample: boolean }[]; reference: string }

describe("global question bank seed (owner, 2026-11-10)", () => {
  const all = [...(MCQS as Mcq[]), ...(CODING as Coding[])];

  it("has no repeated question, by the same rule as AI generation", () => {
    all.forEach((q, i) => expect(repeats(q, all.slice(0, i)), q.title).toBeNull());
  });

  it("every MCQ's answer is one of its options, and only select-all questions have several", () => {
    for (const q of MCQS as Mcq[]) {
      const ids = q.options.map((o) => o.id);
      expect(new Set(ids).size, q.title).toBe(ids.length);
      expect(new Set(q.options.map((o) => o.text)).size, q.title).toBe(ids.length);       // no duplicate options
      expect(q.answer.length, q.title).toBeGreaterThan(0);
      for (const a of q.answer) expect(ids, q.title).toContain(a);
      expect(q.answer.length > 1, q.title).toBe(/select all/i.test(q.statement));
      expect(["aptitude", "cs_fundamentals", "technical"]).toContain(q.category);
      expect(["easy", "medium", "hard"]).toContain(q.difficulty);
      expect(q.topics.length, q.title).toBeGreaterThan(0);
    }
  });

  it("covers every area with enough questions to build real tests", () => {
    const by = (c: string) => (MCQS as Mcq[]).filter((q) => q.category === c).length;
    expect(by("aptitude")).toBeGreaterThanOrEqual(25);
    expect(by("cs_fundamentals")).toBeGreaterThanOrEqual(25);
    expect(by("technical")).toBeGreaterThanOrEqual(5);
  });

  it("coding questions have samples, hidden tests and a reference solution", () => {
    for (const c of CODING as Coding[]) {
      expect(c.tests.filter((t) => t.is_sample).length, c.title).toBeGreaterThanOrEqual(2);
      expect(c.tests.filter((t) => !t.is_sample).length, c.title).toBeGreaterThanOrEqual(2);
      expect(c.reference.length).toBeGreaterThan(20);
    }
  });
});
