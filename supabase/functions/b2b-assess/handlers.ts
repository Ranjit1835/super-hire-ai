// b2b-assess logic, with the database, Judge0 and the AI gateway injected (index.ts wires them for Deno),
// so it is unit-tested in Node with fakes (supabase/tests/unit/b2b-assess-handlers.test.ts).
// Authorization lives in the SQL functions (supabase/migrations/20261021000006_b2b_v1_assessment.sql): every call passes the actor.
import {
  GeneratedMcq, GeneratedQuestion, McqSolution, mcqCheckReason, type AttemptState, type JudgeResult, type McqCheck, type RunnerQuestion,
} from "../_shared/contracts/assess.ts";
export { mcqCheckReason } from "../_shared/contracts/assess.ts";
import type { GatewayRequest, GatewayResult } from "../_shared/ai-gateway/core.ts";
import {
  Judge0Error, codingScore, judgeTests, summarize, type Judge0Client, type Language, type TestCase,
} from "../_shared/judge0.ts";

export class AssessError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export interface Deps {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<unknown>;
  judge0: Judge0Client | null;
  ai: <T>(req: GatewayRequest<T>) => Promise<GatewayResult<T>>;
  random?: () => number;
}

type Json = Record<string, unknown>;

const REASONS: Record<string, [number, string]> = {
  NOT_FOUND: [404, "That test doesn't exist."],
  NOT_ELIGIBLE: [403, "This test isn't assigned to you."],
  NOT_AVAILABLE: [403, "This test isn't open for practice."],
  PRACTICE_USED: [409, "You've already used your practice run for this test."],
  NOT_OPEN: [403, "This test isn't open."],
  NOT_OPEN_YET: [403, "This test hasn't opened yet. Please come back at the start time."],
  WINDOW_CLOSED: [403, "The time window for this test has closed."],
  TOO_LATE: [403, "The joining window for this test has passed."],
  INVITE_EXPIRED: [403, "Your invitation has expired. Please ask the recruiter for a new link."],
  NO_ASSESSMENT: [409, "No test has been set up here yet."],
  NO_QUESTIONS: [409, "This test has no questions yet. Please tell the organiser."],
  NO_CREDITS: [402, "Your college has run out of practice credits. Please tell your placement office."],
  ORG_SUSPENDED: [403, "This organisation's account is paused."],
  PLAN_EXPIRED: [403, "This organisation's plan has ended."],
  OTHER_SESSION: [409, "This test is open in another tab or device. Close it there, or wait a minute and try again."],
  ENDED: [409, "This test has ended."],
  DEADLINE_PASSED: [409, "Time is up for this test."],
  PAUSED: [423, "The test is paused. Fix the proctoring issue to continue."],
  NOT_IN_ATTEMPT: [400, "That question isn't part of your test."],
  RATE_LIMITED: [429, "You're running code very often. Please wait a few seconds."],
  BAD_CONTEXT: [400, "Unknown test type."],
  BAD_TYPE: [400, "Unknown question type."],
  NEED_TESTS: [400, "A coding question needs at least two tests, one of them a sample."],
  NEED_REFERENCE: [400, "A coding question needs a reference solution."],
  ANSWER_NOT_AN_OPTION: [400, "The correct answer must be one of the options."],
  CHANGED: [409, "The question changed while it was being checked. Please verify again."],
  RETIRED: [409, "Retired questions can't be verified."],
  LOCKED: [409, "That question is closed: this test goes one question at a time, with no going back."],
  NOT_LINEAR: [400, "This test lets you move between questions freely."],
};

export function refuse(reason: string | undefined): never {
  const [status, msg] = REASONS[reason ?? ""] ?? [400, "Request refused."];
  throw new AssessError(status, reason ?? "REFUSED", msg);
}

const JUDGE0_MISSING = () =>
  new AssessError(503, "JUDGE0_NOT_CONFIGURED", "The code runner isn't set up yet, so code can't be run. Your answers are still saved.");
