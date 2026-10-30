import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  assessmentFromRow, assessmentRow, checkDraw, CodingForm, codingPayload, describeRule, emptyAssessment, emptyCoding, McqForm, mcqPayload,
  paperCapacity, poolMatches, type AssessmentRow, type QuestionRow,
} from "./forms";

const state = vi.hoisted(() => ({ canEdit: true as boolean | undefined, bank: [] as unknown[], assessment: null as unknown, queries: [] as unknown[] }));
const fns = vi.hoisted(() => ({ saveQuestion: vi.fn(), saveAssessment: vi.fn(), setQuestionStatus: vi.fn(), assessApi: vi.fn(), rpc: vi.fn() }));

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" }, signOut: vi.fn() }) }));
vi.mock("./queries", async (orig) => ({
  ...(await orig<typeof import("./queries")>()),
  useCanEdit: () => ({ data: state.canEdit, isLoading: false }),
  // The page asks the server for one filtered page; the mock records the query and serves the whole fixture bank.
  useBankPage: (_org: string | null, q: unknown) => {
    state.queries.push(q);
    const all = state.bank as { status: string; type: string }[];
    const n = (f: (x: { status: string; type: string }) => boolean) => all.filter(f).length;
    return { data: { total: all.length, rows: all, counts: { verified: n((x) => x.status === "verified"), draft: n((x) => x.status === "draft"), retired: n((x) => x.status === "retired"), coding: n((x) => x.type === "coding"), mcq: n((x) => x.type === "mcq") } }, isLoading: false, isFetching: false, error: null };
  },
  useVerifiedPool: () => ({ data: (state.bank as { status: string }[]).filter((q) => q.status === "verified"), isLoading: false, error: null }),
  useAssessments: () => ({ data: [], isLoading: false, error: null }),
  useAssessment: (id: string | undefined) => ({ data: id ? state.assessment : undefined, isLoading: false, error: null }),
  loadCodingDetails: vi.fn().mockResolvedValue({ tests: [], reference: null }),
  saveQuestion: fns.saveQuestion,
  saveAssessment: fns.saveAssessment,
  setQuestionStatus: fns.setQuestionStatus,
}));
vi.mock("@/features/b2b/lib/db", () => ({ b2bDb: { rpc: fns.rpc } }));
vi.mock("../lib/api", async (orig) => ({ ...(await orig<typeof import("../lib/api")>()), assessApi: fns.assessApi }));

import BankPage from "./BankPage";
import BuilderPage from "../assessments/BuilderPage";
import { McqDialog } from "./McqDialog";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const Q1 = "11111111-1111-4111-8111-111111111111";
const Q2 = "22222222-2222-4222-8222-222222222222";

const question = (over: Partial<QuestionRow>): QuestionRow => ({
  id: Q1, org_id: ORG, type: "coding", title: "Pair sums", statement: "Count pairs that add up to K.", difficulty: "easy", topics: ["arrays"],
  category: null, languages: ["python", "java"], starter_code: {}, constraints: null, time_limit_ms: 2000, memory_limit_kb: 256000,
  options: null, answer: null, multi_select: false, explanation: null, points: 10, status: "verified", source: "manual", version: 1,
  created_at: "2026-10-20T00:00:00Z", ...over,
});

function renderAt(path: string) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/assess/bank/:orgId" element={<BankPage />} />
          <Route path="/assess/tests/:orgId" element={<p>tests list</p>} />
          <Route path="/assess/tests/:orgId/new" element={<BuilderPage />} />
          <Route path="/assess/tests/:orgId/:assessmentId" element={<BuilderPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  state.canEdit = true;
  state.bank = [];
  state.assessment = null;
  state.queries = [];
  Object.values(fns).forEach((f) => f.mockReset());
});

