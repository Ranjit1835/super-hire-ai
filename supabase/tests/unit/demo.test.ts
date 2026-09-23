// @vitest-environment node
import { describe, it, expect } from "vitest";
import { DEMO_EMAIL_DOMAIN, generateDemo } from "../../../scripts/demo-lib";
import { normalizeModuleSpec } from "../../functions/_shared/module-spec";
import { normalizeForMatch, quoteIsGrounded } from "../../functions/_shared/evaluator";
import { summarize, batchSummary, type DashEval } from "../../../src/features/b2b/lib/dashboard";

const now = new Date("2026-10-15T12:00:00Z");
const d = generateDemo({ seed: 2026, now });

describe("demo dataset", () => {
  it("has ~40 clearly fictional students across 3 batches", () => {
    expect(d.org).toMatchObject({ name: "Demo Engineering College", is_demo: true, plan_id: "pilot" });
    expect(d.students).toHaveLength(40);
    expect(new Set(d.students.map((s) => s.full_name)).size).toBe(40);
    expect(new Set(d.students.map((s) => s.roll_no)).size).toBe(40);
    expect(d.students.every((s) => s.email.endsWith(`@${DEMO_EMAIL_DOMAIN}`))).toBe(true);
    expect(new Set(d.students.map((s) => s.batch_key))).toEqual(new Set(["cse-a", "cse-b", "ece"]));
  });

  it("uses valid module specs and only their topics", () => {
    for (const m of d.modules) expect(normalizeModuleSpec(m.spec).errors).toEqual({});
    for (const iv of d.interviews) {
      const spec = d.modules.find((m) => m.key === iv.module_key)!.spec;
      expect(iv.turns.every((t) => spec.topics.includes(t.topic))).toBe(true);
      expect(iv.turns.filter((t) => t.role === "student").length).toBeLessThanOrEqual(spec.max_turns);
    }
  });

  it("every evidence quote is grounded in that interview's answers (same rule as production)", () => {
    for (const iv of d.interviews) {
      const answers = normalizeForMatch(iv.turns.filter((t) => t.role === "student").map((t) => t.content).join(" \n "));
      const r = iv.evaluation.result;
      for (const item of [...Object.values(r.dimensions), ...Object.values(r.per_topic)]) {
        for (const q of item.evidence) expect(quoteIsGrounded(q, answers)).toBe(true);
        if (typeof item.score === "number") expect(item.evidence.length).toBeGreaterThan(0);
      }
      expect(r.dropped_evidence).toBe(0);
    }
  });

  it("dates are in the past five weeks, oldest interview first per student", () => {
    for (const iv of d.interviews) {
      const t = Date.parse(iv.started_at);
      expect(t).toBeLessThan(now.getTime());
      expect(now.getTime() - t).toBeLessThan(40 * 86_400_000);
      expect(Date.parse(iv.completed_at)).toBeGreaterThan(t);
    }
  });

  it("produces a believable batch: every readiness level, some not attempted, and visible improvement", () => {
    const roster = d.students.map((s) => ({ user_id: s.key, full_name: s.full_name, roll_no: s.roll_no, email: s.email, batch_id: s.batch_key, batch_name: s.batch_key, department: "CSE" }));
    const evals: DashEval[] = d.interviews.map((iv) => {
      const spec = d.modules.find((m) => m.key === iv.module_key)!.spec;
      return {
        interview_id: iv.key, user_id: iv.student_key, module_id: iv.module_key, module_name: spec.name, module_type: spec.type,
        pass_threshold: spec.pass_threshold, started_at: iv.started_at, completed_at: iv.completed_at,
        overall_score: iv.evaluation.overall, readiness_level: iv.evaluation.result.readiness_level, primary_gap: iv.evaluation.primary_gap,
        dimensions: Object.fromEntries(Object.entries(iv.evaluation.result.dimensions).map(([k, v]) => [k, typeof v.score === "number" ? v.score : null])),
        per_topic: Object.fromEntries(Object.entries(iv.evaluation.result.per_topic).map(([k, v]) => [k, typeof v.score === "number" ? v.score : null])),
      };
    });
    const s = batchSummary(summarize(roster, evals));
    expect(s.readiness.ready).toBeGreaterThan(3);
    expect(s.readiness.developing).toBeGreaterThan(5);
    expect(s.readiness.not_ready).toBeGreaterThan(1);
    expect(s.readiness.not_attempted).toBe(3);
    expect(s.gaps.communication).toBeGreaterThan(1);
    expect(s.gaps.technical).toBeGreaterThan(1);
    expect(s.improvement.delta!).toBeGreaterThan(0.3);
    expect(s.weakest_topics.length).toBeGreaterThan(2);
    expect(d.interviews.length).toBeGreaterThan(80);
  });

  it("communication-weak students show it in the audio metrics", () => {
    const weak = d.students.filter((s) => s.archetype === "needs_communication").map((s) => s.key);
    const strong = d.students.filter((s) => s.archetype === "star").map((s) => s.key);
    const avg = (keys: string[], f: (m: typeof d.interviews[0]["evaluation"]["metrics"]) => number | null) => {
      const xs = d.interviews.filter((i) => keys.includes(i.student_key)).map((i) => f(i.evaluation.metrics)).filter((x): x is number => x !== null);
      return xs.reduce((a, b) => a + b, 0) / xs.length;
    };
    expect(avg(weak, (m) => m.avg_pause_before_answer_ms)).toBeGreaterThan(avg(strong, (m) => m.avg_pause_before_answer_ms) * 2);
    expect(avg(weak, (m) => m.fillers_per_100_words)).toBeGreaterThan(avg(strong, (m) => m.fillers_per_100_words));
  });

  it("is deterministic for a seed", () => {
    const again = generateDemo({ seed: 2026, now });
    expect(JSON.stringify(again)).toBe(JSON.stringify(d));
    expect(JSON.stringify(generateDemo({ seed: 7, now }).students)).not.toBe(JSON.stringify(d.students));
  });
});