const JUDGE0_DOWN = () =>
  new AssessError(503, "JUDGE0_UNAVAILABLE", "The code runner isn't responding right now. Your code is saved; please try again shortly.");

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

function asTests(v: unknown): TestCase[] {
  return (Array.isArray(v) ? v : []) as TestCase[];
}

// ── Runner state mapping ─────────────────────────────────────────────────────
export function toRunnerQuestion(q: Json): RunnerQuestion {
  const out: RunnerQuestion = {
    id: String(q.id), type: q.type as "coding" | "mcq", title: String(q.title), statement: String(q.statement),
    difficulty: q.difficulty as RunnerQuestion["difficulty"], points: num(q.points),
    saved: q.saved ? {
      language: (q.saved as Json).language as string | null ?? null,
      code: (q.saved as Json).code as string | null ?? null,
      mcq_choice: Array.isArray((q.saved as Json).mcq_choice) ? ((q.saved as Json).mcq_choice as string[]) : null,
      seq: num((q.saved as Json).seq),
    } : null,
  };
  if (typeof q.section === "string") out.section = q.section;
  if (q.constraints !== undefined) out.constraints = (q.constraints as string | null) ?? null;
  if (Array.isArray(q.languages)) out.languages = q.languages as RunnerQuestion["languages"];
  if (q.starter_code && typeof q.starter_code === "object") out.starter_code = q.starter_code as Record<string, string>;
  if (Array.isArray(q.samples)) out.samples = q.samples as { input: string; output: string }[];
  if (Array.isArray(q.options)) out.options = q.options as { id: string; text: string }[];
  if (typeof q.multi_select === "boolean") out.multi_select = q.multi_select;
  return out;
}

export function toAttemptState(r: Json): AttemptState {
  const res = r.result as Json | null | undefined;
  return {
    attemptId: String(r.attempt_id),
    status: r.status as AttemptState["status"],
    deadline_at: (r.deadline_at as string | null) ?? null,
    server_now: String(r.server_now),
    paused: !!r.paused,
    sessionId: String(r.session_id),
    title: typeof r.title === "string" ? r.title : undefined,
    watermark: typeof r.watermark === "string" ? r.watermark : undefined,
    questions: (Array.isArray(r.questions) ? r.questions as Json[] : []).map(toRunnerQuestion),
    result: res ? {
      score: numOrNull(res.score), max_score: numOrNull(res.max_score),
      grading: res.grading === "complete" ? "complete" : "pending",
      section_scores: (Array.isArray(res.section_scores) ? res.section_scores as Json[] : []).map((s) => ({
        title: String(s.title ?? ""), type: String(s.type ?? ""), score: num(s.score), max_score: num(s.max_score),
      })),
    } : null,
    proctoring: { policy: String(r.policy ?? "standard"), sessionId: (r.proctoring_session_id as string | null) ?? null },
    ...(r.navigation && typeof r.navigation === "object" ? { navigation: {
      mode: (r.navigation as Json).mode === "linear" ? "linear" as const : "free" as const,
      index: num((r.navigation as Json).index), total: num((r.navigation as Json).total),
    } } : {}),
  };
}

// ── AI generation prompts ────────────────────────────────────────────────────
const CODING_SCHEMA = {
  type: "object",
  required: ["title", "statement", "difficulty", "topics", "constraints", "starter_code", "tests", "reference_solution"],
  properties: {
    title: { type: "string" },
    statement: { type: "string", description: "Markdown. Input and output format, with one worked example." },
    difficulty: { type: "string", enum: ["easy", "medium", "hard"] },
    topics: { type: "array", items: { type: "string" } },
    constraints: { type: "string" },
    starter_code: {
      type: "object", required: ["python", "java", "cpp", "javascript"],
      properties: { python: { type: "string" }, java: { type: "string" }, cpp: { type: "string" }, javascript: { type: "string" } },
    },
    tests: {
      type: "array",
      items: { type: "object", required: ["input", "output", "sample"],
               properties: { input: { type: "string" }, output: { type: "string" }, sample: { type: "boolean" } } },
    },
    reference_solution: {
      type: "object", required: ["language", "code"],
      properties: { language: { type: "string", enum: ["python"] }, code: { type: "string" } },
    },
    params: { type: "object", description: "The concrete numbers or names you chose for this variant." },
  },
};