describe("bank forms (pure)", () => {
  it("MCQ: needs a correct option, and several ticks make it multi-select", () => {
    const f: McqForm = { title: "Speed", statement: "A train covers 120 km in 2 h. Its speed?", difficulty: "easy", category: "aptitude",
      topics: "Speed, speed , time", options: [{ id: "a", text: "60 km/h" }, { id: "b", text: "40 km/h" }], correct: [], explanation: "",
      points: 1, ready: true };
    expect(McqForm.safeParse(f).success).toBe(false);
    const p = mcqPayload(ORG, { ...f, correct: ["a", "b"] });
    expect(p).toMatchObject({ org_id: ORG, type: "mcq", multi_select: true, status: "verified", topics: ["speed", "time"], answer: ["a", "b"] });
    expect(mcqPayload(null, { ...f, correct: ["a"], ready: false }, Q1)).toMatchObject({ id: Q1, org_id: null, multi_select: false, status: "draft" });
  });

  it("coding: needs a sample and a hidden test plus a reference; the reference language is always allowed", () => {
    const base: CodingForm = { ...emptyCoding(), title: "Pair sums", statement: "Count pairs that add up to K.", reference_code: "print(1)",
      reference_language: "c", languages: ["python"],
      tests: [{ input: "1", expected_output: "1", is_sample: true, weight: 1 }, { input: "2", expected_output: "2", is_sample: true, weight: 1 }] };
    expect(CodingForm.safeParse(base).success).toBe(false);   // no hidden test
    const ok = { ...base, tests: [base.tests[0], { ...base.tests[1], is_sample: false }] };
    expect(CodingForm.safeParse(ok).success).toBe(true);
    expect(CodingForm.safeParse({ ...ok, reference_code: " " }).success).toBe(false);
    const p = codingPayload(ORG, ok);
    expect(p.languages).toEqual(["python", "c"]);
    expect(p.starter_code).toEqual({ python: "", c: "" });
    expect(p.reference).toEqual({ language: "c", code: "print(1)" });
  });

  it("assessment rows round-trip and pool rules count matching verified questions", () => {
    const f = { ...emptyAssessment(), title: "Campus round 1",
      sections: [{ type: "coding" as const, title: "Coding", pick: [{ difficulty: "easy" as const, topics: "Arrays, strings", count: 2 }], question_ids: [] },
                 { type: "mcq" as const, title: "Aptitude", pick: [], question_ids: [Q2] }] };
    const row = assessmentRow(ORG, f);
    expect(row.sections).toEqual([
      { type: "coding", title: "Coding", pick: [{ difficulty: "easy", topics: ["arrays", "strings"], count: 2 }] },
      { type: "mcq", title: "Aptitude", question_ids: [Q2] },
    ]);
    expect(row.late_join_min).toBeNull();
    const back = assessmentFromRow({ ...row, id: "x", created_at: "", updated_at: "", negative_marking: "0.25" } as unknown as AssessmentRow);
    expect(back.sections[0].pick[0]).toEqual({ difficulty: "easy", topics: "arrays, strings", count: 2 });
    expect(back.negative_marking).toBe(0.25);
    expect(describeRule({ difficulty: "easy", topics: "arrays", count: 2 })).toBe("2 easy arrays");

    const bank = [question({}), question({ id: Q2, status: "draft" }), question({ id: "3", topics: ["graphs"] }), question({ id: "4", languages: ["c"] })];
    expect(poolMatches(bank, "coding", { difficulty: "easy", topics: "arrays", count: 1 }, ["python"])).toBe(1);
    expect(poolMatches(bank, "coding", { difficulty: "", topics: "", count: 1 }, ["python", "c"])).toBe(3);
    expect(poolMatches(bank, "mcq", { difficulty: "", topics: "", count: 1 }, ["python"])).toBe(0);
  });

  it("draw check: chosen questions that are missing, unverified or the wrong type are unavailable and make it short", () => {
    const bank = [question({}), question({ id: Q2, status: "retired" })];
    const c = checkDraw(bank, [{ type: "coding", pick: [], question_ids: [Q1, Q2, "gone"] }, { type: "mcq", pick: [], question_ids: [Q1] }], ["python"]);
    expect(c.unavailable).toEqual([Q2, "gone", Q1]);
    expect(c.short).toBe(true);
    expect(checkDraw(bank, [{ type: "coding", pick: [], question_ids: [Q1] }], ["python"]).short).toBe(false);
  });

  it("draw check: overlapping rules and chosen questions count against later rules, as the server draws them", () => {
    const Q3 = "33333333-3333-4333-8333-333333333333";
    const bank = [question({}), question({ id: Q2, topics: ["arrays", "strings"] }), question({ id: Q3, topics: ["strings"] })];
    const any = { difficulty: "" as const, topics: "", count: 1 };
    // Each rule alone has enough, but "any" may take the one arrays question the second rule needs.
    let c = checkDraw(bank, [{ type: "coding", pick: [{ ...any, count: 2 }, { ...any, topics: "arrays", count: 2 }], question_ids: [] }], ["python"]);
    expect(c.guaranteed).toEqual([[3, 0]]);
    expect(c.short).toBe(true);
    // Disjoint pools are independent, also across sections.
    c = checkDraw(bank, [
      { type: "coding", pick: [{ ...any, topics: "arrays", count: 2 }], question_ids: [] },
      { type: "coding", pick: [{ ...any, topics: "strings", count: 1 }], question_ids: [] },
    ], ["python"]);
    expect(c.guaranteed).toEqual([[2], [1]]);
    expect(c.short).toBe(false);
    // A chosen question is placed before the section's rules, so it leaves the pool.
    c = checkDraw(bank, [{ type: "coding", pick: [{ ...any, topics: "strings", count: 2 }], question_ids: [Q3] }], ["python"]);
    expect(c.guaranteed).toEqual([[1]]);
    expect(c.short).toBe(true);
    // A question chosen in a later section can be drawn first by an earlier section's rule.
    c = checkDraw(bank, [
      { type: "coding", pick: [any], question_ids: [] },
      { type: "coding", pick: [], question_ids: [Q1] },
    ], ["python"]);
    expect(c.fixedAtRisk).toEqual([Q1]);
    expect(c.short).toBe(true);
  });
});

