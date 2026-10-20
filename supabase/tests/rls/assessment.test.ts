// @vitest-environment node
// Track A: question bank, runner and grading SQL (supabase/migrations/20261021000006_b2b_v1_assessment.sql) on embedded Postgres.
import { describe, it, expect, beforeAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { createTestDb, createUser, asUser, asService } from "../helpers/pgdb";

let db: PGlite;
const u: Record<string, string> = {};
const o: Record<string, string> = {};
const r: Record<string, string> = {};
type J = Record<string, unknown> & { ok?: boolean; reason?: string };

const one = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0];
const id = async (sql: string, params: unknown[] = []) => (await one<{ id: string }>(sql, params)).id;
/** Call a service-role function and return its JSON result. */
const svc = (sql: string, params: unknown[] = []) =>
  asService(db, async (tx) => (await tx.query<{ r: J }>(`SELECT ${sql} AS r`, params)).rows[0].r);
/** Same, but return the error message (the call must fail). */
const svcError = async (sql: string, params: unknown[] = []) => {
  try { await svc(sql, params); } catch (e) { return (e as Error).message; }
  throw new Error("expected an error");
};

const start = (actor: string, ctx: string, ctxId: string | null, assessment: string | null, session: string | null = null) =>
  svc("public.b2b_start_attempt($1, $2, $3, $4, $5)", [actor, ctx, ctxId, assessment, session]);
const state = (actor: string, attempt: string, session: string | null) =>
  svc("public.b2b_attempt_state($1, $2, $3)", [actor, attempt, session]);
const autosave = (actor: string, attempt: string, session: string, q: string, seq: number, extra: { code?: string; lang?: string; mcq?: string[]; edits?: unknown[] } = {}) =>
  svc("public.b2b_autosave($1, $2, $3, $4, $5, $6, $7, $8, $9)", [actor, attempt, session, q, seq, extra.lang ?? null,
    extra.code ?? null, extra.mcq ? JSON.stringify(extra.mcq) : null, extra.edits ? JSON.stringify(extra.edits) : null]);
const finish = (actor: string, attempt: string, session: string) =>
  svc("public.b2b_finish_attempt($1, $2, $3, 'submitted')", [actor, attempt, session]);
const attemptRow = (attempt: string) => one<Record<string, unknown>>("SELECT * FROM attempts WHERE id = $1", [attempt]);

const mcqSql = `INSERT INTO questions (org_id, type, title, statement, difficulty, topics, category, options, answer, multi_select, points, status)
  VALUES ($1, 'mcq', $2, 'Choose the correct answer here.', $3, $4, $5,
          '[{"id":"a","text":"A"},{"id":"b","text":"B"},{"id":"c","text":"C"},{"id":"d","text":"D"}]', $6, $7, 4, 'verified') RETURNING id`;

