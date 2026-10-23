// @vitest-environment node
// b2b-assess handlers with a fake database, fake Judge0 and fake AI gateway (no network).
import { describe, it, expect, vi } from "vitest";
import { makeHandlers, toAttemptState, type Deps } from "../../functions/b2b-assess/handlers";
import { assessContract } from "../../functions/_shared/contracts/assess";
import type { Judge0Client, RunOutcome, RunRequest } from "../../functions/_shared/judge0";

const A = "11111111-1111-4111-8111-111111111111";
const S = "22222222-2222-4222-8222-222222222222";
const Q = "33333333-3333-4333-8333-333333333333";
const SUB = "44444444-4444-4444-8444-444444444444";
const ACTOR = "55555555-5555-4555-8555-555555555555";

const tests = [
  { id: "t1", input: "1 2", expected_output: "3", is_sample: true, weight: 1 },
  { id: "t2", input: "5 5", expected_output: "10", is_sample: false, weight: 3 },
];
const codingQ = { ok: true, type: "coding", points: 10, languages: ["python"], time_limit_ms: 1000, memory_limit_kb: null, tests };

/** Judge0 fake: adds the two numbers in stdin (a correct solution) unless told otherwise. */
function fakeJudge(impl?: (r: RunRequest) => Partial<RunOutcome>): Judge0Client & { runs: RunRequest[] } {
  const runs: RunRequest[] = [];
  return {
    runs,
    async run(rs) {
      runs.push(...rs);
      return rs.map((r) => ({
        status: "ran" as const, stdout: String(r.stdin.split(" ").map(Number).reduce((a, b) => a + b, 0)), stderr: "",
        compileOutput: "", timeMs: 5, memoryKb: 100, judgeStatusId: 3, ...(impl?.(r) ?? {}),
      }));
    },
  };
}

function setup(over: Partial<Deps> & { db?: Record<string, (args: Record<string, unknown>) => unknown> } = {}) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const db: Record<string, (args: Record<string, unknown>) => unknown> = {
    b2b_runner_question: () => codingQ,
    b2b_create_submission: () => ({ ok: true, submission_id: SUB }),
    b2b_record_judge_result: () => ({ ok: true }),
    ...(over.db ?? {}),
  };
  const deps: Deps = {
    rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      if (!db[fn]) throw new Error(`unexpected rpc ${fn}`);
      return db[fn](args);
    }),
    judge0: over.judge0 === undefined ? fakeJudge() : over.judge0,
    ai: over.ai ?? (vi.fn() as unknown as Deps["ai"]),
    random: () => 0.5,
  };
  return { h: makeHandlers(deps), calls, deps };
}

const stateRow = {
  ok: true, attempt_id: A, status: "in_progress", deadline_at: "2026-10-21T10:00:00+00:00", server_now: "2026-10-21T09:00:00+00:00",
  paused: false, session_id: S, title: "Placement test", watermark: "a01@college.in", policy: "strict", proctoring_session_id: null, result: null,
  questions: [
    { id: Q, type: "coding", title: "Sum", statement: "Add two numbers.", difficulty: "easy", points: 10, section: "Coding",
      languages: ["python"], starter_code: { python: "" }, samples: [{ input: "1 2", output: "3" }], options: null,
      multi_select: null, constraints: null, saved: { language: "python", code: "x", mcq_choice: null, seq: 4 } },
    { id: SUB, type: "mcq", title: "Pick", statement: "Pick the right one.", difficulty: "easy", points: 1, section: "MCQ",
      languages: null, starter_code: null, samples: null, options: [{ id: "b", text: "B" }, { id: "a", text: "A" }],
      multi_select: false, constraints: null, saved: null },
  ],
};

describe("state mapping", () => {
  it("produces contract-valid runner state without nulls where the contract wants absence", () => {
    const st = toAttemptState(stateRow);
    expect(assessContract.state.output.safeParse(st).success).toBe(true);
    expect(st.questions[1]).not.toHaveProperty("languages");
    expect(st.questions[0].saved).toEqual({ language: "python", code: "x", mcq_choice: null, seq: 4 });
    expect(st.proctoring).toEqual({ policy: "strict", sessionId: null });
  });
});

