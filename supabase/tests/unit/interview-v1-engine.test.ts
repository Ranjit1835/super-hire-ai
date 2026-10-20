// @vitest-environment node
// Interview V1: template building and the section state machine (transitions, follow-up policy, coverage,
// time-boxes). Pure; no database or model.
import { describe, it, expect } from "vitest";
import { buildTemplate, compatModuleSpec, sectionBoundaries, skillsFrom, type InterviewTemplate } from "../../functions/_shared/interview-v1/template";
import {
  applyV1, initV1State, planV1, pickSkill, unprobedMustHaves, MAX_V1_TURNS,
  type V1Proposal, type V1State,
} from "../../functions/_shared/interview-v1/engine";
import { isInterviewState } from "../../functions/_shared/interview-engine";

const matrix = {
  must_have: [{ skill: "Java", weight: 5 }, { skill: "SQL", weight: 4 }, { skill: "REST APIs", weight: 3 }],
  nice_to_have: [{ skill: "Docker", weight: 2 }],
  seniority: "junior",
};
const walk = { attemptId: "a1", questionTitle: "Pair sum", statement: "Count pairs", language: "python", code: "print(1)", passed: 3, total: 5 };

const role = (over: Partial<Parameters<typeof buildTemplate>[0]> = {}) =>
  buildTemplate({ context: "job_role", title: "Backend Engineer", skillsMatrix: matrix, walkthrough: walk, ...over });

const prop = (signal: V1Proposal["answer_signal"], kind: V1Proposal["move_kind"] = "new", question = "Next question?"): V1Proposal =>
  ({ answer_signal: signal, answer_score: 5, move_kind: kind, question });

/** One turn as the edge function runs it; the model always writes the question for the branch it rated. */
function turn(s: V1State, t: InterviewTemplate, signal: V1Proposal["answer_signal"] | null, elapsed: number) {
  const plan = planV1(s, t, elapsed);
  const move = signal ? plan.branches[signal] : plan.branches.adequate;
  return applyV1(s, t, plan, signal ? prop(signal, move?.kind ?? "new") : null, elapsed);
}

describe("template", () => {
  it("job role: skills matrix with weights, all sections incl. code walkthrough, time-boxes add up", () => {
    const t = role();
    expect(t.skills).toEqual([
      { skill: "Java", weight: 5, must: true }, { skill: "SQL", weight: 4, must: true },
      { skill: "REST APIs", weight: 3, must: true }, { skill: "Docker", weight: 2, must: false },
    ]);
    expect(t.sections.map((s) => s.key)).toEqual(["intro", "technical", "problem_solving", "behavioral", "code_walkthrough", "candidate_questions"]);
    expect(t.durationMin).toBe(20);
    const total = t.sections.reduce((a, s) => a + s.seconds, 0);
    expect(Math.abs(total - 1200)).toBeLessThan(10);
    expect(sectionBoundaries(t).at(-1)).toBe(total);
    expect(t.doubleScore).toBe(false);
  });

  it("drive: module topics become must-have skills (self-intro excluded); no walkthrough without a submission", () => {
    const t = buildTemplate({ context: "drive", title: "CSE drive", moduleSpec: { topics: ["Self-introduction", "OOP", "DBMS"], max_minutes: 15 } });
    expect(t.skills.map((s) => [s.skill, s.must])).toEqual([["OOP", true], ["DBMS", true]]);
    expect(t.sections.map((s) => s.key)).not.toContain("code_walkthrough");
    expect(t.durationMin).toBe(15);
    expect(t.seniority).toBe("fresher");
    expect(compatModuleSpec(t)).toMatchObject({ name: "CSE drive", type: "skill", topics: ["OOP", "DBMS"], max_minutes: 15 });
  });

  it("track E config: chosen sections, duration, difficulty, double scoring, walkthrough off", () => {
    const t = role({ config: { duration_min: 30, sections: ["technical", "behavioral"], difficulty: "hard", double_score: true, code_walkthrough: false } });
    expect(t.sections.map((s) => s.key)).toEqual(["intro", "technical", "behavioral"]);
    expect(t.durationMin).toBe(30);
    expect(t.startDifficulty).toBe("advanced");
    expect(t.doubleScore).toBe(true);
    expect(t.walkthrough).toBeNull();
    expect(buildTemplate({ context: "drive", title: "x", moduleSpec: { topics: ["OOP"] }, config: { double_score: true } }).doubleScore).toBe(false);
  });

  it("dedupes skills and caps weights", () => {
    expect(skillsFrom({ skillsMatrix: { must_have: [{ skill: "Java", weight: 9 }, { skill: "java", weight: 1 }], nice_to_have: [] } }))
      .toEqual([{ skill: "Java", weight: 5, must: true }]);
  });
});

