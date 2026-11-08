// @vitest-environment node
// What the interviewer is told: it never speaks for an organisation (B21) and never repeats a question (B22).
import { describe, it, expect } from "vitest";
import { buildTemplate } from "../../functions/_shared/interview-v1/template";
import { initV1State, planV1 } from "../../functions/_shared/interview-v1/engine";
import { buildV1SystemPrompt, buildV1TurnMessage, fallbackV1Question } from "../../functions/_shared/interview-v1/prompts";

const drive = buildTemplate({ context: "drive", title: "CSE drive", moduleSpec: { topics: ["DBMS"], max_minutes: 15 } });

describe("B21: no invented organisation facts", () => {
  it("drive: the interviewer knows nothing about any organisation and isn't a company", () => {
    const p = buildV1SystemPrompt(drive);
    expect(p).toMatch(/You know nothing about the organisation/);
    expect(p).toMatch(/never say "our company"/);
    expect(p).toMatch(/not an interview by any company/);
  });

  it("drive: the closing questions are about this interview, not a role", () => {
    const q = fallbackV1Question({ section: "candidate_questions", kind: "new", difficulty: "beginner", skill: null, newSection: true } as never, drive);
    expect(q).toMatch(/about this interview or the process/);
    expect(q).not.toMatch(/role/);
  });
});

describe("B22: no repeated questions", () => {
  it("lists every question already asked, not only the last few lines", () => {
    const s = initV1State(drive, null);
    const turns = Array.from({ length: 10 }, (_, i) => [
      { role: "interviewer" as const, text: `Question number ${i + 1}?` },
      { role: "candidate" as const, text: `Answer ${i + 1}.` },
    ]).flat();
    const msg = buildV1TurnMessage(s, drive, planV1(s, drive, 60), turns, "Last answer.", 600, false);
    expect(msg).toContain("Questions already asked (never repeat or reword any of them):");
    for (let i = 1; i <= 10; i++) expect(msg).toContain(`- Question number ${i}?`);
  });
});
