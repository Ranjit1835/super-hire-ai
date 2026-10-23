// @vitest-environment node
// Startup portal pure logic: AI match score, report shaping (with / without interview data), consent purposes,
// email masking, pipeline export rows.
import { describe, it, expect } from "vitest";
import {
  computeMatch, consentText, maskEmail, matches, matchFromRaw, pipelineExportRows, recommendationFor, requiredPurposes, shapeReport,
  type Signal,
} from "../../functions/_shared/company-logic";
import { CandidateReport, type PipelineRow, type SkillsMatrix } from "../../functions/_shared/contracts/company";

const U = (n: number) => `${String(n).padStart(8, "0")}-1111-4111-8111-111111111111`;
const matrix: SkillsMatrix = {
  must_have: [{ skill: "Python", weight: 5 }, { skill: "SQL", weight: 3 }],
  nice_to_have: [{ skill: "Docker", weight: 2 }],
  seniority: "junior",
};

describe("skill matching", () => {
  it("matches phrases and meaningful shared tokens, not stop words", () => {
    expect(matches("Python", "python")).toBe(true);
    expect(matches("REST API design", "api design")).toBe(true);
    expect(matches("Data structures", "coding programming data structures python")).toBe(true);
    expect(matches("C++", "cpp")).toBe(true);
    expect(matches("SQL", "python")).toBe(false);
    expect(matches("Knowledge of Go", "general knowledge")).toBe(false);
  });
});

describe("match score", () => {
  it("weights must-haves double, blends 60/40 with the overall, and reports coverage", () => {
    const signals: Signal[] = [
      { source: "coding", label: "python", score: 80, evidence: [] },
      { source: "interview", label: "sql", score: 50, evidence: ["“I'd use a join”"] },
    ];
    const m = computeMatch(matrix, signals, [80, 60]);
    // skills part = (10×80 + 6×50) / 16 = 68.75; overall = 70; match = 0.6×68.75 + 0.4×70 = 69.25 → 69.3
    expect(m.score).toBe(69.3);
    expect(m.recommendation).toBe("good");
    expect(m.coverage).toBe(0.9);          // 16 of 18 weight units have evidence
    expect(m.skills.find((s) => s.skill === "Docker")).toMatchObject({ score: null, evidence: [] });
    expect(m.skills.find((s) => s.skill === "SQL")!.evidence).toContain("“I'd use a join”");
  });

  it("falls back to the overall when no skill has evidence, and is null with no data", () => {
    expect(computeMatch(matrix, [], [40, null]).score).toBe(40);
    expect(computeMatch(matrix, [], [null]).score).toBeNull();
    expect(computeMatch(null, [{ source: "coding", label: "x", score: 90, evidence: [] }], []).score).toBeNull();
  });

  it("bands the recommendation (AI recommendation; humans decide)", () => {
    expect([recommendationFor(85), recommendationFor(65), recommendationFor(50), recommendationFor(49.9), recommendationFor(null)])
      .toEqual(["strong", "good", "borderline", "not_yet", null]);
  });
});

const raw = (over: Record<string, unknown> = {}) => ({
  role_candidate_id: U(1), stage: "completed", decision: null, invited_at: "2026-10-20T10:00:00Z", completed_at: "2026-10-21T10:00:00Z",
  candidate: { full_name: "Asha", email: "asha@x.in", phone: "98480" },
  role: { id: U(2), title: "Backend engineer", org_name: "Startup A", skills_matrix: matrix },
  attempt: { id: U(3), status: "submitted", score: 8, max_score: 10, grading: "complete",
    questions: [{ title: "Two sum", language: "python", code: "print(1)", passed: 4, total: 5, score: 8, max_score: 10, status: "done" }] },
  interview: null,
  dimension_scores: [{ source_type: "assessment", dimension: "coding", topic: null, score: 80 }],
  integrity: [
    { session_id: U(4), kind: "coding", score: 72, band: "medium", flags: 3, review: null },
    { session_id: U(5), kind: "interview", score: 90, band: "high", flags: 0, review: "no_concern" },
  ],
  comments: [{ id: U(6), body: "Good", created_at: "2026-10-21", author: "Ravi" }],
  decisions: [{ decision: "advance", note: null, created_at: "2026-10-21", by: "Ravi" }],
  ...over,
});