describe("runner", () => {
  it("start: practice needs an assessment id; refusals become HTTP errors", async () => {
    const { h } = setup({ db: { b2b_start_attempt: () => ({ ok: false, reason: "OTHER_SESSION" }) } });
    await expect(h.start({ context: "practice", contextId: null }, ACTOR)).rejects.toMatchObject({ status: 400 });
    await expect(h.start({ context: "practice", contextId: null, assessmentId: A }, ACTOR)).rejects.toMatchObject({ status: 409, code: "OTHER_SESSION" });
  });

  it("start then state, passing the tab's session id", async () => {
    const { h, calls } = setup({ db: { b2b_start_attempt: () => ({ ok: true, attempt_id: A, session_id: S }), b2b_attempt_state: () => stateRow } });
    const st = await h.start({ context: "drive", contextId: Q, sessionId: S }, ACTOR);
    expect(st.attemptId).toBe(A);
    expect(calls[0].args).toMatchObject({ _actor: ACTOR, _context: "drive", _context_id: Q, _assessment_id: null, _session: S });
    expect(calls[1]).toMatchObject({ fn: "b2b_attempt_state", args: { _attempt_id: A, _session: S } });
  });

  it("run: samples + custom input only, never hidden tests; 503 without Judge0", async () => {
    const judge = fakeJudge();
    const { h, calls } = setup({ judge0: judge });
    const res = await h.run({ attemptId: A, sessionId: S, questionId: Q, language: "python", code: "print(...)", customInput: "7 8" }, ACTOR);
    expect(judge.runs.map((r) => r.stdin)).toEqual(["1 2", "7 8"]);
    expect(res.tests).toHaveLength(1);
    expect(res.tests[0]).toMatchObject({ sample: true, passed: true, stdout: "3", expected: "3" });
    expect(res.custom).toMatchObject({ stdout: "15", status: "ok" });
    expect(JSON.stringify(res)).not.toContain("5 5");
    expect(assessContract.run.output.safeParse(res).success).toBe(true);
    expect(calls.find((c) => c.fn === "b2b_create_submission")!.args).toMatchObject({ _kind: "run" });

    const none = setup({ judge0: null });
    await expect(none.h.run({ attemptId: A, sessionId: S, questionId: Q, language: "python", code: "" }, ACTOR))
      .rejects.toMatchObject({ status: 503, code: "JUDGE0_NOT_CONFIGURED" });
  });

  it("run refuses languages the question doesn't allow", async () => {
    const { h } = setup();
    await expect(h.run({ attemptId: A, sessionId: S, questionId: Q, language: "java", code: "" }, ACTOR)).rejects.toMatchObject({ code: "LANGUAGE_NOT_ALLOWED" });
  });

  it("submitQuestion grades coding inline with weighted tests; queued when Judge0 is missing or down", async () => {
    const half = fakeJudge((r) => (r.stdin === "5 5" ? { stdout: "11" } : {}));
    const { h, calls } = setup({ judge0: half });
    expect(await h.submitQuestion({ attemptId: A, sessionId: S, questionId: Q, language: "python", code: "x" }, ACTOR))
      .toEqual({ submissionId: SUB, status: "done" });
    const rec = calls.find((c) => c.fn === "b2b_record_judge_result")!.args;
    expect(rec).toMatchObject({ _status: "done", _passed: 1, _total: 2, _score: 2.5, _max_score: 10 });
    expect(JSON.stringify(rec._results)).not.toContain('"stdout":"11"');   // hidden test output not stored

    const none = setup({ judge0: null });
    expect(await none.h.submitQuestion({ attemptId: A, sessionId: S, questionId: Q, language: "python", code: "x" }, ACTOR)).toMatchObject({ status: "queued" });
    const { Judge0Error } = await import("../../functions/_shared/judge0");
    const down = setup({ judge0: { run: async () => { throw new Judge0Error("JUDGE0_UNAVAILABLE", "down"); } } });
    expect(await down.h.submitQuestion({ attemptId: A, sessionId: S, questionId: Q, language: "python", code: "x" }, ACTOR)).toMatchObject({ status: "queued" });
    expect(down.calls.find((c) => c.fn === "b2b_record_judge_result")!.args).toMatchObject({ _status: "queued" });
  });

  it("submitQuestion for MCQs stores the choice (scored at the end)", async () => {
    const { h, calls } = setup({ db: { b2b_runner_question: () => ({ ok: true, type: "mcq", points: 1, languages: [], tests: [] }) } });
    expect(await h.submitQuestion({ attemptId: A, sessionId: S, questionId: Q, mcq_choice: ["a"] }, ACTOR)).toMatchObject({ status: "done" });
    expect(calls.find((c) => c.fn === "b2b_create_submission")!.args).toMatchObject({ _mcq_choice: ["a"], _code: null });
  });

  it("finish grades the queued finals", async () => {
    const { h, calls } = setup({ db: {
      b2b_finish_attempt: () => ({ ok: true, pending: [SUB] }),
      b2b_claim_pending_submissions: () => [{ id: SUB, language: "python", code: "x", points: 10, tests, time_limit_ms: null, memory_limit_kb: null }],
    } });
    expect(await h.finish({ attemptId: A, sessionId: S, reason: "violations" }, ACTOR)).toEqual({ ok: true });
    expect(calls[0].args).toMatchObject({ _reason: "violations" });
    expect(calls.find((c) => c.fn === "b2b_claim_pending_submissions")!.args).toMatchObject({ _ids: [SUB] });
    expect(calls.find((c) => c.fn === "b2b_record_judge_result")!.args).toMatchObject({ _score: 10 });
  });

  it("heartbeat passes OTHER_SESSION through", async () => {
    const { h } = setup({ db: { b2b_attempt_heartbeat: () => ({ ok: false, reason: "OTHER_SESSION", status: "in_progress", deadline_at: null, server_now: "now", paused: false }) } });
    const r = await h.heartbeat({ attemptId: A, sessionId: S }, ACTOR);
    expect(r).toMatchObject({ ok: false, reason: "OTHER_SESSION" });
    expect(assessContract.heartbeat.output.safeParse(r).success).toBe(true);
  });
});

