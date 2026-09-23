import { describe, it, expect } from "vitest";
import { applyFilters, batchSummary, gapCategory, heatClass, summarize, type DashEval, type RosterStudent } from "./dashboard";
import { DIMENSIONS, type Dimension } from "./shared";

const student = (id: string, batch = "b1", dept = "CSE"): RosterStudent => ({
  user_id: id, full_name: `Student ${id}`, roll_no: `R${id}`, email: `${id}@x.in`, batch_id: batch, batch_name: batch.toUpperCase(), department: dept,
});
const dims = (v: number, over: Partial<Record<Dimension, number | null>> = {}) =>
  ({ ...Object.fromEntries(DIMENSIONS.map((d) => [d, v])), ...over }) as Record<Dimension, number | null>;
let n = 0;
const ev = (user: string, overall: number, readiness: DashEval["readiness_level"], d: Record<Dimension, number | null>, over: Partial<DashEval> = {}): DashEval => ({
  interview_id: `iv${++n}`, user_id: user, module_id: "sql", module_name: "SQL", module_type: "skill", pass_threshold: 6,
  started_at: `2026-09-${String(10 + n).padStart(2, "0")}T10:00:00Z`, completed_at: "", overall_score: overall, readiness_level: readiness,
  primary_gap: `gap of ${user}`, dimensions: d, per_topic: { Joins: overall, Indexes: null }, ...over,
});

describe("gapCategory", () => {
  it("is ready for ready students, otherwise the weakest skill group", () => {
    expect(gapCategory(dims(8), "ready")).toBe("ready");
    expect(gapCategory(dims(7, { technical_knowledge: 3, role_specific_knowledge: 4 }), "developing")).toBe("technical");
    expect(gapCategory(dims(7, { communication: 3, language: 4, confidence: 5 }), "developing")).toBe("communication");
    expect(gapCategory(dims(7, { analytical_thinking: 2, problem_solving: 3 }), "not_ready")).toBe("analytical");
  });
  it("ignores insufficient-data dimensions", () => {
    expect(gapCategory(dims(7, { analytical_thinking: null, problem_solving: null, communication: 4 }), "developing")).toBe("communication");
  });
});

describe("summarize + batchSummary", () => {
  const roster = [student("a"), student("b"), student("c", "b2", "ECE"), student("d")];
  const evals = [
    ev("a", 4, "not_ready", dims(4, { technical_knowledge: 2 })),
    ev("a", 7, "developing", dims(7, { technical_knowledge: 6, resume_project_knowledge: null })),
    ev("b", 8, "ready", dims(8)),
    ev("c", 5, "developing", dims(6, { communication: 3 }), { module_id: "java", module_name: "Java", per_topic: { OOP: 3 } }),
  ];
  const rows = summarize(roster, evals);

  it("uses the latest interview, keeps the latest known score per dimension, and computes change", () => {
    const a = rows.find((r) => r.student.user_id === "a")!;
    expect(a.interviews).toHaveLength(2);
    expect(a.readiness).toBe("developing");
    expect(a.delta).toBe(3);
    expect(a.dims.technical_knowledge).toBe(6);
    expect(a.dims.resume_project_knowledge).toBe(4); // latest non-null (first interview)
    expect(rows.find((r) => r.student.user_id === "d")).toMatchObject({ gap: "not_attempted", readiness: null, latest: null });
  });

  it("readiness is the weakest module's latest result, not simply the latest interview", () => {
    const mixed = summarize([student("x")], [
      ev("x", 4, "not_ready", dims(4), { module_id: "sql" }),
      ev("x", 8, "ready", dims(8), { module_id: "hr", module_name: "HR" }),
    ]);
    expect(mixed[0].readiness).toBe("not_ready");
    const retaken = summarize([student("y")], [
      ev("y", 4, "not_ready", dims(4), { module_id: "sql" }),
      ev("y", 7, "ready", dims(7), { module_id: "sql" }),
    ]);
    expect(retaken[0].readiness).toBe("ready");
  });

  it("scopes to a module", () => {
    const java = summarize(roster, evals, "java");
    expect(java.filter((r) => r.latest).map((r) => r.student.user_id)).toEqual(["c"]);
    expect(java.find((r) => r.student.user_id === "c")!.topics).toEqual({ OOP: 3 });
  });

  it("summarises readiness, gaps, weakest topics and first-vs-latest improvement", () => {
    const s = batchSummary(rows, 1);
    expect(s).toMatchObject({ students: 4, attempted: 3, interviews: 4 });
    expect(s.readiness).toEqual({ ready: 1, developing: 2, not_ready: 0, not_attempted: 1 });
    expect(s.gaps).toMatchObject({ ready: 1, communication: 1, not_attempted: 1 });
    expect(s.weakest_topics[0]).toEqual({ topic: "OOP", avg: 3, n: 1 });
    expect(s.improvement).toMatchObject({ students: 1, first_avg: 4, latest_avg: 7, delta: 3, improved: 1, declined: 0 });
    expect(s.dimension_delta.technical_knowledge).toBe(4);
    expect(s.avg_overall).toBe(6.7);
  });

  it("drops topics with too few data points from 'weakest topics'", () => {
    expect(batchSummary(rows, 2).weakest_topics.map((t) => t.topic)).toEqual(["Joins"]);
  });

  it("filters by readiness, gap, batch, department and search", () => {
    expect(applyFilters(rows, { readiness: ["developing"] }).map((r) => r.student.user_id)).toEqual(["a", "c"]);
    expect(applyFilters(rows, { readiness: ["not_attempted"] }).map((r) => r.student.user_id)).toEqual(["d"]);
    expect(applyFilters(rows, { gap: ["ready"] }).map((r) => r.student.user_id)).toEqual(["b"]);
    expect(applyFilters(rows, { batchId: "b2" }).map((r) => r.student.user_id)).toEqual(["c"]);
    expect(applyFilters(rows, { department: "CSE", search: "rb" }).map((r) => r.student.user_id)).toEqual(["b"]);
  });
});

describe("heatClass", () => {
  it("bands scores around the pass mark", () => {
    expect(heatClass(null)).toMatch(/muted/);
    expect(heatClass(9)).toMatch(/emerald-500\/60/);
    expect(heatClass(6)).toMatch(/emerald-500\/30/);
    expect(heatClass(5)).toMatch(/amber/);
    expect(heatClass(2)).toMatch(/red/);
  });
});
