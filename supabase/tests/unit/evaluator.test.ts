// @vitest-environment node
import { describe, it, expect } from "vitest";
import { computeAudioMetrics, countFillers } from "../../functions/_shared/audio-metrics";
import {
  DIMENSIONS, buildEvaluatorMessage, buildEvaluatorSystemPrompt, evaluatorTool, quoteIsGrounded, normalizeForMatch,
  readinessFromScores, validateEvaluation, type Dimension, type ScoredItem,
} from "../../functions/_shared/evaluator";
import type { ModuleSpec } from "../../functions/_shared/module-spec";

const spec: ModuleSpec = { name: "SQL", type: "skill", topics: ["Joins", "Indexes", "Transactions"], pass_threshold: 6, max_turns: 8, max_minutes: 15 };
const answers = [
  "An inner join returns only the rows that match in both tables, like employees and departments.",
  "Um basically an index is like a book index, it makes the search faster but actually slows down inserts.",
  "I don't know about transactions.",
];

describe("audio metrics", () => {
  it("counts fillers as words, treats 'you know' as a phrase and ignores 'like' used as a verb", () => {
    expect(countFillers("Um, uh, basically I like Java, like, you know, actually. Umm")).toEqual({
      um: 2, uh: 1, like: 1, basically: 1, actually: 1, "you know": 1,
    });
    expect(countFillers("I would like to join").like).toBe(0);
    expect(countFillers("Summary and uhuru").um).toBe(0); // whole words only
  });

  it("computes wpm, pauses and length by difficulty from voice timings; excludes typed answers from timing", () => {
    const m = computeAudioMetrics([
      { content: "one two three four five six seven eight nine ten", difficulty: "beginner", meta: { input_mode: "voice", speech_ms: 5000, response_latency_ms: 2000, max_pause_ms: 800 } },
      { content: "one two three four five six seven eight nine ten", difficulty: "intermediate", meta: { input_mode: "voice", speech_ms: 5000, response_latency_ms: 6000, max_pause_ms: 3000 } },
      { content: "typed answer with five", difficulty: "intermediate", meta: { input_mode: "text" } },
    ]);
    expect(m).toMatchObject({
      voice_answers: 2, text_answers: 1, words_total: 24, words_per_minute: 120,
      avg_pause_before_answer_ms: 4000, max_pause_before_answer_ms: 6000, max_pause_within_answer_ms: 3000,
      avg_answer_words_by_difficulty: { beginner: 10, intermediate: 7, advanced: null }, filler_reliability: "low",
    });
    expect(m.notes.join(" ")).toMatch(/1 answer\(s\) were typed/);
  });

  it("handles an all-typed interview", () => {
    const m = computeAudioMetrics([{ content: "abc def ghi", difficulty: "beginner", meta: { input_mode: "text" } }]);
    expect(m.words_per_minute).toBeNull();
    expect(m.avg_pause_before_answer_ms).toBeNull();
    expect(m.notes[0]).toMatch(/All answers were typed/);
  });
});

describe("grounding", () => {
  const norm = normalizeForMatch(answers.join(" "));
  it("accepts exact quotes regardless of punctuation/case and ellipsis-joined parts", () => {
    expect(quoteIsGrounded("returns only the rows that match in both tables", norm)).toBe(true);
    expect(quoteIsGrounded("An INNER join returns only the rows... slows down inserts", norm)).toBe(true);
  });
  it("rejects invented or too-short quotes", () => {
    expect(quoteIsGrounded("a left join keeps all rows from the left table", norm)).toBe(false);
    expect(quoteIsGrounded("inner join", norm)).toBe(false);
  });
});

const item = (score: number, evidence: string[], insufficient = false) => ({ insufficient_data: insufficient, score, evidence, reason: "Because." });
function modelOutput(over: Record<string, unknown> = {}) {
  return {
    dimensions: Object.fromEntries(DIMENSIONS.map((d) => [d, item(7, ["returns only the rows that match in both tables"])])),
    per_topic: [
      { topic: "Joins", ...item(8, ["An inner join returns only the rows"]) },
      { topic: "indexes", ...item(6, ["makes the search faster but actually slows down inserts"]) },
      { topic: "Transactions", ...item(0, [], true) },
    ],
    primary_gap: "Doesn't know transactions.",
    readiness_level: "ready",
    recommended_focus: ["ACID properties", "Commit and rollback"],
    ...over,
  };
}