beforeAll(async () => {
  db = await createTestDb();
  u.super = await createUser(db, { superAdmin: true });
  for (const k of ["adminA", "trainerA", "studentA", "studentA2", "studentA3", "adminB", "studentB", "recruiterC", "candC", "candC2", "b2c"]) {
    u[k] = await createUser(db);
  }
  const org = (slug: string, type: string) => id("INSERT INTO organizations (name, slug, type) VALUES ($1, $1, $2) RETURNING id", [slug, type]);
  o.A = await org("college-a", "college");
  o.B = await org("college-b", "college");
  o.C = await org("company-c", "company");
  await db.query("UPDATE organizations SET credits_balance = 10 WHERE id = $1", [o.A]);
  const member = (orgId: string, user: string, role: string) =>
    db.query("INSERT INTO org_memberships (org_id, user_id, role) VALUES ($1, $2, $3)", [orgId, user, role]);
  await member(o.A, u.adminA, "org_admin");
  await member(o.A, u.trainerA, "trainer");
  for (const s of ["studentA", "studentA2", "studentA3"]) await member(o.A, u[s], "student");
  await member(o.B, u.adminB, "org_admin");
  await member(o.B, u.studentB, "student");
  await member(o.C, u.recruiterC, "recruiter");

  const student = (orgId: string, user: string, roll: string) => id(
    "INSERT INTO students (org_id, user_id, roll_no, full_name, email, status) VALUES ($1, $2, $3, $3, $4, 'active') RETURNING id",
    [orgId, user, roll, `${roll.toLowerCase()}@college.in`]);
  r.sA = await student(o.A, u.studentA, "A01");
  r.sA2 = await student(o.A, u.studentA2, "A02");
  r.sA3 = await student(o.A, u.studentA3, "A03");
  r.sB = await student(o.B, u.studentB, "B01");
  r.cC = await id("INSERT INTO candidates (org_id, email, full_name, user_id) VALUES ($1, 'dev@x.in', 'Dev', $2) RETURNING id", [o.C, u.candC]);
  r.cC2 = await id("INSERT INTO candidates (org_id, email, full_name, user_id) VALUES ($1, 'esha@x.in', 'Esha', $2) RETURNING id", [o.C, u.candC2]);

  // Bank for college A: 4 aptitude MCQs, 4 OS MCQs, 1 coding question (verified directly in setup).
  for (let i = 0; i < 4; i++) {
    r[`apt${i}`] = await id(mcqSql, [o.A, `Aptitude ${i}`, "easy", ["percentages"], "aptitude", '["a"]', false]);
    r[`os${i}`] = await id(mcqSql, [o.A, `OS ${i}`, "medium", ["os"], "cs_fundamentals", '["b","c"]', true]);
  }
  r.draftMcq = await id(`INSERT INTO questions (org_id, type, title, statement, difficulty, topics, category, options, answer, status)
    VALUES ($1, 'mcq', 'Draft one', 'Not verified yet, never picked.', 'easy', '{percentages}', 'aptitude', '[{"id":"a","text":"A"}]', '["a"]', 'draft') RETURNING id`, [o.A]);
  r.code = await id(`INSERT INTO questions (org_id, type, title, statement, difficulty, topics, languages, starter_code, status, points)
    VALUES ($1, 'coding', 'Sum two', 'Print the sum of two integers.', 'easy', '{math}', '{python,java}', '{"python":"# code"}', 'verified', 10) RETURNING id`, [o.A]);
  await db.query(`INSERT INTO test_cases (question_id, ordinal, input, expected_output, is_sample, weight) VALUES
    ($1, 0, '1 2', '3', true, 1), ($1, 1, '5 5', '10', false, 3)`, [r.code]);

  r.asA = await id(`INSERT INTO assessments (org_id, title, duration_min, sections, negative_marking, practice_enabled, status, languages)
    VALUES ($1, 'Placement test', 60, $2, 0.25, true, 'ready', '{python,cpp}') RETURNING id`, [o.A, JSON.stringify([
    { type: "mcq", title: "Aptitude", pick: [{ difficulty: "easy", topics: ["percentages"], count: 2 }] },
    { type: "mcq", title: "CS", pick: [{ topics: ["os"], count: 2 }] },
    { type: "coding", title: "Coding", question_ids: [r.code] },
  ])]);
  r.dA = await id(`INSERT INTO drives (org_id, name, assessment_id, status, window_start, window_end)
    VALUES ($1, 'CSE 2027', $2, 'live', now() - interval '1 hour', now() + interval '3 hours') RETURNING id`, [o.A, r.asA]);
  await db.query("INSERT INTO drive_assignments (drive_id, org_id, student_id) VALUES ($1, $2, $3), ($1, $2, $4)", [r.dA, o.A, r.sA, r.sA3]);

  // Company C: one MCQ assessment for a job role.
  r.qC = await id(mcqSql, [o.C, "Company MCQ", "easy", ["sql"], "technical", '["d"]', false]);
  r.asC = await id(`INSERT INTO assessments (org_id, title, duration_min, sections, status) VALUES ($1, 'Backend screen', 30, $2, 'ready') RETURNING id`,
    [o.C, JSON.stringify([{ type: "mcq", title: "SQL", question_ids: [r.qC] }])]);
  r.jC = await id("INSERT INTO job_roles (org_id, title, assessment_id, status) VALUES ($1, 'Backend', $2, 'open') RETURNING id", [o.C, r.asC]);
  r.rcC = await id("INSERT INTO role_candidates (org_id, job_role_id, candidate_id) VALUES ($1, $2, $3) RETURNING id", [o.C, r.jC, r.cC]);
  await db.query("INSERT INTO role_candidates (org_id, job_role_id, candidate_id, invite_expires_at) VALUES ($1, $2, $3, now() - interval '1 day')", [o.C, r.jC, r.cC2]);
});