const MCQ_SCHEMA = {
  type: "object",
  required: ["title", "statement", "difficulty", "category", "topics", "options", "answer", "explanation"],
  properties: {
    title: { type: "string" },
    statement: { type: "string" },
    difficulty: { type: "string", enum: ["easy", "medium", "hard"] },
    category: { type: "string", enum: ["aptitude", "cs_fundamentals", "technical"] },
    topics: { type: "array", items: { type: "string" } },
    options: { type: "array", items: { type: "object", required: ["id", "text"], properties: { id: { type: "string" }, text: { type: "string" } } } },
    answer: { type: "array", items: { type: "string" }, description: "ids of the correct options" },
    explanation: { type: "string" },
  },
};

const CODING_SYSTEM = `You write ORIGINAL programming problems for proctored campus-placement and hiring tests in India.
Rules:
- Never reproduce a well-known problem (LeetCode, HackerRank, Codeforces, GeeksforGeeks) or its title verbatim. Use a fresh
  scenario and concrete parameters (numbers, names, limits) chosen from the variant seed, so each variant differs.
- The program reads all input from standard input and prints the answer to standard output. State the exact input
  and output formats. No interactive problems, no floating-point answers unless rounding is exactly specified.
- tests: 2 tests with sample=true (shown to the candidate) and 6 to 12 hidden tests (sample=false) covering edge cases
  (minimum sizes, maximum values, duplicates, negative numbers where allowed). Every output must be exactly what the
  reference solution prints.
- reference_solution: correct, efficient Python 3 that passes every test within 2 seconds.
- starter_code: a minimal stub per language that reads the input and leaves the logic to the candidate (no solution).
- Plain, clear English suitable for students.`;

const MCQ_SYSTEM = `You write ORIGINAL multiple-choice questions for campus-placement and hiring tests in India.
Rules:
- Never copy questions from question banks or past papers. Use fresh numbers and wording based on the variant seed.
- 4 options with ids "a", "b", "c", "d". Exactly one correct answer unless the question says "select all that apply".
- category: "aptitude" (quantitative, logical, verbal reasoning), "cs_fundamentals" (OS, DBMS, networks, OOP, data
  structures) or "technical" (a language, framework or tool).
- explanation: one short paragraph explaining why the answer is right.
- Unambiguous, plain English.`;

// R2.3: the independent check solves the question without the key; the server compares.
const MCQ_SOLUTION_SCHEMA = {
  type: "object",
  required: ["answer", "confidence", "ambiguous", "note"],
  properties: {
    answer: { type: "array", items: { type: "string" }, description: "ids of the option(s) you believe are correct" },
    confidence: { type: "number", description: "0 to 1: how sure you are that your answer is the only correct one" },
    ambiguous: { type: "boolean", description: "true if the question is unclear, has no correct option, or more than one defensible answer" },
    note: { type: "string", description: "one or two sentences: your working, or what is wrong with the question" },
  },
};

const MCQ_VALIDATE_SYSTEM = `You check multiple-choice questions for a hiring test before students see them.
Solve the question yourself, carefully and step by step in your head, then report:
- answer: the id(s) of the correct option(s). If it says exactly one option is correct, give one id.
- confidence: how sure you are (0 to 1).
- ambiguous: true if the wording is unclear, no option is correct, or more than one option is defensible.
- note: your short working, or the problem with the question.
You are NOT told the intended answer. Do not guess what the author wanted; answer what is actually correct.`;