describe("report shaping", () => {
  it("staff report without interview data renders coding + integrity and validates against the contract", () => {
    const r = shapeReport(raw(), true);
    expect(CandidateReport.safeParse(r).success).toBe(true);
    expect(r.interview).toBeNull();
    expect(r.coding).toMatchObject({ pct: 80, passed: 4, total: 5, pending: false });
    expect(r.coding!.questions[0]).toMatchObject({ code: "print(1)", language: "python" });
    expect(r.integrity).toMatchObject({ score: 72, band: "medium" });
    expect(r.skills.find((s) => s.skill === "Python")!.score).toBe(80);
    expect(r.matchScore).not.toBeNull();
    expect(r.comments).toHaveLength(1);
    expect(r.evidenceIncluded).toBe(false);
  });

  it("with interview data: transcript, evaluation evidence, overall on 0–100", () => {
    const r = shapeReport(raw({
      interview: { id: U(7), status: "completed", transcript: [{ turn: 1, role: "interviewer", content: "Tell me about SQL joins" }, { turn: 1, role: "student", content: "An inner join…" }],
        evaluation: { status: "completed", overall_score: 7, readiness_level: "ready",
          result: { dimensions: { communication: { score: 8, evidence: ["An inner join…"], reason: "Clear" } },
                    per_topic: { sql: { score: 6, evidence: ["An inner join…"], reason: "Basic" }, docker: { score: "insufficient_data", evidence: [], reason: "" } } } } },
    }), true);
    expect(CandidateReport.safeParse(r).success).toBe(true);
    expect(r.interview).toMatchObject({ overall: 70, readiness: "ready" });
    expect(r.interview!.transcript).toHaveLength(2);
    expect(r.interview!.evidence.find((e) => e.label === "sql")).toMatchObject({ score: 60, quotes: ["An inner join…"] });
    expect(r.skills.find((s) => s.skill === "SQL")!.score).toBe(60);
    expect(r.skills.find((s) => s.skill === "Docker")!.score).toBeNull();
  });

  it("share view drops contacts, comments, decisions and session ids", () => {
    const r = shapeReport(raw(), false);
    expect(r.candidate).toEqual({ fullName: "Asha", email: null, phone: null });
    expect(r.comments).toEqual([]);
    expect(r.decisions).toEqual([]);
    expect(r.integrity.sessions.every((s) => s.sessionId === null)).toBe(true);
  });

  it("an unfinished attempt doesn't count towards the match", () => {
    const m = matchFromRaw(raw({ attempt: { id: U(3), status: "in_progress", score: 2, max_score: 10, questions: [] }, dimension_scores: [] }));
    expect(m.score).toBeNull();
  });
});

describe("consent and helpers", () => {
  it("itemises purposes by role setup", () => {
    expect(requiredPurposes({ hasInterview: false, proctored: false })).toEqual(["account", "assessment"]);
    expect(requiredPurposes({ hasInterview: true, proctored: true })).toEqual([
      "account", "assessment", "interview_audio", "recording", "proctoring_screen", "proctoring_camera", "proctoring_audio"]);
    expect(consentText("assessment", "Acme")).toMatch(/AI does not pass or fail me; Acme's team decides/);
  });

  it("masks emails", () => {
    expect(maskEmail("asha.k@x.in")).toBe("as****@x.in");
    expect(maskEmail("a@x.in")).toBe("a***@x.in");
    expect(maskEmail("bad")).toBe("***");
  });

  it("export rows follow the column order", () => {
    const row: PipelineRow = {
      id: U(1), full_name: "Asha", email: "a@x.in", phone: null, stage: "shortlisted", decision: "advance", match_score: 70,
      recommendation: "good", invited_at: "2026-10-20T10:00:00Z", started_at: null, completed_at: "2026-10-21T10:00:00Z",
      invite_expires_at: null, email_sent_at: null, email_error: null, attempt_status: "submitted", coding: 80, interview: null,
      integrity: 72, integrity_band: "medium", credits_charged: true,
    };
    expect(pipelineExportRows([row])[0]).toEqual(["Asha", "a@x.in", null, "Shortlisted", "advance", 70, "good", 80, null, 72, "medium", "2026-10-20", "2026-10-21"]);
  });
});
