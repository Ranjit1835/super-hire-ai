// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  applyTurn, initState, maxQuestionsPerTopic, planTurn, stepDifficulty,
  type InterviewState, type TurnProposal,
} from "../../functions/_shared/interview-engine";
import type { ModuleSpec } from "../../functions/_shared/module-spec";

const spec: ModuleSpec = {
  name: "SQL", type: "skill", topics: ["Joins", "Subqueries", "Indexes", "Transactions"],
  pass_threshold: 6, max_turns: 8, max_minutes: 15,
};

const propose = (over: Partial<TurnProposal> = {}): TurnProposal => ({
  answer_signal: "adequate", answer_score: 6, topic_covered: false, next_topic: "Joins",
  question: "Can you explain a left join with an example?", ...over,
});

/** Drive one turn the way the edge function does. */
function turn(s: InterviewState, p: TurnProposal | null, elapsed = 60, sp = spec) {
  const plan = planTurn(s, sp, elapsed);
  return { plan, ...applyTurn(s, sp, plan, p) };
}

describe("initState", () => {
  it("starts on the first topic at beginner with the rest remaining", () => {
    const s = initState("m1", spec);
    expect(s).toMatchObject({
      module_id: "m1", current_topic: "Joins", difficulty: "beginner", topics_covered: [],
      topics_remaining: ["Subqueries", "Indexes", "Transactions"], turn_count: 0, questions_on_topic: 1,
    });
    expect(Object.keys(s.per_topic_signal)).toEqual(spec.topics);
  });
});

describe("difficulty", () => {
  it("goes up after strong answers, down after weak ones, and stays in bounds", () => {
    expect(stepDifficulty("beginner", "strong")).toBe("intermediate");
    expect(stepDifficulty("intermediate", "strong")).toBe("advanced");
    expect(stepDifficulty("advanced", "strong")).toBe("advanced");
    expect(stepDifficulty("advanced", "weak")).toBe("intermediate");
    expect(stepDifficulty("beginner", "no_answer")).toBe("beginner");
    expect(stepDifficulty("intermediate", "adequate")).toBe("intermediate");
    expect(stepDifficulty("intermediate", "off_topic")).toBe("intermediate");
  });

  it("is applied from the answer signal regardless of what the model wanted", () => {
    const s = initState("m1", spec);
    const r = turn(s, propose({ answer_signal: "strong", next_topic: "Joins" }));
    expect(r.state.difficulty).toBe("intermediate");
    expect(r.next).toMatchObject({ topic: "Joins", difficulty: "intermediate" });
    expect(r.plan.difficultyIf.strong).toBe("intermediate");
  });
});