/** Normalised set of option ids, for comparing the check with the key. */
export function optionSet(ids: unknown, valid: string[]): string[] {
  return Array.from(new Set((Array.isArray(ids) ? ids : []).map(String).filter((x) => valid.includes(x)))).sort();
}

const POINTS: Record<string, number> = { easy: 10, medium: 20, hard: 30 };

export function codingPayload(orgId: string | null, g: GeneratedQuestion, nonce: string): Json {
  const tests = g.tests.map((t) => ({ input: t.input, expected_output: t.output, is_sample: t.sample, weight: 1 }));
  if (!tests.some((t) => t.is_sample)) tests.slice(0, 2).forEach((t) => { t.is_sample = true; });
  const languages = Array.from(new Set([...Object.keys(g.starter_code), g.reference_solution.language]));
  return {
    org_id: orgId, type: "coding", title: g.title, statement: g.statement, difficulty: g.difficulty, topics: g.topics,
    languages, starter_code: g.starter_code, constraints: g.constraints, time_limit_ms: 2000, memory_limit_kb: 256000,
    tests, reference: g.reference_solution, points: POINTS[g.difficulty] ?? 10, source: "ai",
    params: { ...(g.params ?? {}), variant: nonce },
  };
}

export function mcqPayload(orgId: string | null, g: GeneratedMcq): Json {
  return {
    org_id: orgId, type: "mcq", title: g.title, statement: g.statement, difficulty: g.difficulty, topics: g.topics,
    category: g.category, options: g.options, answer: g.answer, multi_select: g.answer.length > 1,
    explanation: g.explanation, points: 1, source: "ai", status: "draft",
  };
}