describe("state machine", () => {
  it("initial state is a pilot-compatible InterviewState in the intro section", () => {
    const s = initV1State(role(), "m1");
    expect(isInterviewState(s)).toBe(true);
    expect(s).toMatchObject({ current_topic: "Introduction", turn_count: 0, v1: { section_index: 0, section_questions: 1 } });
  });

  it("intro → technical on the highest-weight must-have", () => {
    const t = role();
    const o = turn(initV1State(t, null), t, "adequate", 60);
    expect(o.move).toMatchObject({ kind: "new", section: "technical", skill: "Java", newSection: true });
    expect(o.state.v1).toMatchObject({ section_index: 1, section_questions: 1, followups: 0, probed: { Java: 1 } });
    expect(o.state.current_topic).toBe("Java");
    expect(o.state.topics_covered).toEqual(["Java"]);
  });

  it("follow-ups: strong → deeper (harder), weak → one basics probe (easier), then move on; max N per thread", () => {
    const t = role({ config: { duration_min: 40 } });
    let s = turn(initV1State(t, null), t, "adequate", 60).state;               // Java asked
    let o = turn(s, t, "strong", 120);
    expect(o.move).toMatchObject({ kind: "deeper", skill: "Java", difficulty: "intermediate" });
    o = turn(o.state, t, "strong", 180);
    expect(o.move).toMatchObject({ kind: "deeper", skill: "Java", difficulty: "advanced" });
    o = turn(o.state, t, "strong", 240);                                        // 2 follow-ups used → new skill
    expect(o.move).toMatchObject({ kind: "new", skill: "SQL" });
    s = o.state;
    o = turn(s, t, "weak", 300);
    expect(o.move).toMatchObject({ kind: "basics", skill: "SQL" });
    expect(o.state.difficulty).toBe("intermediate");
    o = turn(o.state, t, "weak", 360);                                          // no second basics probe in a row
    expect(o.move).toMatchObject({ kind: "new", skill: "REST APIs" });
    o = turn(o.state, t, "adequate", 420);                                      // 6 questions = section cap → next section
    expect(o.move).toMatchObject({ kind: "new", section: "problem_solving", newSection: true });
  });

  it("coverage: no follow-ups while the time left only fits the unprobed must-haves", () => {
    const t = role({ config: { duration_min: 10 } });
    const s = turn(initV1State(t, null), t, "adequate", 40).state;             // Java asked; SQL + REST unprobed
    expect(unprobedMustHaves(s, t)).toEqual(["SQL", "REST APIs"]);
    expect(turn(s, t, "strong", 60).move?.kind).toBe("deeper");                // enough time: follow up
    const o = turn(s, t, "strong", 100);
    expect(o.move).toMatchObject({ kind: "new", skill: "SQL" });               // would have been "deeper" with more time
  });

  it("every must-have is probed before nice-to-haves and before the section ends", () => {
    const t = role({ config: { duration_min: 30 } });
    let s = initV1State(t, null);
    const asked: string[] = [];
    for (let i = 0, el = 30; i < 6; i++, el += 60) {
      const o = turn(s, t, "adequate", el);
      if (o.move?.section === "technical" && o.move.kind === "new") asked.push(o.move.skill!);
      s = o.state;
    }
    expect(asked.slice(0, 3)).toEqual(["Java", "SQL", "REST APIs"]);
    expect(pickSkill(s, t)).not.toBeNull();
  });

  it("hard time-box: the technical section ends at its boundary even mid-thread", () => {
    const t = role();
    const s = turn(initV1State(t, null), t, "adequate", 30).state;
    const techEnd = sectionBoundaries(t)[1];
    const o = turn(s, t, "strong", techEnd - 10);
    expect(o.move).toMatchObject({ section: "problem_solving", newSection: true });
  });

  it("sections whose time-box has passed are skipped", () => {
    const t = role();
    const s = turn(initV1State(t, null), t, "adequate", 30).state;
    const b = sectionBoundaries(t);
    const o = turn(s, t, "adequate", b[3] - 5);                                 // problem solving + behavioural gone
    expect(o.move?.section).toBe("code_walkthrough");
  });

  it("ends after the last section, on time and at the safety cap", () => {
    const t = buildTemplate({ context: "drive", title: "x", moduleSpec: { topics: ["OOP"] }, config: { sections: ["candidate_questions"] } });
    let s = initV1State(t, null);
    let o = turn(s, t, "adequate", 30);
    expect(o.move?.section).toBe("candidate_questions");
    o = turn(o.state, t, "adequate", 90);
    expect(o).toMatchObject({ endReason: "topics_covered", move: null });
    s = initV1State(t, null);
    expect(turn(s, t, "adequate", t.durationMin * 60 - 20).endReason).toBe("time_limit");
    expect(turn({ ...s, turn_count: MAX_V1_TURNS - 1 }, t, "adequate", 30).endReason).toBe("max_turns");
  });

  it("model unavailable: counted unrated, moves on as if adequate; a question written for another branch is dropped", () => {
    const t = role();
    const s = turn(initV1State(t, null), t, "adequate", 60).state;
    const o = turn(s, t, null, 90);
    expect(o.move?.kind).toBe("new");
    expect(o.question).toBeNull();
    expect(o.state.per_topic_signal.Java).toMatchObject({ asked: 1, strong: 0, adequate: 0, weak: 0, scores: [] });
    const plan = planV1(s, t, 90);
    const mismatch = applyV1(s, t, plan, prop("strong", "new", "Tell me about SQL"), 90);
    expect(mismatch.move?.kind).toBe("deeper");
    expect(mismatch.question).toBeNull();
    expect(mismatch.overrides).toContain("move_mismatch:new->deeper");
  });

  it("never mutates the input state", () => {
    const t = role();
    const s = initV1State(t, null);
    const copy = structuredClone(s);
    turn(s, t, "strong", 60);
    expect(s).toEqual(copy);
  });
});