describe("bank", () => {
  const forVerify = { ok: true, type: "coding", version: 2, time_limit_ms: 1000, memory_limit_kb: null, tests,
                      references: [{ language: "python", code: "ref" }] };

  it("verifyQuestion runs the reference on every test and records the result", async () => {
    const { h, calls } = setup({ db: { b2b_question_for_verify: () => forVerify, b2b_record_verification: (a) => ({ ok: true, status: a._passed ? "verified" : "draft" }) } });
    expect(await h.verifyQuestion({ questionId: Q }, ACTOR)).toEqual({ status: "verified", failures: [] });
    expect(calls.at(-1)!.args).toMatchObject({ _version: 2, _passed: true });

    const wrong = setup({ judge0: fakeJudge(() => ({ stdout: "0" })), db: { b2b_question_for_verify: () => forVerify, b2b_record_verification: (a) => ({ ok: true, status: a._passed ? "verified" : "draft" }) } });
    expect(await wrong.h.verifyQuestion({ questionId: Q }, ACTOR)).toEqual({ status: "draft", failures: [{ testId: "t1", status: "wrong_answer" }, { testId: "t2", status: "wrong_answer" }] });

    const none = setup({ judge0: null, db: { b2b_question_for_verify: () => forVerify } });
    await expect(none.h.verifyQuestion({ questionId: Q }, ACTOR)).rejects.toMatchObject({ status: 503, code: "JUDGE0_NOT_CONFIGURED" });
  });

  it("MCQs verify without the sandbox", async () => {
    const { h, calls } = setup({ judge0: null, db: { b2b_question_for_verify: () => ({ ok: true, type: "mcq", version: 1 }), b2b_record_verification: () => ({ ok: true, status: "verified" }) } });
    expect(await h.verifyQuestion({ questionId: Q }, ACTOR)).toMatchObject({ status: "verified" });
    expect(calls.at(-1)!.args).toMatchObject({ _passed: true });
  });

  const generated = {
    title: "Lantern rows", statement: "Count lanterns lit in each row of the festival.", difficulty: "easy", topics: ["arrays"],
    constraints: "1 ≤ n ≤ 10^5", starter_code: { python: "", java: "", cpp: "", javascript: "" },
    tests: [{ input: "1 2", output: "3", sample: false }, ...Array.from({ length: 5 }, (_, i) => ({ input: `${i} 1`, output: String(i + 1), sample: false }))],
    reference_solution: { language: "python", code: "print(sum(map(int,input().split())))" },
  };

  it("generateQuestions: coding questions are saved, then verified in the sandbox", async () => {
    const ai = vi.fn(async (req: { parse: (x: unknown) => { success: boolean; data?: unknown } }) => ({ ok: true, data: req.parse(generated).data, cacheHit: false }));
    const saved: Record<string, unknown>[] = [];
    const { h } = setup({ ai: ai as unknown as Deps["ai"], db: {
      actor_is_org_editor: () => true,
      b2b_save_question_as: (a) => { saved.push(a._q as Record<string, unknown>); return { ok: true, question_id: Q, status: "draft" }; },
      b2b_question_for_verify: () => ({ ...forVerify, tests: (saved[0].tests as { input: string; expected_output: string; is_sample: boolean }[]).map((t, i) => ({ id: `t${i}`, weight: 1, ...t })) }),
      b2b_record_verification: (a) => ({ ok: true, status: a._passed ? "verified" : "draft" }),
    } });
    const out = await h.generateQuestions({ orgId: A, type: "coding", topic: "arrays", difficulty: "easy", count: 1 }, ACTOR);
    expect(out.created).toEqual([{ questionId: Q, status: "verified" }]);
    expect(saved[0]).toMatchObject({ type: "coding", source: "ai", points: 10, org_id: A });
    expect((saved[0].tests as { is_sample: boolean }[]).filter((t) => t.is_sample)).toHaveLength(2);   // samples added when missing
    expect(ai.mock.calls[0][0]).toMatchObject({ feature: "question.generate", orgId: A, userId: ACTOR });
    expect(assessContract.generateQuestions.output.safeParse(out).success).toBe(true);
  });

  it("generateQuestions: drafts without Judge0, MCQs as drafts, forbidden for non-editors, errors surfaced", async () => {
    const ai = vi.fn(async (req: { parse: (x: unknown) => { success: boolean; data?: unknown } }) => ({ ok: true, data: req.parse(generated).data, cacheHit: false }));
    const noJudge = setup({ judge0: null, ai: ai as unknown as Deps["ai"], db: { actor_is_org_editor: () => true, b2b_save_question_as: () => ({ ok: true, question_id: Q }) } });
    expect((await noJudge.h.generateQuestions({ orgId: A, type: "coding", topic: "arrays", difficulty: "easy", count: 2 }, ACTOR)).created)
      .toEqual([expect.objectContaining({ status: "draft" }), expect.objectContaining({ status: "draft" })]);

    const mcq = { title: "Train speed", statement: "A train covers 120 km in 2 hours. Speed?", difficulty: "easy", category: "aptitude",
                  topics: ["speed"], options: [{ id: "a", text: "60" }, { id: "b", text: "40" }], answer: ["a"], explanation: "120/2" };
    const mcqAi = vi.fn(async (req: { parse: (x: unknown) => { success: boolean; data?: unknown } }) => ({ ok: true, data: req.parse(mcq).data, cacheHit: false }));
    const savedMcq: Record<string, unknown>[] = [];
    const m = setup({ ai: mcqAi as unknown as Deps["ai"], db: { actor_is_super_admin: () => true, b2b_save_question_as: (a) => { savedMcq.push(a._q as Record<string, unknown>); return { ok: true, question_id: Q }; } } });
    expect((await m.h.generateQuestions({ orgId: null, type: "mcq", topic: "speed", difficulty: "easy", count: 1 }, ACTOR)).created[0].status).toBe("draft");
    expect(savedMcq[0]).toMatchObject({ org_id: null, multi_select: false, category: "aptitude", status: "draft" });

    const no = setup({ db: { actor_is_org_editor: () => false } });
    await expect(no.h.generateQuestions({ orgId: A, type: "mcq", topic: "x", difficulty: "easy", count: 1 }, ACTOR)).rejects.toMatchObject({ status: 403 });

    const failing = setup({ ai: (async () => ({ ok: false, code: "INVALID_OUTPUT", message: "bad" })) as unknown as Deps["ai"], db: { actor_is_org_editor: () => true } });
    await expect(failing.h.generateQuestions({ orgId: A, type: "mcq", topic: "x", difficulty: "easy", count: 1 }, ACTOR)).rejects.toMatchObject({ status: 502 });
    const quota = setup({ ai: (async () => ({ ok: false, code: "QUOTA_EXCEEDED", message: "limit" })) as unknown as Deps["ai"], db: { actor_is_org_editor: () => true } });
    await expect(quota.h.generateQuestions({ orgId: A, type: "mcq", topic: "x", difficulty: "easy", count: 1 }, ACTOR)).rejects.toMatchObject({ status: 429 });
  });

  it("gradePending does nothing without Judge0", async () => {
    const { h } = setup({ judge0: null });
    expect(await h.gradePending(5)).toEqual({ graded: 0, reason: "JUDGE0_NOT_CONFIGURED" });
  });
});