describe("question bank", () => {
  const coding = (over: Record<string, unknown> = {}) => ({
    org_id: o.A, type: "coding", title: "Reverse words", statement: "Reverse the order of words in a line.", difficulty: "easy",
    topics: ["strings"], languages: ["python"], starter_code: { python: "" }, time_limit_ms: 2000, memory_limit_kb: 128000,
    tests: [{ input: "a b", expected_output: "b a", is_sample: true }, { input: "x y z", expected_output: "z y x", weight: 2 }],
    reference: { language: "python", code: "print(' '.join(input().split()[::-1]))" }, status: "verified", ...over,
  });
  const save = (user: string, q: unknown) =>
    asUser(db, user, async (tx) => (await tx.query<{ r: J }>("SELECT public.b2b_save_question($1) AS r", [JSON.stringify(q)])).rows[0].r, { commit: true });

  it("staff save coding questions as draft with tests and a reference solution", async () => {
    const res = await save(u.trainerA, coding());
    expect(res).toMatchObject({ ok: true, status: "draft" });
    r.newCode = res.question_id as string;
    expect((await one<{ n: number }>("SELECT count(*)::int AS n FROM test_cases WHERE question_id = $1", [r.newCode])).n).toBe(2);
    expect((await one("SELECT language FROM reference_solutions WHERE question_id = $1", [r.newCode]))).toMatchObject({ language: "python" });
  });

  it("refuses students, other orgs and non-super-admins on the global bank", async () => {
    await expect(save(u.studentA, coding())).rejects.toThrow(/FORBIDDEN/);
    await expect(save(u.adminB, coding())).rejects.toThrow(/FORBIDDEN/);
    await expect(save(u.adminB, coding({ id: r.newCode, org_id: o.B }))).rejects.toThrow(/FORBIDDEN/);
    await expect(save(u.adminA, coding({ org_id: null }))).rejects.toThrow(/FORBIDDEN/);
    expect(await save(u.super, coding({ org_id: null, title: "Global reverse" }))).toMatchObject({ ok: true });
  });

  it("validates tests, references and MCQ answers", async () => {
    expect(await save(u.adminA, coding({ tests: [{ input: "1", expected_output: "1", is_sample: false }] }))).toMatchObject({ reason: "NEED_TESTS" });
    expect(await save(u.adminA, coding({ reference: null }))).toMatchObject({ reason: "NEED_REFERENCE" });
    const mcq = { org_id: o.A, type: "mcq", title: "Bad MCQ", statement: "Which one is right here?", difficulty: "easy",
                  options: [{ id: "a", text: "A" }, { id: "b", text: "B" }], answer: ["z"], status: "verified" };
    expect(await save(u.adminA, mcq)).toMatchObject({ reason: "ANSWER_NOT_AN_OPTION" });
    expect(await save(u.adminA, { ...mcq, answer: ["b"] })).toMatchObject({ ok: true, status: "verified" });
  });

  it("coding verification: only the sandbox result for the current version verifies", async () => {
    const q = await svc("public.b2b_question_for_verify($1, $2)", [u.adminA, r.newCode]);
    expect(q).toMatchObject({ ok: true, type: "coding" });
    expect((q.tests as unknown[]).length).toBe(2);
    expect(await svcError("public.b2b_question_for_verify($1, $2)", [u.adminB, r.newCode])).toMatch(/FORBIDDEN/);
    expect(await svc("public.b2b_record_verification($1, $2, $3, true)", [u.adminA, r.newCode, (q.version as number) + 1])).toMatchObject({ reason: "CHANGED" });
    expect(await svc("public.b2b_record_verification($1, $2, $3, false)", [u.adminA, r.newCode, q.version])).toMatchObject({ status: "draft" });
    expect(await svc("public.b2b_record_verification($1, $2, $3, true)", [u.adminA, r.newCode, q.version])).toMatchObject({ status: "verified" });
    expect((await one("SELECT status FROM questions WHERE id = $1", [r.newCode]))).toMatchObject({ status: "verified" });
    expect((await one<{ verified_at: unknown }>("SELECT verified_at FROM reference_solutions WHERE question_id = $1", [r.newCode])).verified_at).not.toBeNull();
    // Editing sends it back to draft.
    await save(u.adminA, { ...coding(), id: r.newCode, statement: "Reverse the order of words, changed." });
    expect((await one("SELECT status FROM questions WHERE id = $1", [r.newCode]))).toMatchObject({ status: "draft" });
  });

  it("browser roles can't call the service functions", async () => {
    await expect(asUser(db, u.adminA, (tx) => tx.query("SELECT public.b2b_record_verification($1, $2, 1, true)", [u.adminA, r.newCode])))
      .rejects.toThrow(/permission denied/);
    await expect(asUser(db, u.studentA, (tx) => tx.query("SELECT public.b2b_start_attempt($1, 'practice', NULL, $2, NULL)", [u.studentA, r.asA])))
      .rejects.toThrow(/permission denied/);
    await expect(asUser(db, u.studentA, (tx) => tx.query("SELECT public._b2b_end_attempt($1, 'submitted', 'submitted')", [randomUUID()])))
      .rejects.toThrow(/permission denied/);
  });
});

