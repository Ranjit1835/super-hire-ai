// Gallery scenes for the assess area (owner: the assess clone): question bank, tests list, test builder.
// Fixture data only; see ./kit.tsx and ./college.tsx for the pattern this follows.
import type { ComponentType } from "react";
import type { QueryClient } from "@tanstack/react-query";
import BankPage from "../bank/BankPage";
import TestsPage from "../assessments/TestsPage";
import BuilderPage from "../assessments/BuilderPage";
import type { AssessmentRow, QuestionRow } from "../bank/forms";
import { DEMO, Scene } from "./kit";

/** Seeds what every assess page reads before its own data: can this viewer edit this org's bank/tests. */
function seedAssessAccess(qc: QueryClient, orgId: string | null = DEMO.org) {
  qc.setQueryData(["b2b-assess", "can-edit", orgId], true);
}

const question = (over: Partial<QuestionRow>): QuestionRow => ({
  id: "q0000000-0000-4000-8000-000000000000", org_id: DEMO.org, type: "coding", title: "Untitled", statement: "",
  difficulty: "easy", topics: [], category: null, languages: ["python"], starter_code: {}, constraints: null,
  time_limit_ms: 2000, memory_limit_kb: 256000, options: null, answer: null, multi_select: false, explanation: null,
  points: 10, status: "verified", source: "manual", version: 1, created_at: "2026-10-10T05:00:00Z", ...over,
});

/** Six demo questions spanning both types, every status, and a global one. Labelled fixtures, never real content. */
const demoQuestions: QuestionRow[] = [
  question({ id: "q0000000-0000-4000-8000-000000000001", title: "Pair sums", statement: "Count pairs that add up to K.",
    difficulty: "easy", topics: ["arrays"], languages: ["python", "java", "cpp"], points: 10, status: "verified" }),
  question({ id: "q0000000-0000-4000-8000-000000000002", title: "Balanced brackets", statement: "Check if the brackets in a string are balanced.",
    difficulty: "medium", topics: ["stacks"], languages: ["python", "cpp"], points: 10, status: "draft" }),
  question({ id: "q0000000-0000-4000-8000-000000000003", type: "mcq", title: "Train speed",
    statement: "A train covers 120 km in 2 hours. Its average speed?", difficulty: "easy", topics: ["speed", "time"],
    category: "aptitude", languages: [], options: [{ id: "a", text: "60 km/h" }, { id: "b", text: "40 km/h" }], answer: ["a"],
    points: 1, status: "verified" }),
  question({ id: "q0000000-0000-4000-8000-000000000004", type: "mcq", title: "Normalisation forms",
    statement: "Which forms remove transitive dependency?", difficulty: "medium", topics: ["dbms"], category: "cs_fundamentals",
    languages: [], options: [{ id: "a", text: "1NF" }, { id: "b", text: "3NF" }, { id: "c", text: "BCNF" }], answer: ["b", "c"],
    multi_select: true, points: 2, status: "draft", source: "ai" }),
  question({ id: "q0000000-0000-4000-8000-000000000005", org_id: null, title: "Longest substring without repeats",
    statement: "Find the length of the longest substring without repeating characters.", difficulty: "hard",
    topics: ["strings", "sliding-window"], languages: ["python", "java"], points: 20, status: "verified" }),
  question({ id: "q0000000-0000-4000-8000-000000000006", type: "mcq", title: "OSI layers",
    statement: "Which layer handles routing between networks?", difficulty: "easy", topics: ["networking"],
    category: "cs_fundamentals", languages: [], options: [{ id: "a", text: "Network" }, { id: "b", text: "Transport" }],
    answer: ["a"], points: 1, status: "retired" }),
];

function Bank() {
  return (
    <Scene path={`/assess/bank/${DEMO.org}`} route="/assess/bank/:orgId" element={<BankPage />}
      seed={(qc) => { seedAssessAccess(qc); qc.setQueryData(["b2b-assess", "bank", DEMO.org], demoQuestions); }} />
  );
}

function BankEmpty() {
  return (
    <Scene path={`/assess/bank/${DEMO.org}`} route="/assess/bank/:orgId" element={<BankPage />}
      seed={(qc) => { seedAssessAccess(qc); qc.setQueryData(["b2b-assess", "bank", DEMO.org], []); }} />
  );
}

const demoTests: AssessmentRow[] = [
  { id: "t0000000-0000-4000-8000-000000000001", org_id: DEMO.org, title: "CSE round 1: coding + aptitude",
    duration_min: 90, languages: ["python", "java", "cpp"], randomize: true, shuffle_options: true, negative_marking: 0,
    proctoring_policy: "strict", strict_max_violations: 3, practice_enabled: true, late_join_min: 15, status: "ready",
    created_at: "2026-10-01T05:00:00Z", updated_at: "2026-10-18T05:00:00Z",
    sections: [{ type: "coding", title: "Coding", pick: [{ difficulty: "easy", topics: ["arrays"], count: 2 }, { difficulty: "medium", topics: [], count: 1 }] },
               { type: "mcq", title: "Aptitude", pick: [{ topics: [], count: 10 }] }] },
  { id: "t0000000-0000-4000-8000-000000000002", org_id: DEMO.org, title: "Quick aptitude screener",
    duration_min: 30, languages: ["python"], randomize: true, shuffle_options: true, negative_marking: 0.25,
    proctoring_policy: "standard", strict_max_violations: 3, practice_enabled: false, late_join_min: null, status: "draft",
    created_at: "2026-10-12T05:00:00Z", updated_at: "2026-10-12T05:00:00Z",
    sections: [{ type: "mcq", title: "Aptitude", pick: [{ topics: [], count: 15 }] }] },
];

function Tests() {
  return (
    <Scene path={`/assess/tests/${DEMO.org}`} route="/assess/tests/:orgId" element={<TestsPage />}
      seed={(qc) => { seedAssessAccess(qc); qc.setQueryData(["b2b-assess", "assessments", DEMO.org], demoTests); }} />
  );
}

function TestsEmpty() {
  return (
    <Scene path={`/assess/tests/${DEMO.org}`} route="/assess/tests/:orgId" element={<TestsPage />}
      seed={(qc) => { seedAssessAccess(qc); qc.setQueryData(["b2b-assess", "assessments", DEMO.org], []); }} />
  );
}

/** New test, default section (1 easy coding question): the bank below only has medium/hard coding, so the rule
 *  comes up short on load and the "(not enough)" warning shows without any interaction. */
function Builder() {
  const shortBank = demoQuestions.filter((q) => q.type === "mcq" || q.difficulty !== "easy");
  return (
    <Scene path={`/assess/tests/${DEMO.org}/new`} route="/assess/tests/:orgId/new" element={<BuilderPage />}
      seed={(qc) => { seedAssessAccess(qc); qc.setQueryData(["b2b-assess", "bank", DEMO.org], shortBank); }} />
  );
}

export const scenes: Record<string, ComponentType> = {
  bank: Bank, "bank-empty": BankEmpty,
  tests: Tests, "tests-empty": TestsEmpty,
  builder: Builder,
};