describe("paper uniqueness calculator (R2.1/R2.2, same rule as b2b_paper_capacity)", () => {
  const pool = Array.from({ length: 60 }, (_, i) => question({ id: `q${i}`, type: "mcq", topics: ["aptitude"], languages: [] }));
  const sections = (fixed: string[] = []) => [{ type: "mcq" as const, pick: [{ difficulty: "" as const, topics: "aptitude", count: 10 }], question_ids: fixed }];

  it("10 per paper from 60 at a 10% limit: about 200 needed, not feasible; at 40% it is", () => {
    const c = paperCapacity(pool, sections(), ["python"], 10, 30);
    expect(c).toMatchObject({ feasible: false, paperSize: 10, expectedOverlapPct: 16.7 });
    expect(c.rules[0]).toMatchObject({ pool: 60, needed: 200, ok: false });
    expect(paperCapacity(pool, sections(), ["python"], 40, 30).feasible).toBe(true);
    expect(paperCapacity(pool, sections(), ["python"], 10, 1).feasible).toBe(true);
  });

  it("hand-picked questions are in every paper; a fixed order (no randomising) can't be unique", () => {
    const c = paperCapacity(pool, sections(["q0", "q1", "q2", "q3", "q4"]), ["python"], 40, 30);
    expect(c.fixed).toEqual({ count: 5, sharedPct: 33.3, ok: true });
    expect(paperCapacity(pool, sections(["q0", "q1", "q2", "q3", "q4", "q5"]), ["python"], 30, 30).fixed.ok).toBe(false);
    expect(paperCapacity(pool, sections(), ["python"], 40, 30, false).feasible).toBe(false);
  });
});