describe("question set randomization", () => {
  const build = (seed: string) =>
    one<{ s: { question_id: string; section: number; option_order: string[] | null }[] }>("SELECT public._b2b_build_question_set($1, $2) AS s", [r.asA, seed]);

  it("follows the pool rules and is deterministic per seed", async () => {
    const a1 = (await build("seed-1")).s;
    expect(a1).toEqual((await build("seed-1")).s);
    expect(a1).toHaveLength(5);
    const aptitude = [r.apt0, r.apt1, r.apt2, r.apt3];
    const os = [r.os0, r.os1, r.os2, r.os3];
    expect(a1.filter((x) => x.section === 0).every((x) => aptitude.includes(x.question_id))).toBe(true);
    expect(a1.filter((x) => x.section === 1).every((x) => os.includes(x.question_id))).toBe(true);
    expect(a1.find((x) => x.section === 2)?.question_id).toBe(r.code);
    expect(a1.some((x) => x.question_id === r.draftMcq)).toBe(false);
    for (const x of a1.filter((q) => q.section < 2)) expect([...(x.option_order ?? [])].sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("differs between subjects (selection, order and option order)", async () => {
    const sets = await Promise.all(Array.from({ length: 8 }, (_, i) => build(`subject-${i}`)));
    const selections = new Set(sets.map((x) => JSON.stringify(x.s.map((q) => q.question_id))));
    const options = new Set(sets.map((x) => JSON.stringify(x.s.map((q) => q.option_order))));
    expect(selections.size).toBeGreaterThan(1);
    expect(options.size).toBeGreaterThan(1);
  });
});

describe("runner: practice", () => {
  it("starts, charges ¼ credit once, and resumes the same attempt", async () => {
    const before = Number((await one<{ b: string }>("SELECT credits_balance AS b FROM organizations WHERE id = $1", [o.A])).b);
    const s1 = await start(u.studentA, "practice", null, r.asA);
    expect(s1).toMatchObject({ ok: true, resumed: false });
    r.pAt = s1.attempt_id as string;
    r.pSess = s1.session_id as string;
    const again = await start(u.studentA, "practice", null, r.asA, r.pSess);
    expect(again).toMatchObject({ ok: true, resumed: true, attempt_id: r.pAt, session_id: r.pSess });
    const after = Number((await one<{ b: string }>("SELECT credits_balance AS b FROM organizations WHERE id = $1", [o.A])).b);
    expect(before - after).toBeCloseTo(0.25);
    expect((await one<{ n: number }>("SELECT count(*)::int AS n FROM org_credit_ledger WHERE ref_id = $1", [r.pAt])).n).toBe(1);
  });

  it("refuses other colleges, staff, B2C users and orgs without credits", async () => {
    expect(await start(u.studentB, "practice", null, r.asA)).toMatchObject({ ok: false, reason: "NOT_ELIGIBLE" });
    expect(await start(u.adminA, "practice", null, r.asA)).toMatchObject({ ok: false, reason: "NOT_ELIGIBLE" });
    expect(await start(u.b2c, "practice", null, r.asA)).toMatchObject({ ok: false, reason: "NOT_ELIGIBLE" });
    await db.query("UPDATE organizations SET credits_balance = 0.1 WHERE id = $1", [o.A]);
    expect(await start(u.studentA2, "practice", null, r.asA)).toMatchObject({ ok: false, reason: "NO_CREDITS" });
    expect((await one<{ n: number }>("SELECT count(*)::int AS n FROM attempts WHERE subject_user_id = $1", [u.studentA2])).n).toBe(0);
    await db.query("UPDATE organizations SET credits_balance = 10 WHERE id = $1", [o.A]);
  });

  it("state shows the server clock and the question set without answers or hidden tests", async () => {
    const st = await state(u.studentA, r.pAt, r.pSess);
    expect(st).toMatchObject({ ok: true, status: "in_progress", session_id: r.pSess, paused: false, policy: "standard", watermark: "a01@college.in" });
    expect(st.deadline_at).toBeTruthy();
    expect(st.server_now).toBeTruthy();
    const qs = st.questions as Record<string, unknown>[];
    expect(qs).toHaveLength(5);
    const text = JSON.stringify(qs);
    expect(text).not.toContain('"answer"');
    expect(text).not.toContain("5 5");         // hidden test input
    const coding = qs.find((q) => q.type === "coding")!;
    expect(coding.samples).toEqual([{ input: "1 2", output: "3" }]);
    expect(coding.languages).toEqual(["python"]);   // question ∩ assessment languages
    const stored = ((await attemptRow(r.pAt)).question_set as { question_id: string; option_order: string[] | null }[]);
    const mcq = qs.find((q) => q.type === "mcq")!;
    const order = stored.find((x) => x.question_id === mcq.id)!.option_order;
    expect((mcq.options as { id: string }[]).map((x) => x.id)).toEqual(order);
    expect(await svcError("public.b2b_attempt_state($1, $2, $3)", [u.studentA2, r.pAt, r.pSess])).toMatch(/FORBIDDEN/);
    expect(await svcError("public.b2b_attempt_state($1, $2, $3)", [u.adminA, r.pAt, r.pSess])).toMatch(/FORBIDDEN/);
  });

  it("allows one active session; a second tab is refused and logged; a stale one can be taken over", async () => {
    const other = randomUUID();
    expect(await state(u.studentA, r.pAt, other)).toMatchObject({ ok: false, reason: "OTHER_SESSION" });
    expect(await start(u.studentA, "practice", null, r.asA)).toMatchObject({ ok: false, reason: "OTHER_SESSION" });
    const logged = await one<{ n: number }>("SELECT count(*)::int AS n FROM edit_history WHERE attempt_id = $1 AND kind = 'integrity' AND meta->>'type' = 'second_session'", [r.pAt]);
    expect(logged.n).toBeGreaterThanOrEqual(2);
    expect(await svc("public.b2b_attempt_heartbeat($1, $2, $3)", [u.studentA, r.pAt, r.pSess])).toMatchObject({ ok: true, status: "in_progress" });

    await db.query("UPDATE attempts SET active_session_seen_at = now() - interval '2 minutes' WHERE id = $1", [r.pAt]);
    expect(await state(u.studentA, r.pAt, other)).toMatchObject({ ok: true, session_id: other });
    expect(await svc("public.b2b_attempt_heartbeat($1, $2, $3)", [u.studentA, r.pAt, r.pSess])).toMatchObject({ ok: false, reason: "OTHER_SESSION" });
    expect(await autosave(u.studentA, r.pAt, r.pSess, r.code, 1, { code: "x" })).toMatchObject({ ok: false, reason: "OTHER_SESSION" });
    r.pSess = other;
  });

  it("autosave keeps the newest seq and logs edit batches once", async () => {
    const edits = [{ t: 100, op: "ins", at: 0, text: "print(1)" }];
    expect(await autosave(u.studentA, r.pAt, r.pSess, r.code, 5, { code: "newer", lang: "python", edits })).toMatchObject({ ok: true, seq: 5 });
    expect(await autosave(u.studentA, r.pAt, r.pSess, r.code, 3, { code: "older", lang: "python", edits })).toMatchObject({ ok: true, seq: 5 });
    expect(await autosave(u.studentA, r.pAt, r.pSess, r.code, 5, { code: "newer", lang: "python", edits })).toMatchObject({ ok: true, seq: 5 });
    expect((await one("SELECT code FROM attempt_answers WHERE attempt_id = $1 AND question_id = $2", [r.pAt, r.code]))).toMatchObject({ code: "newer" });
    expect((await one<{ n: number }>("SELECT count(*)::int AS n FROM edit_history WHERE attempt_id = $1 AND kind = 'edits'", [r.pAt])).n).toBe(2);
    expect(await autosave(u.studentA, r.pAt, r.pSess, r.qC, 6, { mcq: ["d"] })).toMatchObject({ ok: false, reason: "NOT_IN_ATTEMPT" });
    expect(await svcError("public.b2b_autosave($1, $2, $3, $4, 9, NULL, 'x', NULL, NULL)", [u.studentB, r.pAt, r.pSess, r.code])).toMatch(/FORBIDDEN/);
  });

  it("runner_question gives the grader every test; create_submission rate-limits runs", async () => {
    const q = await svc("public.b2b_runner_question($1, $2, $3, $4)", [u.studentA, r.pAt, r.pSess, r.code]);
    expect(q).toMatchObject({ ok: true, type: "coding", languages: ["python"] });
    expect((q.tests as unknown[]).length).toBe(2);
    const sub = await svc("public.b2b_create_submission($1, $2, $3, $4, 'run', 'python', 'print(3)', NULL)", [u.studentA, r.pAt, r.pSess, r.code]);
    expect(sub).toMatchObject({ ok: true });
    await db.query(`INSERT INTO submissions (attempt_id, question_id, org_id, kind, status)
      SELECT $1, $2, $3, 'run', 'done' FROM generate_series(1, 30)`, [r.pAt, r.code, o.A]);
    expect(await svc("public.b2b_create_submission($1, $2, $3, $4, 'run', 'python', 'x', NULL)", [u.studentA, r.pAt, r.pSess, r.code]))
      .toMatchObject({ ok: false, reason: "RATE_LIMITED" });
  });

  it("grades on finish: MCQ with negative marking, coding from the graded submit, sections and dimensions", async () => {
    const set = (await attemptRow(r.pAt)).question_set as { question_id: string; section: number }[];
    const [apt1, apt2] = set.filter((x) => x.section === 0).map((x) => x.question_id);
    const [os1, os2] = set.filter((x) => x.section === 1).map((x) => x.question_id);
    await autosave(u.studentA, r.pAt, r.pSess, apt1, 1, { mcq: ["a"] });        // correct: +4
    await autosave(u.studentA, r.pAt, r.pSess, apt2, 1, { mcq: ["b"] });        // wrong: −1
    await autosave(u.studentA, r.pAt, r.pSess, os1, 1, { mcq: ["c", "b"] });    // correct (multi): +4
    await autosave(u.studentA, r.pAt, r.pSess, os2, 1, { mcq: ["b"] });         // partial = wrong: −1
    // a graded submit of the current code → the final reuses its score (7.5 of 10)
    const sub = await svc("public.b2b_create_submission($1, $2, $3, $4, 'submit', 'python', 'newer', NULL)", [u.studentA, r.pAt, r.pSess, r.code]);
    await svc("public.b2b_record_judge_result($1, 'done', '[]', NULL, 1, 2, 7.5, 10)", [sub.submission_id]);

    expect(await svc("public.b2b_finish_attempt($1, $2, $3, 'submitted')", [u.studentA, r.pAt, randomUUID()])).toMatchObject({ reason: "OTHER_SESSION" });
    expect(await svcError("public.b2b_finish_attempt($1, $2, $3, 'submitted')", [u.studentA2, r.pAt, r.pSess])).toMatch(/FORBIDDEN/);
    const fin = await finish(u.studentA, r.pAt, r.pSess);
    expect(fin).toMatchObject({ ok: true, pending: [] });
    const at = await attemptRow(r.pAt);
    expect(at).toMatchObject({ status: "submitted", end_reason: "submitted", grading_status: "complete" });
    expect(Number(at.score)).toBeCloseTo(3 + 3 + 7.5);
    expect(Number(at.max_score)).toBe(8 + 8 + 10);
    expect((at.section_scores as { score: number }[]).map((s) => Number(s.score))).toEqual([3, 3, 7.5]);
    const dims = (await db.query<{ dimension: string; topic: string | null; score: string }>(
      "SELECT dimension, topic, score FROM dimension_scores WHERE source_id = $1 ORDER BY dimension", [r.pAt])).rows;
    expect(dims.map((d) => [d.dimension, d.topic, Number(d.score)])).toEqual([
      ["coding", null, 75], ["problem_solving", null, 37.5], ["technical_knowledge", "os", 37.5],
    ]);
    // Finished: further writes are refused; finish is idempotent; results visible for practice.
    expect(await autosave(u.studentA, r.pAt, r.pSess, apt1, 9, { mcq: ["b"] })).toMatchObject({ ok: false, reason: "ENDED" });
    expect(await finish(u.studentA, r.pAt, r.pSess)).toMatchObject({ ok: true, already: true });
    const st = await state(u.studentA, r.pAt, r.pSess);
    expect(st).toMatchObject({ status: "submitted", questions: [] });
    expect(st.result).toMatchObject({ grading: "complete" });
  });

  it("section scores floor at zero", async () => {
    const s = await start(u.studentA3, "practice", null, r.asA);
    const set = (await attemptRow(s.attempt_id as string)).question_set as { question_id: string; section: number }[];
    for (const q of set.filter((x) => x.section === 0)) await autosave(u.studentA3, s.attempt_id as string, s.session_id as string, q.question_id, 1, { mcq: ["d"] });
    await finish(u.studentA3, s.attempt_id as string, s.session_id as string);
    const at = await attemptRow(s.attempt_id as string);
    expect(Number((at.section_scores as { score: number }[])[0].score)).toBe(0);
    expect(Number(at.score)).toBe(0);
  });
});

describe("runner: deadline", () => {
  it("expires lazily past the deadline, queues coding finals and grades them later", async () => {
    const s = await start(u.studentA2, "practice", null, r.asA);
    const at = s.attempt_id as string; const sess = s.session_id as string;
    await autosave(u.studentA2, at, sess, r.code, 1, { code: "print(sum(map(int, input().split())))", lang: "python" });
    await db.query("UPDATE attempts SET deadline_at = now() - interval '1 minute' WHERE id = $1", [at]);
    expect(await autosave(u.studentA2, at, sess, r.code, 2, { code: "late" })).toMatchObject({ ok: false, reason: "ENDED" });
    const row = await attemptRow(at);
    expect(row).toMatchObject({ status: "expired", end_reason: "deadline", grading_status: "pending" });
    expect((await one("SELECT code FROM attempt_answers WHERE attempt_id = $1 AND question_id = $2", [at, r.code]))).toMatchObject({ code: "print(sum(map(int, input().split())))" });

    const claimed = await svc("public.b2b_claim_pending_submissions(10, NULL)") as unknown as { id: string; attempt_id: string; tests: unknown[] }[];
    const mine = claimed.find((c) => c.attempt_id === at)!;
    expect(mine.tests).toHaveLength(2);
    expect((await svc("public.b2b_claim_pending_submissions(10, NULL)") as unknown as unknown[]).some((c) => (c as { id: string }).id === mine.id)).toBe(false);
    await svc("public.b2b_record_judge_result($1, 'done', '[]', NULL, 2, 2, 10, 10)", [mine.id]);
    expect(await attemptRow(at)).toMatchObject({ grading_status: "complete" });
    expect(Number((await attemptRow(at)).score)).toBe(10);
  });

  it("the sweep ends overdue attempts (and only those)", async () => {
    const s = await start(u.studentA2, "practice", null, r.asA);
    const keep = await start(u.studentA3, "practice", null, r.asA);
    await db.query("UPDATE attempts SET deadline_at = now() - interval '1 minute' WHERE id = $1", [s.attempt_id]);
    expect(await svc("public.b2b_expire_attempts()")).toBeGreaterThanOrEqual(1);
    expect(await attemptRow(s.attempt_id as string)).toMatchObject({ status: "expired", end_reason: "deadline" });
    expect(await attemptRow(keep.attempt_id as string)).toMatchObject({ status: "in_progress" });
  });

  it("finishing after the deadline but before the sweep records end reason 'deadline'", async () => {
    const keep = await one<{ id: string; active_session_id: string }>("SELECT id, active_session_id FROM attempts WHERE subject_user_id = $1 AND status = 'in_progress'", [u.studentA3]);
    await db.query("UPDATE attempts SET deadline_at = now() - interval '5 seconds' WHERE id = $1", [keep.id]);
    expect(await finish(u.studentA3, keep.id, keep.active_session_id)).toMatchObject({ ok: true });
    expect(await attemptRow(keep.id)).toMatchObject({ status: "submitted", end_reason: "deadline" });
  });
});

describe("runner: drives", () => {
  it("only assigned students, inside the window; no credits charged; one attempt per drive", async () => {
    const before = await one<{ n: number }>("SELECT count(*)::int AS n FROM org_credit_ledger WHERE org_id = $1", [o.A]);
    expect(await start(u.studentA2, "drive", r.dA, null)).toMatchObject({ ok: false, reason: "NOT_ELIGIBLE" });
    expect(await start(u.studentB, "drive", r.dA, null)).toMatchObject({ ok: false, reason: "NOT_ELIGIBLE" });
    const s = await start(u.studentA, "drive", r.dA, null);
    expect(s).toMatchObject({ ok: true, resumed: false });
    expect(await start(u.studentA, "drive", r.dA, null, s.session_id as string)).toMatchObject({ ok: true, resumed: true, attempt_id: s.attempt_id });
    expect(await one("SELECT attempt_id, status FROM drive_assignments WHERE drive_id = $1 AND student_id = $2", [r.dA, r.sA]))
      .toMatchObject({ attempt_id: s.attempt_id, status: "in_progress" });
    expect((await one<{ n: number }>("SELECT count(*)::int AS n FROM org_credit_ledger WHERE org_id = $1", [o.A])).n).toBe(before.n);
    const row = await attemptRow(s.attempt_id as string);
    expect(new Date(row.deadline_at as string).getTime()).toBeLessThanOrEqual(Date.now() + 61 * 60_000);
    // Drive results aren't visible until released.
    await finish(u.studentA, s.attempt_id as string, s.session_id as string);
    expect((await state(u.studentA, s.attempt_id as string, null)).result).toBeNull();
  });

  it("refuses before the window, after it, after the late-join limit, and for draft drives", async () => {
    await db.query("UPDATE drives SET window_start = now() + interval '1 hour' WHERE id = $1", [r.dA]);
    expect(await start(u.studentA3, "drive", r.dA, null)).toMatchObject({ reason: "NOT_OPEN_YET" });
    await db.query("UPDATE drives SET window_start = now() - interval '3 hours', window_end = now() - interval '1 minute' WHERE id = $1", [r.dA]);
    expect(await start(u.studentA3, "drive", r.dA, null)).toMatchObject({ reason: "WINDOW_CLOSED" });
    await db.query("UPDATE drives SET window_end = now() + interval '1 hour' WHERE id = $1", [r.dA]);
    await db.query("UPDATE assessments SET late_join_min = 30 WHERE id = $1", [r.asA]);
    expect(await start(u.studentA3, "drive", r.dA, null)).toMatchObject({ reason: "TOO_LATE" });
    await db.query("UPDATE assessments SET late_join_min = NULL WHERE id = $1", [r.asA]);
    await db.query("UPDATE drives SET status = 'draft' WHERE id = $1", [r.dA]);
    expect(await start(u.studentA3, "drive", r.dA, null)).toMatchObject({ reason: "NOT_OPEN" });
    await db.query("UPDATE drives SET status = 'live' WHERE id = $1", [r.dA]);
    const s = await start(u.studentA3, "drive", r.dA, null);
    expect(s).toMatchObject({ ok: true });
    // Deadline capped at the window end (1 hour < 60 min duration + margin).
    const row = await attemptRow(s.attempt_id as string);
    expect(new Date(row.deadline_at as string).getTime()).toBeLessThanOrEqual(Date.now() + 60 * 60_000 + 5_000);
  });
});

describe("runner: job roles", () => {
  it("only the linked candidate with a live invite; candidates never see scores", async () => {
    expect(await start(u.candC2, "job_role", r.jC, null)).toMatchObject({ ok: false, reason: "INVITE_EXPIRED" });
    expect(await start(u.studentA, "job_role", r.jC, null)).toMatchObject({ ok: false, reason: "NOT_ELIGIBLE" });
    const s = await start(u.candC, "job_role", r.jC, null);
    expect(s).toMatchObject({ ok: true });
    expect(await one("SELECT stage, attempt_id FROM role_candidates WHERE id = $1", [r.rcC])).toMatchObject({ stage: "in_progress", attempt_id: s.attempt_id });
    const st = await state(u.candC, s.attempt_id as string, s.session_id as string);
    expect(st).toMatchObject({ policy: "maximum", watermark: "dev@x.in" });
    await autosave(u.candC, s.attempt_id as string, s.session_id as string, r.qC, 1, { mcq: ["d"] });
    await finish(u.candC, s.attempt_id as string, s.session_id as string);
    expect(Number((await attemptRow(s.attempt_id as string)).score)).toBe(4);
    expect((await state(u.candC, s.attempt_id as string, null)).result).toBeNull();
    // The company recruiter can read it; another org's admin can't.
    expect(await asUser(db, u.recruiterC, async (tx) => (await tx.query("SELECT id FROM attempts WHERE id = $1", [s.attempt_id])).rows.length)).toBe(1);
    expect(await asUser(db, u.adminA, async (tx) => (await tx.query("SELECT id FROM attempts WHERE id = $1", [s.attempt_id])).rows.length)).toBe(0);
  });
});