describe("topics", () => {
  it("follows up on the same topic, then moves on and records signals per topic", () => {
    let s = initState("m1", spec);
    let r = turn(s, propose({ answer_signal: "weak", answer_score: 3, next_topic: "Joins" }));
    expect(r.next?.topic).toBe("Joins");
    expect(r.state.questions_on_topic).toBe(2);
    s = r.state;
    r = turn(s, propose({ answer_signal: "strong", answer_score: 8, topic_covered: true, next_topic: "Subqueries", question: "What is a correlated subquery?" }));
    expect(r.next).toMatchObject({ topic: "Subqueries", question: "What is a correlated subquery?" });
    expect(r.state.topics_covered).toEqual(["Joins"]);
    expect(r.state.topics_remaining).toEqual(["Indexes", "Transactions"]);
    expect(r.state.per_topic_signal.Joins).toMatchObject({ asked: 2, strong: 1, weak: 1, scores: [3, 8], last: "strong" });
    expect(r.state.questions_on_topic).toBe(1);
  });

  it("never leaves the module: an invented topic is overridden and the question regenerated", () => {
    const r = turn(initState("m1", spec), propose({ next_topic: "Kubernetes", question: "Explain pods." }));
    expect(r.overrides).toContain("topic_not_allowed:Kubernetes");
    expect(spec.topics).toContain(r.next!.topic);
    expect(r.next!.question).toBeNull(); // caller must regenerate for the chosen topic
  });

  it("matches topic names case-insensitively", () => {
    const r = turn(initState("m1", spec), propose({ next_topic: "  subqueries ", question: "Q?" }));
    expect(r.next).toMatchObject({ topic: "Subqueries", question: "Q?" });
    expect(r.overrides).toEqual([]);
  });

  it("forces a move once the per-topic cap is reached", () => {
    const cap = maxQuestionsPerTopic(spec); // 8 turns / 4 topics → 3
    expect(cap).toBe(3);
    let s = initState("m1", spec);
    for (let i = 0; i < cap - 1; i++) s = turn(s, propose({ next_topic: "Joins" })).state;
    const plan = planTurn(s, spec, 60);
    expect(plan.mustMoveOn).toBe(true);
    expect(plan.allowedTopics).not.toContain("Joins");
    const r = applyTurn(s, spec, plan, propose({ next_topic: "Joins" }));
    expect(r.next!.topic).toBe("Subqueries");
    expect(r.next!.question).toBeNull();
  });

  it("keeps enough turns to reach every remaining topic", () => {
    const tight: ModuleSpec = { ...spec, max_turns: 5 }; // 4 topics, 5 questions
    let s = initState("m1", tight);
    // After answer 1: 4 questions left for 3 untouched topics → one follow-up still fits.
    const r1 = turn(s, propose({ next_topic: "Joins" }), 60, tight);
    expect(r1.plan.mustMoveOn).toBe(false);
    expect(r1.next!.topic).toBe("Joins");
    // After answer 2: 3 left for 3 topics → must move on even though the model wants to stay.
    const r2 = turn(r1.state, propose({ next_topic: "Joins" }), 60, tight);
    expect(r2.plan.mustMoveOn).toBe(true);
    expect(r2.next!.topic).not.toBe("Joins");
    s = r2.state;
    const seen = new Set([s.current_topic, "Joins"]);
    while (true) {
      const r = turn(s, propose({ next_topic: s.current_topic }), 60, tight);
      if (!r.next) { expect(r.endReason).toBe("max_turns"); break; }
      seen.add(r.next.topic);
      s = r.state;
    }
    expect([...seen].sort()).toEqual([...tight.topics].sort());
  });

  it("moves on when the model repeats a topic it just said was covered", () => {
    const r = turn(initState("m1", spec), propose({ topic_covered: true, next_topic: "Joins" }));
    expect(r.overrides).toContain("covered_topic_repeated");
    expect(r.next!.topic).toBe("Subqueries");
  });
});

describe("ending", () => {
  it("ends at max turns without asking another question", () => {
    let s = initState("m1", spec);
    let r;
    let asked = 1;
    do {
      r = turn(s, propose({ next_topic: s.current_topic }));
      s = r.state;
      if (r.next) asked++;
    } while (r.next);
    expect(r.endReason).toBe("max_turns");
    expect(s.turn_count).toBe(spec.max_turns);
    expect(asked).toBe(spec.max_turns);
  });

  it("ends when there's not enough time for another question", () => {
    const r = turn(initState("m1", spec), propose(), spec.max_minutes * 60 - 20);
    expect(r.endReason).toBe("time_limit");
    expect(r.next).toBeNull();
    expect(r.state.turn_count).toBe(1);
  });

  it("ends early when every topic is covered", () => {
    const one: ModuleSpec = { ...spec, topics: ["Joins"], max_turns: 10 };
    const r = turn(initState("m1", one), propose({ topic_covered: true, next_topic: "Joins" }), 60, one);
    expect(r.endReason).toBe("topics_covered");
    expect(r.state.topics_covered).toEqual(["Joins"]);
  });

  it("still records the answer when the model call failed (null proposal)", () => {
    const r = turn(initState("m1", spec), null);
    expect(r.state.turn_count).toBe(1);
    expect(r.state.per_topic_signal.Joins).toMatchObject({ asked: 1, strong: 0, adequate: 0, weak: 0, scores: [], last: null });
    expect(r.state.difficulty).toBe("beginner");
    expect(r.next!.question).toBeNull();
    expect(spec.topics).toContain(r.next!.topic);
  });
});

describe("purity", () => {
  it("does not mutate the input state", () => {
    const s = initState("m1", spec);
    const snapshot = JSON.stringify(s);
    turn(s, propose({ answer_signal: "strong", topic_covered: true, next_topic: "Indexes" }));
    expect(JSON.stringify(s)).toBe(snapshot);
  });
});