// ── Handlers ─────────────────────────────────────────────────────────────────
export function makeHandlers(deps: Deps) {
  const rpc = async (fn: string, args: Record<string, unknown>) => (await deps.rpc(fn, args)) as Json;
  const rand = deps.random ?? Math.random;

  async function state(actor: string, attemptId: string, sessionId: string | null): Promise<AttemptState> {
    const r = await rpc("b2b_attempt_state", { _actor: actor, _attempt_id: attemptId, _session: sessionId });
    if (!r.ok) refuse(r.reason as string);
    return toAttemptState(r);
  }

  async function record(id: string, status: string, results: unknown, compile: string | null, passed: number | null,
                        total: number | null, score: number | null, max: number | null) {
    await rpc("b2b_record_judge_result", { _submission_id: id, _status: status, _results: results, _compile_output: compile,
                                           _passed: passed, _total: total, _score: score, _max_score: max });
  }

  /** Grade claimed submissions with every test. Stops (leaving the rest queued) if Judge0 goes away. */
  async function gradeClaimed(items: Json[]): Promise<number> {
    let graded = 0;
    for (let i = 0; i < items.length; i++) {
      const s = items[i];
      try {
        const sum = await judgeTests(deps.judge0!, s.language as Language, String(s.code ?? ""), asTests(s.tests),
                                     { timeLimitMs: numOrNull(s.time_limit_ms), memoryLimitKb: numOrNull(s.memory_limit_kb) });
        const points = num(s.points);
        await record(String(s.id), "done", sum.tests, sum.compile_output, sum.passed, sum.total, codingScore(points, sum), points);
        graded++;
      } catch (e) {
        if (!(e instanceof Judge0Error)) throw e;
        for (const rest of items.slice(i)) await record(String(rest.id), "queued", null, null, null, null, null, null);
        break;
      }
    }
    return graded;
  }

  async function canEdit(actor: string, orgId: string | null): Promise<boolean> {
    if (orgId === null) return !!(await deps.rpc("actor_is_super_admin", { _actor: actor }));
    return !!(await deps.rpc("actor_is_org_editor", { _actor: actor, _org_id: orgId }));
  }

  /** R2.3: solve the MCQ blind with a separate model call, compare with the key, store the result for this version. */
  async function checkMcq(actor: string, questionId: string, q: Json): Promise<McqCheck> {
    const options = (Array.isArray(q.options) ? q.options : []) as { id: string; text: string }[];
    const ids = options.map((o) => String(o.id));
    const brief = `Question:\n${String(q.statement)}\n\nOptions:\n${options.map((o) => `${o.id}) ${o.text}`).join("\n")}\n\n`
      + (q.multi_select ? "Select ALL correct options." : "Exactly one option is correct.");
    const g = await deps.ai({
      feature: "mcq.validate", orgId: (q.org_id as string | null) ?? null, userId: actor, system: MCQ_VALIDATE_SYSTEM,
      messages: [{ role: "user", content: brief }], cacheInput: { statement: q.statement, options, multi: !!q.multi_select },
      jsonSchema: MCQ_SOLUTION_SCHEMA, schemaName: "mcq_solution", parse: McqSolution.safeParse,
    });
    if (!g.ok) {
      if (g.code === "QUOTA_EXCEEDED") throw new AssessError(429, "QUOTA_EXCEEDED", "This month's question-check limit is used up.");
      throw new AssessError(502, "CHECK_FAILED", "Couldn't check the answer right now. Please try again.");
    }
    const answer = optionSet(g.data.answer, ids);
    const key = optionSet(q.answer, ids);
    const check: McqCheck = {
      answer, agrees: answer.length > 0 && answer.join() === key.join(), ambiguous: g.data.ambiguous,
      confidence: g.data.confidence, note: g.data.note,
    };
    const r = await rpc("b2b_record_mcq_check", { _actor: actor, _question_id: questionId, _version: q.version,
                                                  _check: { ...check, model: "mcq-validate-v1" } });
    if (!r.ok) refuse(r.reason as string);
    return check;
  }

  async function verify(actor: string, questionId: string) {
    const q = await rpc("b2b_question_for_verify", { _actor: actor, _question_id: questionId });
    if (!q.ok) refuse(q.reason as string);
    if (q.type === "mcq") {
      const stored = q.mcq_check as Json | null;
      const check: McqCheck = stored && Number(stored.version) === Number(q.version)
        ? { answer: (stored.answer as string[]) ?? [], agrees: !!stored.agrees, ambiguous: !!stored.ambiguous,
            confidence: Number(stored.confidence ?? 0), note: String(stored.note ?? "") }
        : await checkMcq(actor, questionId, q);
      const v = await rpc("b2b_record_verification", { _actor: actor, _question_id: questionId, _version: q.version, _passed: null });
      if (!v.ok) refuse(v.reason as string);
      return { status: v.status as "verified" | "draft", failures: [], check, version: Number(q.version) };
    }
    if (!deps.judge0) throw JUDGE0_MISSING();
    const ref = (q.references as Json[] | undefined)?.[0];
    const tests = asTests(q.tests);
    let failures: { testId: string; status: string }[] = [];
    let passed = false;
    if (ref && tests.length > 0) {
      try {
        const sum = await judgeTests(deps.judge0, ref.language as Language, String(ref.code), tests,
                                     { timeLimitMs: numOrNull(q.time_limit_ms), memoryLimitKb: numOrNull(q.memory_limit_kb) });
        passed = sum.total > 0 && sum.passed === sum.total;
        failures = sum.tests.filter((t) => !t.passed).map((t) => ({ testId: t.test_id, status: t.status }));
      } catch (e) {
        if (e instanceof Judge0Error) throw JUDGE0_DOWN();
        throw e;
      }
    }
    const v = await rpc("b2b_record_verification", { _actor: actor, _question_id: questionId, _version: q.version, _passed: passed });
    if (!v.ok) refuse(v.reason as string);
    return { status: v.status as "verified" | "draft", failures };
  }

  return {
    async generateQuestions(input: { orgId: string | null; type: "coding" | "mcq"; topic: string; difficulty: "easy" | "medium" | "hard"; role?: string; count: number }, actor: string) {
      if (!(await canEdit(actor, input.orgId))) throw new AssessError(403, "FORBIDDEN", "You can't add questions here.");
      const created: { questionId: string; status: "verified" | "draft"; reason?: string }[] = [];
      let lastError = "";
      for (let i = 0; i < input.count; i++) {
        const nonce = Math.floor(rand() * 1e9).toString(36);
        const brief = `Topic: ${input.topic}\nDifficulty: ${input.difficulty}\n${input.role ? `Role: ${input.role}\n` : ""}Variant seed: ${nonce}`;
        const common = { orgId: input.orgId, userId: actor, messages: [{ role: "user" as const, content: brief }],
                         cacheInput: { type: input.type, topic: input.topic, difficulty: input.difficulty, role: input.role ?? null, nonce } };
        if (input.type === "coding") {
          const g = await deps.ai({ ...common, feature: "question.generate", system: CODING_SYSTEM, jsonSchema: CODING_SCHEMA,
                                    schemaName: "coding_question", parse: GeneratedQuestion.safeParse });
          if (!g.ok) {
            if (g.code === "QUOTA_EXCEEDED") throw new AssessError(429, "QUOTA_EXCEEDED", "This month's question-generation limit is used up.");
            lastError = g.message; continue;
          }
          const saved = await rpc("b2b_save_question_as", { _actor: actor, _q: codingPayload(input.orgId, g.data, nonce) });
          if (!saved.ok) { lastError = String(saved.reason); continue; }
          const qid = String(saved.question_id);
          if (!deps.judge0) { created.push({ questionId: qid, status: "draft", reason: "Saved as a draft: the code runner isn't set up yet, so it couldn't be checked." }); continue; }
          try {
            const v = await verify(actor, qid);
            created.push(v.status === "verified" ? { questionId: qid, status: "verified" }
              : { questionId: qid, status: "draft", reason: `Saved as a draft: the reference solution failed ${v.failures.length} test(s).` });
          } catch (e) {
            if (!(e instanceof AssessError)) throw e;
            created.push({ questionId: qid, status: "draft", reason: `Saved as a draft: ${e.message}` });
          }
        } else {
          const g = await deps.ai({ ...common, feature: "question.generate", system: MCQ_SYSTEM, jsonSchema: MCQ_SCHEMA,
                                    schemaName: "mcq_question", parse: GeneratedMcq.safeParse });
          if (!g.ok) {
            if (g.code === "QUOTA_EXCEEDED") throw new AssessError(429, "QUOTA_EXCEEDED", "This month's question-generation limit is used up.");
            lastError = g.message; continue;
          }
          const saved = await rpc("b2b_save_question_as", { _actor: actor, _q: mcqPayload(input.orgId, g.data) });
          if (!saved.ok) { lastError = String(saved.reason); continue; }
          const qid = String(saved.question_id);
          try {
            const v = await verify(actor, qid);
            created.push(v.status === "verified" ? { questionId: qid, status: "verified" }
              : { questionId: qid, status: "draft", reason: `Saved as a draft: ${mcqCheckReason(v.check)}` });
          } catch (e) {
            if (!(e instanceof AssessError)) throw e;
            created.push({ questionId: qid, status: "draft", reason: `Saved as a draft: ${e.message}` });
          }
        }
      }
      if (created.length === 0) {
        console.error("[b2b-assess] generation failed:", lastError);
        throw new AssessError(502, "AI_FAILED", "Couldn't generate questions right now. Please try again.");
      }
      return { created };
    },

    async verifyQuestion(input: { questionId: string }, actor: string) {
      return verify(actor, input.questionId);
    },

    async start(input: { context: "practice" | "drive" | "job_role"; contextId: string | null; assessmentId?: string; sessionId?: string }, actor: string) {
      const practice = input.context === "practice";
      const assessmentId = practice ? (input.assessmentId ?? input.contextId) : null;
      if (practice && !assessmentId) throw new AssessError(400, "BAD_REQUEST", "Which test? (assessmentId is missing)");
      if (!practice && !input.contextId) throw new AssessError(400, "BAD_REQUEST", "contextId is required");
      const r = await rpc("b2b_start_attempt", { _actor: actor, _context: input.context, _context_id: practice ? null : input.contextId,
                                                 _assessment_id: assessmentId, _session: input.sessionId ?? null });
      if (!r.ok) refuse(r.reason as string);
      return state(actor, String(r.attempt_id), String(r.session_id));
    },

    async state(input: { attemptId: string; sessionId?: string }, actor: string) {
      return state(actor, input.attemptId, input.sessionId ?? null);
    },

    async autosave(input: { attemptId: string; sessionId: string; questionId: string; seq: number; language?: string; code?: string;
                            mcq_choice?: string[]; edits?: unknown[] }, actor: string) {
      const r = await rpc("b2b_autosave", {
        _actor: actor, _attempt_id: input.attemptId, _session: input.sessionId, _question: input.questionId, _seq: input.seq,
        _language: input.language ?? null, _code: input.code ?? null, _mcq_choice: input.mcq_choice ?? null, _edits: input.edits ?? null,
      });
      if (!r.ok) refuse(r.reason as string);
      return { ok: true as const, seq: num(r.seq), deadline_at: String(r.deadline_at), server_now: String(r.server_now) };
    },

    async advance(input: { attemptId: string; sessionId: string; fromIndex: number }, actor: string) {
      const r = await rpc("b2b_advance_question", { _actor: actor, _attempt_id: input.attemptId, _session: input.sessionId, _from_index: input.fromIndex });
      if (!r.ok) refuse(r.reason as string);
      return state(actor, input.attemptId, input.sessionId);
    },

    async heartbeat(input: { attemptId: string; sessionId: string }, actor: string) {
      const r = await rpc("b2b_attempt_heartbeat", { _actor: actor, _attempt_id: input.attemptId, _session: input.sessionId });
      const reason: "OTHER_SESSION" | "ENDED" | undefined = r.reason === "OTHER_SESSION" || r.reason === "ENDED" ? r.reason : undefined;
      return { ok: !!r.ok, deadline_at: (r.deadline_at as string | null) ?? null, server_now: String(r.server_now),
               paused: !!r.paused, status: String(r.status), ...(reason ? { reason } : {}) };
    },

    async run(input: { attemptId: string; sessionId: string; questionId: string; language: Language; code: string; customInput?: string }, actor: string): Promise<JudgeResult> {
      if (!deps.judge0) throw JUDGE0_MISSING();
      const q = await rpc("b2b_runner_question", { _actor: actor, _attempt_id: input.attemptId, _session: input.sessionId, _question: input.questionId });
      if (!q.ok) refuse(q.reason as string);
      if (q.type !== "coding") throw new AssessError(400, "NOT_CODING", "Only coding questions can be run.");
      if (!(q.languages as string[]).includes(input.language)) throw new AssessError(400, "LANGUAGE_NOT_ALLOWED", "That language isn't allowed for this question.");
      const sub = await rpc("b2b_create_submission", { _actor: actor, _attempt_id: input.attemptId, _session: input.sessionId,
        _question: input.questionId, _kind: "run", _language: input.language, _code: input.code, _mcq_choice: null });
      if (!sub.ok) refuse(sub.reason as string);
      const samples = asTests(q.tests).filter((t) => t.is_sample);   // hidden tests never run (or leak) here
      const runs = samples.map((t) => ({ language: input.language, code: input.code, stdin: t.input }));
      if (input.customInput !== undefined) runs.push({ language: input.language, code: input.code, stdin: input.customInput });
      let outcomes;
      try {
        outcomes = await deps.judge0.run(runs, { timeLimitMs: numOrNull(q.time_limit_ms), memoryLimitKb: numOrNull(q.memory_limit_kb) });
      } catch (e) {
        if (!(e instanceof Judge0Error)) throw e;
        await record(String(sub.submission_id), "error", null, null, null, null, null, null);
        throw JUDGE0_DOWN();
      }
      const sum = summarize(samples, outcomes.slice(0, samples.length));
      const c = input.customInput !== undefined ? outcomes[samples.length] : undefined;
      const custom = c ? { stdout: c.stdout.slice(0, 10_000), stderr: (c.stderr || c.compileOutput).slice(0, 10_000), status: c.status === "ran" ? "ok" : c.status, time_ms: c.timeMs } : undefined;
      await record(String(sub.submission_id), "done", sum.tests, sum.compile_output, sum.passed, sum.total, null, null);
      return {
        submissionId: String(sub.submission_id), status: "done", compile_output: sum.compile_output,
        tests: sum.tests.map((t) => ({ sample: true, passed: t.passed, time_ms: t.time_ms, status: t.status, stdout: t.stdout, expected: t.expected })),
        passed: sum.passed, total: sum.total, ...(custom ? { custom } : {}),
      };
    },

    async submitQuestion(input: { attemptId: string; sessionId: string; questionId: string; language?: Language; code?: string; mcq_choice?: string[] }, actor: string) {
      const q = await rpc("b2b_runner_question", { _actor: actor, _attempt_id: input.attemptId, _session: input.sessionId, _question: input.questionId });
      if (!q.ok) refuse(q.reason as string);
      if (q.type === "coding") {
        if (!input.language || input.code === undefined) throw new AssessError(400, "BAD_REQUEST", "Code and language are required.");
        if (!(q.languages as string[]).includes(input.language)) throw new AssessError(400, "LANGUAGE_NOT_ALLOWED", "That language isn't allowed for this question.");
      } else if (!input.mcq_choice) {
        throw new AssessError(400, "BAD_REQUEST", "Choose an option first.");
      }
      const sub = await rpc("b2b_create_submission", { _actor: actor, _attempt_id: input.attemptId, _session: input.sessionId,
        _question: input.questionId, _kind: "submit", _language: input.language ?? null, _code: input.code ?? null,
        _mcq_choice: q.type === "mcq" ? input.mcq_choice : null });
      if (!sub.ok) refuse(sub.reason as string);
      const id = String(sub.submission_id);
      if (q.type === "mcq") {   // MCQs are scored from the saved answer when the test ends
        await record(id, "done", null, null, null, null, null, null);
        return { submissionId: id, status: "done" as const };
      }
      if (!deps.judge0) return { submissionId: id, status: "queued" as const };
      const graded = await gradeClaimed([{ id, language: input.language, code: input.code, points: q.points, tests: q.tests,
                                            time_limit_ms: q.time_limit_ms, memory_limit_kb: q.memory_limit_kb }]);
      return { submissionId: id, status: graded ? "done" as const : "queued" as const };
    },

    async finish(input: { attemptId: string; sessionId: string; reason?: "submitted" | "violations" }, actor: string) {
      const r = await rpc("b2b_finish_attempt", { _actor: actor, _attempt_id: input.attemptId, _session: input.sessionId,
                                                  _reason: input.reason ?? "submitted" });
      if (!r.ok) refuse(r.reason as string);
      const pending = (r.pending as string[] | undefined) ?? [];
      if (deps.judge0 && pending.length > 0) {
        const claimed = await deps.rpc("b2b_claim_pending_submissions", { _limit: pending.length, _ids: pending }) as Json[];
        await gradeClaimed(claimed);
      }
      return { ok: true as const };
    },

    /** Cron (x-cron-secret): grade queued coding submissions. */
    async gradePending(limit: number) {
      if (!deps.judge0) return { graded: 0, reason: "JUDGE0_NOT_CONFIGURED" };
      const claimed = await deps.rpc("b2b_claim_pending_submissions", { _limit: limit, _ids: null }) as Json[];
      return { graded: await gradeClaimed(claimed) };
    },
  };
}
