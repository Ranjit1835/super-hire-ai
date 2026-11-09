// @vitest-environment node
// The V1 API contracts accept what the UI sends and reject what the database would refuse.
import { describe, it, expect } from "vitest";
import { adminContract } from "../../functions/_shared/contracts/admin";
import { collegeContract } from "../../functions/_shared/contracts/college";
import { candidateContract, companyContract, SkillsMatrix } from "../../functions/_shared/contracts/company";
import { assessContract, GeneratedQuestion } from "../../functions/_shared/contracts/assess";
import { proctorContract } from "../../functions/_shared/contracts/proctor";
import { interviewContract } from "../../functions/_shared/contracts/interview";

const U = "7c6f2d1e-8a1b-4c2d-9e3f-0a1b2c3d4e5f";

describe("V1 contracts", () => {
  it("every action has input and output schemas", () => {
    for (const c of [adminContract, collegeContract, companyContract, candidateContract, assessContract, proctorContract, interviewContract]) {
      for (const [name, def] of Object.entries(c)) {
        expect(typeof def.input.safeParse, name).toBe("function");
        expect(typeof def.output.safeParse, name).toBe("function");
      }
    }
  });

  it("createOrg: valid college input passes; bad slugs, types and emails fail", () => {
    const ok = adminContract.createOrg.input.safeParse({
      name: "SVR Engineering College", slug: "svr-engg", type: "college", planId: "college_standard", seatLimit: 300,
      admin: { email: "TPO@SVR.in " },
    });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.admin?.email).toBe("tpo@svr.in");
    expect(adminContract.createOrg.input.safeParse({ name: "X", slug: "Bad Slug", type: "college", planId: "p" }).success).toBe(false);
    expect(adminContract.createOrg.input.safeParse({ name: "Xy", slug: "ok-slug", type: "coaching_institute", planId: "pilot" }).success).toBe(false);
    expect(adminContract.inviteStaff.input.safeParse({ orgId: U, email: "nope", role: "org_admin" }).success).toBe(false);
    expect(adminContract.inviteStaff.input.safeParse({ orgId: U, email: "a@b.in", role: "student" }).success).toBe(false);
  });

  it("student import rows coerce CSV strings and enforce ranges", () => {
    const row = collegeContract.importStudents.input.shape.rows.element;
    expect(row.parse({ row: 2, roll_no: "21A01", full_name: "Asha", email: "asha@x.in", cgpa: "8.25", active_backlogs: "0", batch_year: "2027" }))
      .toMatchObject({ cgpa: 8.25, active_backlogs: 0, batch_year: 2027 });
    expect(row.safeParse({ row: 2, roll_no: "21A01", full_name: "Asha", email: "asha@x.in", cgpa: "11" }).success).toBe(false);
    expect(row.safeParse({ row: 2, roll_no: "21A01", full_name: "Asha", email: "asha@x.in", dob: "12/05/2005" }).success).toBe(false);
  });

  it("eligibility filters reject unknown keys (a typo must not silently widen a drive)", () => {
    expect(collegeContract.previewEligibility.input.safeParse({ orgId: U, eligibility: { min_cgpa: 7, max_backlogs: 0, departments: ["CSE"], batch_years: [2027] } }).success).toBe(true);
    expect(collegeContract.previewEligibility.input.safeParse({ orgId: U, eligibility: { min_cpga: 7 } }).success).toBe(false);
  });

  it("skills matrix and generated coding questions have usable shapes", () => {
    expect(SkillsMatrix.safeParse({ must_have: [{ skill: "Java", weight: 5 }], nice_to_have: [], seniority: "junior" }).success).toBe(true);
    expect(SkillsMatrix.safeParse({ must_have: [], nice_to_have: [], seniority: "junior" }).success).toBe(false);
    const q = {
      title: "Pair sum", statement: "Given n numbers, print the count of pairs summing to k.", difficulty: "easy", topics: ["arrays"],
      constraints: "1 <= n <= 1e5", starter_code: { python: "def solve():\n  pass" },
      tests: Array.from({ length: 5 }, (_, i) => ({ input: `${i}`, output: `${i}`, sample: i < 2 })),
      reference_solution: { language: "python", code: "print(0)" },
    };
    expect(GeneratedQuestion.safeParse(q).success).toBe(true);
    expect(GeneratedQuestion.safeParse({ ...q, tests: q.tests.slice(0, 2) }).success).toBe(false);   // too few tests to verify
  });

  it("runner and proctoring payloads are bounded", () => {
    expect(assessContract.autosave.input.safeParse({ attemptId: U, sessionId: U, questionId: U, seq: 3, language: "python", code: "x" }).success).toBe(true);
    expect(assessContract.autosave.input.safeParse({ attemptId: U, sessionId: U, questionId: U, seq: 3, language: "ruby" }).success).toBe(false);
    const ev = { clientEventId: U, type: "tab_hidden", severity: "medium", startedAt: "2026-10-21T10:00:00+05:30" };
    expect(proctorContract.events.input.safeParse({ sessionId: U, events: [ev] }).success).toBe(true);
    expect(proctorContract.events.input.safeParse({ sessionId: U, events: [{ ...ev, type: "made_up" }] }).success).toBe(false);
    expect(proctorContract.events.input.safeParse({ sessionId: U, events: Array(201).fill(ev) }).success).toBe(false);
  });

  it("share links last 1–30 days; candidate tokens have a sane length", () => {
    expect(companyContract.createShareLink.input.safeParse({ roleCandidateId: U, expiresInDays: 7 }).success).toBe(true);
    expect(companyContract.createShareLink.input.safeParse({ roleCandidateId: U, expiresInDays: 90 }).success).toBe(false);
    expect(candidateContract.resolveInvite.input.safeParse({ token: "short" }).success).toBe(false);
  });
});