describe("validateEvaluation", () => {
  it("returns the specified shape, keyed per topic, with derived overall score and readiness", () => {
    const { result, errors } = validateEvaluation(modelOutput(), spec, answers);
    expect(errors).toEqual([]);
    expect(Object.keys(result!.dimensions)).toEqual([...DIMENSIONS]);
    expect(result!.dimensions.technical_knowledge).toEqual({ score: 7, evidence: ["returns only the rows that match in both tables"], reason: "Because." });
    expect(result!.per_topic.Indexes.score).toBe(6); // matched case-insensitively
    expect(result!.per_topic.Transactions).toEqual({ score: "insufficient_data", evidence: [], reason: "Because." });
    expect(result!.overall_score).toBe(7);
    expect(result!.passed).toBe(true);
    expect(result!.readiness_level).toBe("ready");
  });

  it("turns a score with only invented quotes into insufficient_data and counts the dropped quotes", () => {
    const out = modelOutput();
    (out.dimensions as Record<string, unknown>).problem_solving = item(9, ["I would use a hash map to solve this in linear time"]);
    const { result } = validateEvaluation(out, spec, answers);
    expect(result!.dimensions.problem_solving.score).toBe("insufficient_data");
    expect(result!.dimensions.problem_solving.reason).toMatch(/No verifiable quote/);
    expect(result!.dropped_evidence).toBe(1);
  });

  it("reports schema errors so the caller can retry", () => {
    const bad = modelOutput({ readiness_level: "maybe", recommended_focus: [] });
    delete (bad.dimensions as Record<string, unknown>).confidence;
    (bad.per_topic as unknown[]).push({ topic: "Kubernetes", ...item(5, []) });
    const { result, errors } = validateEvaluation(bad, spec, answers);
    expect(result).toBeNull();
    expect(errors).toEqual(expect.arrayContaining([
      "dimensions.confidence missing",
      "per_topic[3].topic must be one of the module topics",
      "readiness_level must be not_ready | developing | ready",
      "recommended_focus needs 1–4 items",
    ]));
  });

  it("fills topics the model skipped as not assessed", () => {
    const out = modelOutput({ per_topic: [{ topic: "Joins", ...item(8, ["An inner join returns only the rows"]) }] });
    const { result } = validateEvaluation(out, spec, answers);
    expect(result!.per_topic.Indexes).toEqual({ score: "insufficient_data", evidence: [], reason: "Not assessed in this interview." });
  });

  it("derives readiness by rule, overriding an inconsistent model label", () => {
    const low = modelOutput({ dimensions: Object.fromEntries(DIMENSIONS.map((d) => [d, item(3, ["returns only the rows that match in both tables"])])) });
    const { result } = validateEvaluation(low, spec, answers);
    expect(result!.readiness_level).toBe("not_ready");
    expect(result!.model_readiness_level).toBe("ready");
  });
});

describe("readinessFromScores", () => {
  const dims = (scores: Partial<Record<Dimension, number | "insufficient_data">>, fill: number | "insufficient_data" = 7) =>
    Object.fromEntries(DIMENSIONS.map((d) => [d, { score: scores[d] ?? fill, evidence: [], reason: "" }])) as Record<Dimension, ScoredItem>;
  it("requires core dimensions near the pass mark to call someone ready", () => {
    expect(readinessFromScores(dims({}), 6).readiness).toBe("ready");
    expect(readinessFromScores(dims({ technical_knowledge: 3 }), 6).readiness).toBe("developing");
    expect(readinessFromScores(dims({}, 3), 6).readiness).toBe("not_ready");
    expect(readinessFromScores(dims({}, 5), 6).readiness).toBe("developing");
  });
  it("defers to the model when fewer than 3 dimensions could be scored", () => {
    expect(readinessFromScores(dims({ technical_knowledge: 8, communication: 8 }, "insufficient_data"), 6)).toEqual({ readiness: null, overall: 8 });
  });
});

describe("prompt", () => {
  it("includes the STT caveat, evidence rules, metrics and a topic enum", () => {
    const sys = buildEvaluatorSystemPrompt();
    expect(sys).toMatch(/Indian-accented English/);
    expect(sys).toMatch(/penalise only clear conceptual mistakes/);
    expect(sys).toMatch(/copied EXACTLY from the student's answers/);
    const msg = buildEvaluatorMessage(spec, [
      { turn: 1, role: "interviewer", content: "What is a join?", topic: "Joins" }, { turn: 1, role: "student", content: answers[0] },
    ], computeAudioMetrics([{ content: answers[0], difficulty: "beginner", meta: { input_mode: "voice", speech_ms: 6000, response_latency_ms: 1500 } }]), "max_turns");
    expect(msg).toContain("Q1 [Joins]: What is a join?");
    expect(msg).toContain("A1: An inner join");
    expect(msg).toMatch(/speaking rate: \d+ wpm/);
    expect(evaluatorTool(spec.topics).parameters).toMatchObject({ properties: { per_topic: { items: { properties: { topic: { enum: spec.topics } } } } } });
  });
});