describe("question bank page", () => {
  it("only editors get in", () => {
    state.canEdit = false;
    renderAt(`/assess/bank/${ORG}`);
    expect(screen.getByText("You don't have access to this question bank")).toBeInTheDocument();
  });

  it("lists own and global questions; global ones are read only; drafts can be verified", async () => {
    state.bank = [question({ status: "draft" }), question({ id: Q2, org_id: null, title: "Global stack" })];
    fns.assessApi.mockResolvedValue({ status: "draft", failures: [{ testId: Q2, status: "wrong_answer" }] });
    renderAt(`/assess/bank/${ORG}`);
    const rows = screen.getAllByRole("row");
    expect(within(rows[1]).getByText("Draft")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Global")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Read only")).toBeInTheDocument();
    fireEvent.click(within(rows[1]).getByRole("button", { name: "Verify" }));
    await waitFor(() => expect(fns.assessApi).toHaveBeenCalledWith("verifyQuestion", { questionId: Q1 }, expect.anything()));
    expect(await screen.findByText(/Not verified: the reference solution failed 1 test \(wrong_answer\)/)).toBeInTheDocument();
  });

  it("MCQ: a disagreeing check explains itself, and the editor can keep the key with a reason (R2.3)", async () => {
    state.bank = [question({ type: "mcq", status: "draft", title: "Train speed" })];
    fns.assessApi.mockResolvedValue({ status: "draft", failures: [], version: 4,
      check: { answer: ["b"], agrees: false, ambiguous: false, confidence: 0.9, note: "Average speed is 40" } });
    fns.rpc.mockResolvedValue({ data: { ok: true, status: "verified" }, error: null });
    renderAt(`/assess/bank/${ORG}`);
    fireEvent.click(screen.getByRole("button", { name: "Verify" }));
    expect(await screen.findByText(/Not verified: an independent check chose B, not the key\. Its working: “Average speed is 40”/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Keep my key…" }));
    expect(await screen.findByText(/An independent check chose B, not the key\./)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Why the key is right"), { target: { value: "short" } });
    fireEvent.click(screen.getByRole("button", { name: "Keep my key" }));
    expect(await screen.findByText("Please explain in a sentence why your key is right.")).toBeInTheDocument();
    expect(fns.rpc.mock.calls.filter(([fn]) => fn === "b2b_override_mcq_check")).toEqual([]);
    fireEvent.change(screen.getByLabelText("Why the key is right"), { target: { value: "120 km in 2 hours is 60 km/h." } });
    fireEvent.click(screen.getByRole("button", { name: "Keep my key" }));
    await waitFor(() => expect(fns.rpc).toHaveBeenCalledWith("b2b_override_mcq_check", { _question_id: Q1, _version: 4, _note: "120 km in 2 hours is 60 km/h." }));
    expect(await screen.findByText(/Verified with your reason/)).toBeInTheDocument();
  });

  it("MCQ: an agreeing check verifies it", async () => {
    state.bank = [question({ type: "mcq", status: "draft", title: "Train speed" })];
    fns.assessApi.mockResolvedValue({ status: "verified", failures: [], version: 1, check: { answer: ["a"], agrees: true, ambiguous: false, confidence: 0.95, note: "" } });
    renderAt(`/assess/bank/${ORG}`);
    fireEvent.click(screen.getByRole("button", { name: "Verify" }));
    expect(await screen.findByText(/Verified: an independent check reached the same answer/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Keep my key…" })).toBeNull();
  });

  it("shows the code runner's message when Judge0 isn't set up", async () => {
    state.bank = [question({ status: "draft" })];
    fns.assessApi.mockRejectedValue(new Error("The code runner isn't set up yet, so code can't be run."));
    renderAt(`/assess/bank/${ORG}`);
    fireEvent.click(screen.getByRole("button", { name: "Verify" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The code runner isn't set up yet");
  });

  it("sends search to the server once typing settles, back on page 1", async () => {
    state.bank = [question({}), question({ id: Q2, title: "Balanced brackets", topics: ["stacks"] })];
    renderAt(`/assess/bank/${ORG}`);
    expect(state.queries.at(-1)).toEqual({ type: "all", owner: "all", search: "", page: 1 });
    fireEvent.change(screen.getByLabelText("Search questions"), { target: { value: "  Stack " } });
    await waitFor(() => expect(state.queries.at(-1)).toEqual({ type: "all", owner: "all", search: "Stack", page: 1 }));
  });

  it("header counts come from the server's whole-bank counts", () => {
    state.bank = [question({ status: "draft" }), question({ id: Q2, type: "mcq", title: "Train speed" })];
    renderAt(`/assess/bank/${ORG}`);
    expect(screen.getByText("1 verified · 1 draft · 0 retired · 1 coding · 1 MCQ")).toBeInTheDocument();
  });
});

describe("MCQ dialog", () => {
  const renderDialog = (onSaved = vi.fn()) => render(<McqDialog open onOpenChange={vi.fn()} orgId={ORG} onSaved={onSaved} />);

  it("refuses to save without a correct answer, then saves the payload", async () => {
    const onSaved = vi.fn();
    fns.saveQuestion.mockResolvedValue({ questionId: Q1, status: "verified" });
    renderDialog(onSaved);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Train speed" } });
    fireEvent.change(screen.getByLabelText("Question"), { target: { value: "A train covers 120 km in 2 hours. Speed?" } });
    ["60 km/h", "40 km/h", "80 km/h", "30 km/h"].forEach((t, i) =>
      fireEvent.change(screen.getByLabelText(`Option ${"ABCD"[i]}`), { target: { value: t } }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Mark the correct answer");
    expect(fns.saveQuestion).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText("Option A is correct"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(fns.saveQuestion).toHaveBeenCalledWith(expect.objectContaining({
      org_id: ORG, type: "mcq", title: "Train speed", answer: ["a"], multi_select: false, status: "verified",
      options: [{ id: "a", text: "60 km/h" }, { id: "b", text: "40 km/h" }, { id: "c", text: "80 km/h" }, { id: "d", text: "30 km/h" }],
    }));
  });

  it("shows a server refusal", async () => {
    fns.saveQuestion.mockRejectedValue(new Error("You don't have permission to do that."));
    renderDialog();
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Train speed" } });
    fireEvent.change(screen.getByLabelText("Question"), { target: { value: "A train covers 120 km in 2 hours. Speed?" } });
    ["a", "b", "c", "d"].forEach((x) => fireEvent.change(screen.getByLabelText(`Option ${x.toUpperCase()}`), { target: { value: x } }));
    fireEvent.click(screen.getByLabelText("Option B is correct"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("You don't have permission");
  });
});

describe("test builder", () => {
  it("warns when the bank can't fill a pool rule and saves the assessment row", async () => {
    state.bank = [question({})];
    fns.saveAssessment.mockResolvedValue("new-id");
    renderAt(`/assess/tests/${ORG}/new`);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Campus round 1" } });
    fireEvent.change(screen.getByLabelText("Section 1 rule 1 topics"), { target: { value: "arrays" } });
    expect(screen.getByText(/1 easy arrays · 1 verified in bank/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Section 1 rule 1 count"), { target: { value: "3" } });
    expect(screen.getByText(/3 easy arrays · 1 verified in bank \(not enough\)/)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Include Pair sums"));
    fireEvent.click(screen.getByRole("button", { name: "Save test" }));
    await waitFor(() => expect(screen.getByText("tests list")).toBeInTheDocument());
    expect(fns.saveAssessment).toHaveBeenCalledWith(undefined, expect.objectContaining({
      org_id: ORG, title: "Campus round 1", duration_min: 60, proctoring_policy: "standard",
      sections: [{ type: "coding", title: "Coding", pick: [{ difficulty: "easy", topics: ["arrays"], count: 3 }], question_ids: [Q1] }],
    }));
  });

  it("validates before saving", async () => {
    renderAt(`/assess/tests/${ORG}/new`);
    fireEvent.change(screen.getByLabelText("Duration (minutes)"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Round 1" } });
    fireEvent.click(screen.getByRole("button", { name: "Save test" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("At least 5 minutes");
    expect(fns.saveAssessment).not.toHaveBeenCalled();
  });

  it("won't save a ready test when a candidate could get fewer questions", async () => {
    state.bank = [question({}), question({ id: Q2, title: "Two sum", topics: ["strings"] })];
    state.assessment = { ...assessmentRow(ORG, { ...emptyAssessment(), title: "Campus round 1", status: "ready",
      sections: [{ type: "coding", title: "Coding", question_ids: [],
        pick: [{ difficulty: "", topics: "", count: 1 }, { difficulty: "", topics: "arrays", count: 1 }] }] }),
      id: Q2, created_at: "", updated_at: "" };
    renderAt(`/assess/tests/${ORG}/${Q2}`);
    expect(await screen.findByText(/1 any-difficulty arrays · 1 verified in bank \(only 0 certain/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save test" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("fewer questions than this test asks for");
    expect(fns.saveAssessment).not.toHaveBeenCalled();
  });

  it("a chosen question that was retired blocks a ready test and can be removed", async () => {
    // The pool holds verified questions only; Q2 was chosen earlier and has since been retired.
    state.bank = [question({}), question({ id: Q2, title: "Old one", status: "retired" })];
    state.assessment = { ...assessmentRow(ORG, { ...emptyAssessment(), title: "Campus round 1", status: "ready",
      sections: [{ type: "coding", title: "Coding", question_ids: [Q1, Q2], pick: [] }] }), id: Q2, created_at: "", updated_at: "" };
    fns.saveAssessment.mockResolvedValue(Q2);
    renderAt(`/assess/tests/${ORG}/${Q2}`);
    expect(await screen.findByText(/1 chosen question is no longer verified/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save test" }));
    await waitFor(() => expect(screen.getAllByRole("alert").some((a) => /fewer questions than this test asks for/.test(a.textContent ?? ""))).toBe(true));
    expect(fns.saveAssessment).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Remove it" }));
    fireEvent.click(screen.getByRole("button", { name: "Save test" }));
    await waitFor(() => expect(fns.saveAssessment).toHaveBeenCalled());
    expect(fns.saveAssessment.mock.calls[0][1].sections[0].question_ids).toEqual([Q1]);
  });

  it("loads an existing test for editing and updates it", async () => {
    state.bank = [question({})];
    state.assessment = { ...assessmentRow(ORG, { ...emptyAssessment(), title: "Existing test", duration_min: 90 }), id: Q2,
      created_at: "", updated_at: "", status: "ready" };
    fns.saveAssessment.mockResolvedValue(Q2);
    renderAt(`/assess/tests/${ORG}/${Q2}`);
    expect(await screen.findByDisplayValue("Existing test")).toBeInTheDocument();
    expect(screen.getByDisplayValue("90")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save test" }));
    await waitFor(() => expect(fns.saveAssessment).toHaveBeenCalledWith(Q2, expect.objectContaining({ title: "Existing test", status: "ready" })));
  });
});
