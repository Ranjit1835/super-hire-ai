// @vitest-environment node
// B2B V1: tenant isolation and role scoping for every V1 table, proven against the real migrations.
// Four orgs (two colleges, two companies) with a row in every table; each role must see exactly the
// orgs (and rows) it is entitled to, and must not write outside them.
import { describe, it, expect, beforeAll } from "vitest";
import type { PGlite, Transaction } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { createTestDb, createUser, asUser, asService, expectRejected, affected } from "../helpers/pgdb";

let db: PGlite;
const u: Record<string, string> = {};
const o: Record<string, string> = {};
const r: Record<string, string> = {};   // seeded row ids
type Row = Record<string, unknown>;

async function one<T = Row>(sql: string, params: unknown[] = []): Promise<T> {
  return (await db.query<T>(sql, params)).rows[0];
}
const id = async (sql: string, params: unknown[] = []) => (await one<{ id: string }>(sql, params)).id;

const ORG_TABLES = [
  "students", "candidates", "questions", "assessments", "drives", "drive_assignments", "job_roles",
  "role_candidates", "role_candidate_comments", "attempts", "attempt_answers", "submissions", "edit_history",
  "proctoring_sessions", "proctoring_events", "integrity_reviews", "dimension_scores", "share_links",
  "org_resume_links", "org_credit_ledger", "audit_logs", "usage_counters", "ai_cache", "b2b_interviews",
] as const;
type Table = (typeof ORG_TABLES)[number];

/** Distinct org ids (sorted names) of the rows `user` can read in `table`. */
async function visible(user: string | null, table: Table): Promise<string[]> {
  return asUser(db, user, async (tx) => {
    const rows = (await tx.query<{ org_id: string | null }>(`SELECT DISTINCT org_id FROM public.${table}`)).rows;
    return rows.map((x) => (x.org_id === null ? "global" : name(x.org_id))).sort();
  });
}
const name = (orgId: string) => Object.entries(o).find(([, v]) => v === orgId)?.[0] ?? orgId;
const count = (user: string | null, sql: string, params: unknown[] = []) =>
  asUser(db, user, async (tx) => (await tx.query(sql, params)).rows.length);

beforeAll(async () => {
  db = await createTestDb();
  u.super = await createUser(db, { superAdmin: true });
  for (const k of ["adminA", "trainerA", "studentA", "adminB", "studentB", "adminC", "recruiterC", "hmC", "candC",
                   "candC2", "recruiterD", "candD", "b2c"]) u[k] = await createUser(db);

  const org = (slug: string, type: string) =>
    id("INSERT INTO organizations (name, slug, type) VALUES ($1, $1, $2) RETURNING id", [slug, type]);
  o.colA = await org("college-a", "college");
  o.colB = await org("college-b", "college");
  o.coC = await org("company-c", "company");
  o.coD = await org("company-d", "company");

  const member = (org: string, user: string, role: string) =>
    db.query("INSERT INTO org_memberships (org_id, user_id, role) VALUES ($1, $2, $3)", [org, user, role]);
  await member(o.colA, u.adminA, "org_admin");
  await member(o.colA, u.trainerA, "trainer");
  await member(o.colA, u.studentA, "student");
  await member(o.colB, u.adminB, "org_admin");
  await member(o.colB, u.studentB, "student");
  await member(o.coC, u.adminC, "org_admin");
  await member(o.coC, u.recruiterC, "recruiter");
  await member(o.coC, u.hmC, "hiring_manager");
  await member(o.coD, u.recruiterD, "recruiter");

  // People
  r.sA = await id("INSERT INTO students (org_id, user_id, roll_no, full_name, email, department, batch_year, cgpa, active_backlogs) VALUES ($1, $2, '21A01', 'Asha', 'asha@a.in', 'CSE', 2027, 8.1, 0) RETURNING id", [o.colA, u.studentA]);
  r.sA2 = await id("INSERT INTO students (org_id, roll_no, full_name, email) VALUES ($1, '21A02', 'Bala', 'bala@a.in') RETURNING id", [o.colA]);
  r.sB = await id("INSERT INTO students (org_id, user_id, roll_no, full_name, email) VALUES ($1, $2, '21B01', 'Chitra', 'chitra@b.in') RETURNING id", [o.colB, u.studentB]);
  r.cC1 = await id("INSERT INTO candidates (org_id, email, full_name, user_id) VALUES ($1, 'c1@x.in', 'Dev', $2) RETURNING id", [o.coC, u.candC]);
  r.cC2 = await id("INSERT INTO candidates (org_id, email, full_name, user_id) VALUES ($1, 'c2@x.in', 'Esha', $2) RETURNING id", [o.coC, u.candC2]);
  r.cD = await id("INSERT INTO candidates (org_id, email, full_name, user_id) VALUES ($1, 'd1@x.in', 'Farah', $2) RETURNING id", [o.coD, u.candD]);

  // Content
  const mcq = (org: string | null, title: string) => id(
    `INSERT INTO questions (org_id, type, title, statement, difficulty, options, answer, status)
     VALUES ($1, 'mcq', $2, 'Pick the right option please.', 'easy', '[{"id":"a","text":"A"},{"id":"b","text":"B"}]', '["a"]', 'verified') RETURNING id`, [org, title]);
  r.qA = await mcq(o.colA, "College A question");
  r.qB = await mcq(o.colB, "College B question");
  r.qG = await mcq(null, "Global question");
  r.qC = await id(`INSERT INTO questions (org_id, type, title, statement, difficulty, languages, status)
     VALUES ($1, 'coding', 'Two sum', 'Return indices of two numbers.', 'easy', '{python}', 'verified') RETURNING id`, [o.coC]);
  r.qD = await mcq(o.coD, "Company D question");
  await db.query("INSERT INTO test_cases (question_id, input, expected_output, is_sample) VALUES ($1, '1 2', '3', false)", [r.qC]);
  await db.query("INSERT INTO reference_solutions (question_id, language, code) VALUES ($1, 'python', 'print(3)')", [r.qC]);
  const assess = (org: string) => id("INSERT INTO assessments (org_id, title, duration_min) VALUES ($1, 'Test one', 60) RETURNING id", [org]);
  r.asA = await assess(o.colA); r.asB = await assess(o.colB); r.asC = await assess(o.coC); r.asD = await assess(o.coD);

  // Programs
  r.dA = await id("INSERT INTO drives (org_id, name, assessment_id, results_release) VALUES ($1, 'CSE 2027 drive', $2, 'manual') RETURNING id", [o.colA, r.asA]);
  r.dB = await id("INSERT INTO drives (org_id, name, assessment_id) VALUES ($1, 'B drive', $2) RETURNING id", [o.colB, r.asB]);
  await db.query("INSERT INTO drive_assignments (drive_id, org_id, student_id) VALUES ($1, $2, $3)", [r.dA, o.colA, r.sA]);
  await db.query("INSERT INTO drive_assignments (drive_id, org_id, student_id) VALUES ($1, $2, $3)", [r.dB, o.colB, r.sB]);
  r.jC1 = await id("INSERT INTO job_roles (org_id, title, assessment_id, hiring_manager_ids) VALUES ($1, 'Backend', $2, ARRAY[$3]::uuid[]) RETURNING id", [o.coC, r.asC, u.hmC]);
  r.jC2 = await id("INSERT INTO job_roles (org_id, title) VALUES ($1, 'Frontend') RETURNING id", [o.coC]);
  r.jD = await id("INSERT INTO job_roles (org_id, title) VALUES ($1, 'Data') RETURNING id", [o.coD]);
  r.rcC1 = await id("INSERT INTO role_candidates (org_id, job_role_id, candidate_id) VALUES ($1, $2, $3) RETURNING id", [o.coC, r.jC1, r.cC1]);
  r.rcC2 = await id("INSERT INTO role_candidates (org_id, job_role_id, candidate_id) VALUES ($1, $2, $3) RETURNING id", [o.coC, r.jC2, r.cC2]);
  r.rcD = await id("INSERT INTO role_candidates (org_id, job_role_id, candidate_id) VALUES ($1, $2, $3) RETURNING id", [o.coD, r.jD, r.cD]);
  await db.query("INSERT INTO role_candidate_comments (org_id, role_candidate_id, author_id, body) VALUES ($1, $2, $3, 'Strong') ", [o.coC, r.rcC1, u.recruiterC]);
  await db.query("INSERT INTO role_candidate_comments (org_id, role_candidate_id, author_id, body) VALUES ($1, $2, $3, 'Maybe') ", [o.coD, r.rcD, u.recruiterD]);

  // Attempts and everything hanging off them
  const attempt = (org: string, as: string, subject: string, extra: string, vals: unknown[]) => id(
    `INSERT INTO attempts (org_id, assessment_id, subject_user_id, status, score, max_score, ${extra}) VALUES ($1, $2, $3, 'submitted', 50, 100, ${vals.map((_, i) => `$${i + 4}`).join(", ")}) RETURNING id`,
    [org, as, subject, ...vals]);
  r.atA = await attempt(o.colA, r.asA, u.studentA, "student_id, context_type, context_id", [r.sA, "drive", r.dA]);
  r.atB = await attempt(o.colB, r.asB, u.studentB, "student_id, context_type, context_id", [r.sB, "drive", r.dB]);
  r.atC1 = await attempt(o.coC, r.asC, u.candC, "candidate_id, context_type, context_id", [r.cC1, "job_role", r.jC1]);
  r.atC2 = await attempt(o.coC, r.asC, u.candC2, "candidate_id, context_type, context_id", [r.cC2, "job_role", r.jC2]);
  r.atD = await attempt(o.coD, r.asD, u.candD, "candidate_id, context_type, context_id", [r.cD, "job_role", r.jD]);
  for (const [at, org, q] of [[r.atA, o.colA, r.qA], [r.atB, o.colB, r.qB], [r.atC1, o.coC, r.qC], [r.atC2, o.coC, r.qC], [r.atD, o.coD, r.qD]]) {
    await db.query("INSERT INTO attempt_answers (attempt_id, question_id, org_id, code) VALUES ($1, $2, $3, 'x')", [at, q, org]);
    await db.query("INSERT INTO submissions (attempt_id, question_id, org_id, kind, status) VALUES ($1, $2, $3, 'run', 'done'), ($1, $2, $3, 'final', 'done')", [at, q, org]);
    await db.query("INSERT INTO edit_history (attempt_id, question_id, org_id, seq, events) VALUES ($1, $2, $3, 1, '[]')", [at, q, org]);
  }
  const ctx = (at: string) => one<{ context_type: string; context_id: string; org_id: string; subject_user_id: string }>(
    "SELECT context_type, context_id, org_id, subject_user_id FROM attempts WHERE id = $1", [at]);
  for (const at of [r.atA, r.atB, r.atC1, r.atC2, r.atD]) {
    const c = await ctx(at);
    const s = await id(`INSERT INTO proctoring_sessions (org_id, subject_user_id, context_type, context_id, attempt_id, policy)
      VALUES ($1, $2, $3, $4, $5, 'standard') RETURNING id`, [c.org_id, c.subject_user_id, c.context_type, c.context_id, at]);
    await db.query("INSERT INTO proctoring_events (session_id, org_id, type, severity, started_at) VALUES ($1, $2, 'tab_hidden', 'medium', now())", [s, c.org_id]);
    const reviewer = { [o.colA]: u.adminA, [o.colB]: u.adminB, [o.coC]: u.adminC, [o.coD]: u.recruiterD }[c.org_id];
    await db.query("INSERT INTO integrity_reviews (session_id, org_id, reviewer_id, decision) VALUES ($1, $2, $3, 'no_concern')", [s, c.org_id, reviewer]);
    await db.query(`INSERT INTO dimension_scores (org_id, subject_user_id, source_type, source_id, context_type, context_id, dimension, score)
      VALUES ($1, $2, 'assessment', $3, $4, $5, 'coding', 70)`, [c.org_id, c.subject_user_id, at, c.context_type, c.context_id]);
    if (c.context_type === "drive") {
      await db.query("UPDATE drive_assignments SET attempt_id = $1 WHERE drive_id = $2", [at, c.context_id]);
    }
  }
  const share = (org: string, rc: string) => db.query(
    "INSERT INTO share_links (org_id, kind, target_id, token_hash, expires_at) VALUES ($1, 'candidate_report', $2, $3, now() + interval '7 days')",
    [org, rc, randomUUID().replace(/-/g, "").padEnd(64, "0")]);
  await share(o.coC, r.rcC1); await share(o.coC, r.rcC2); await share(o.coD, r.rcD);
  await db.query("INSERT INTO org_resume_links (org_id, student_id, user_id, resume_analysis_id, drive_id) VALUES ($1, $2, $3, $4, $5)", [o.colA, r.sA, u.studentA, randomUUID(), r.dA]);
  await db.query("INSERT INTO org_resume_links (org_id, student_id, user_id, resume_analysis_id) VALUES ($1, $2, $3, $4)", [o.colB, r.sB, u.studentB, randomUUID()]);
  for (const org of [o.colA, o.colB, o.coC, o.coD]) {
    await db.query("INSERT INTO org_credit_ledger (org_id, delta, balance_after, reason) VALUES ($1, 10, 10, 'grant')", [org]);
    await db.query("INSERT INTO usage_counters (org_id, feature, period_start, used) VALUES ($1, 'practice_interview', current_date, 1)", [org]);
    await db.query("INSERT INTO ai_cache (key, feature, prompt_version, model, org_id, status, response) VALUES ($1, 'f', 'v1', 'm', $2, 'ready', '{}')",
      [randomUUID().replace(/-/g, "").padEnd(64, "a"), org]);
  }
  // Pilot interviews in each context.
  const spec = JSON.stringify({ name: "SQL", type: "skill", topics: ["Joins"], pass_threshold: 6, max_turns: 5, max_minutes: 10 });
  const iv = async (org: string, user: string, kind: string, ctxId: string | null) => {
    const mod = await id("INSERT INTO interview_modules (org_id, spec) VALUES ($1, $2) RETURNING id", [org, spec]);
    await db.query(
      `INSERT INTO b2b_interviews (org_id, user_id, module_id, module_version, module_spec, state, status, prompt_version, deadline_at, kind, context_id)
       VALUES ($1, $2, $3, 1, '{}', '{}', 'completed', 'p', now(), $4, $5)`, [org, user, mod, kind, ctxId]);
  };
  await iv(o.colA, u.studentA, "drive", r.dA);
  await iv(o.coC, u.candC, "job_role", r.jC1);
});

describe("tenant isolation: which orgs each role can read", () => {
  const expectVisible = async (user: string | null, table: Table, orgs: string[]) =>
    expect(await visible(user, table), `${table}`).toEqual([...orgs].sort());

  it("a college admin sees only their college (plus global bank questions), nothing of companies", async () => {
    const A = ["colA"];
    for (const t of ["students", "assessments", "drives", "drive_assignments", "attempts", "attempt_answers", "submissions",
                     "edit_history", "proctoring_sessions", "proctoring_events", "integrity_reviews", "dimension_scores",
                     "org_resume_links", "org_credit_ledger", "usage_counters", "b2b_interviews"] as Table[]) {
      await expectVisible(u.adminA, t, A);
    }
    await expectVisible(u.adminA, "questions", ["colA", "global"]);
    for (const t of ["candidates", "job_roles", "role_candidates", "role_candidate_comments", "share_links", "ai_cache"] as Table[]) {
      await expectVisible(u.adminA, t, []);
    }
  });

  it("a trainer reads college data but not the ledger, quotas or audit log", async () => {
    await expectVisible(u.trainerA, "students", ["colA"]);
    await expectVisible(u.trainerA, "attempts", ["colA"]);
    for (const t of ["org_credit_ledger", "usage_counters", "audit_logs"] as Table[]) await expectVisible(u.trainerA, t, []);
  });

  it("a company admin and recruiter see only their company, nothing of colleges or the other company", async () => {
    for (const who of [u.adminC, u.recruiterC]) {
      for (const t of ["candidates", "job_roles", "role_candidates", "role_candidate_comments", "attempts", "attempt_answers",
                       "submissions", "edit_history", "proctoring_sessions", "proctoring_events", "integrity_reviews",
                       "dimension_scores", "share_links", "assessments", "b2b_interviews"] as Table[]) {
        await expectVisible(who, t, ["coC"]);
      }
      await expectVisible(who, "questions", ["coC", "global"]);
      for (const t of ["students", "drives", "drive_assignments", "org_resume_links", "ai_cache"] as Table[]) await expectVisible(who, t, []);
    }
    expect(await count(u.recruiterC, "SELECT 1 FROM test_cases")).toBe(1);
    expect(await count(u.recruiterD, "SELECT 1 FROM test_cases")).toBe(0);
  });

  it("a hiring manager sees only the job roles assigned to them", async () => {
    expect(await count(u.hmC, "SELECT 1 FROM job_roles")).toBe(1);
    expect(await count(u.hmC, "SELECT 1 FROM role_candidates WHERE id = $1", [r.rcC1])).toBe(1);
    expect(await count(u.hmC, "SELECT 1 FROM role_candidates WHERE id = $1", [r.rcC2])).toBe(0);
    expect(await count(u.hmC, "SELECT 1 FROM candidates")).toBe(1);
    expect(await count(u.hmC, "SELECT 1 FROM attempts")).toBe(1);
    expect(await count(u.hmC, "SELECT 1 FROM share_links")).toBe(1);
    expect(await count(u.hmC, "SELECT 1 FROM questions")).toBe(0);   // reviewers don't browse the bank
    expect(await count(u.hmC, "SELECT 1 FROM test_cases")).toBe(0);
  });

  it("a student sees their own row, assigned drive and answers, but no bank, no other students, and no scores before release", async () => {
    expect(await count(u.studentA, "SELECT 1 FROM students")).toBe(1);
    await expectVisible(u.studentA, "drives", ["colA"]);
    await expectVisible(u.studentA, "drive_assignments", ["colA"]);
    await expectVisible(u.studentA, "attempt_answers", ["colA"]);
    for (const t of ["questions", "assessments", "attempts", "edit_history", "proctoring_sessions", "proctoring_events",
                     "dimension_scores", "candidates", "job_roles"] as Table[]) {
      await expectVisible(u.studentA, t, []);
    }
    expect(await count(u.studentA, "SELECT 1 FROM test_cases")).toBe(0);
    expect(await count(u.studentA, "SELECT 1 FROM reference_solutions")).toBe(0);
    expect(await count(u.studentA, "SELECT kind FROM submissions")).toBe(1);          // own sample run only
    expect(await count(u.studentA, "SELECT 1 FROM b2b_interviews")).toBe(1);          // own interview row
    expect(await count(u.studentA, "SELECT 1 FROM b2b_evaluations")).toBe(0);
  });

  it("released drive results become visible to the student, and only theirs", async () => {
    await db.query("UPDATE drives SET results_released_at = now() WHERE id = $1", [r.dA]);
    try {
      await expectVisible(u.studentA, "attempts", ["colA"]);
      await expectVisible(u.studentA, "dimension_scores", ["colA"]);
      expect(await count(u.studentA, "SELECT 1 FROM submissions")).toBe(2);
      expect(await count(u.studentB, "SELECT 1 FROM attempts")).toBe(0);
    } finally {
      await db.query("UPDATE drives SET results_released_at = NULL WHERE id = $1", [r.dA]);
    }
  });

  it("a candidate sees their own candidate row and answers, never scores, reports, roles or the bank", async () => {
    expect(await count(u.candC, "SELECT 1 FROM candidates")).toBe(1);
    await expectVisible(u.candC, "attempt_answers", ["coC"]);
    for (const t of ["attempts", "job_roles", "role_candidates", "questions", "dimension_scores", "proctoring_events",
                     "share_links", "students"] as Table[]) {
      await expectVisible(u.candC, t, []);
    }
    expect(await count(u.candC, "SELECT 1 FROM submissions")).toBe(1);   // own sample run only
  });

  it("a B2C user and an anonymous request see nothing", async () => {
    for (const who of [u.b2c, null]) {
      for (const t of ORG_TABLES) await expectVisible(who, t, []);
      expect(await count(who, "SELECT 1 FROM test_cases")).toBe(0);
    }
  });

  it("the AI cache is service-role only", async () => {
    for (const who of [u.super, u.adminA, u.recruiterC]) await expectVisible(who, "ai_cache", []);
  });
});

describe("tenant isolation: writes", () => {
  const rejected = (user: string, sql: string, params: unknown[] = []) =>
    asUser(db, user, (tx) => expectRejected(tx, sql, params));
  const changes = (user: string, sql: string, params: unknown[] = []) => asUser(db, user, (tx) => affected(tx, sql, params));

  it("staff can't create rows in another org", async () => {
    await rejected(u.adminA, "INSERT INTO students (org_id, roll_no, full_name, email) VALUES ($1, 'X1', 'X', 'x@b.in')", [o.colB]);
    await rejected(u.adminA, "INSERT INTO drives (org_id, name) VALUES ($1, 'Sneaky drive')", [o.colB]);
    await rejected(u.adminA, "INSERT INTO assessments (org_id, title, duration_min) VALUES ($1, 'Sneaky', 30)", [o.coC]);
    await rejected(u.recruiterC, "INSERT INTO job_roles (org_id, title) VALUES ($1, 'Sneaky')", [o.coD]);
    await rejected(u.recruiterC, "INSERT INTO candidates (org_id, email, full_name) VALUES ($1, 'z@z.in', 'Z')", [o.coD]);
    await rejected(u.adminA, "INSERT INTO questions (org_id, type, title, statement, difficulty, options, answer) VALUES (NULL, 'mcq', 'Global?', 'Statement here.', 'easy', '[]', '[]')");
  });

  it("staff can't change or delete another org's rows (RLS hides them)", async () => {
    expect(await changes(u.adminA, "UPDATE students SET full_name = 'Hacked' WHERE org_id = $1", [o.colB])).toBe(0);
    expect(await changes(u.adminA, "DELETE FROM drives WHERE org_id = $1", [o.colB])).toBe(0);
    expect(await changes(u.recruiterC, "UPDATE role_candidates SET stage = 'hired' WHERE org_id = $1", [o.coD])).toBe(0);
    expect(await changes(u.recruiterC, "DELETE FROM job_roles WHERE org_id = $1", [o.coD])).toBe(0);
    expect(await changes(u.adminC, "UPDATE share_links SET revoked_at = now() WHERE org_id = $1", [o.coD])).toBe(0);
  });

  it("roles inside an org are limited too", async () => {
    await rejected(u.trainerA, "INSERT INTO students (org_id, roll_no, full_name, email) VALUES ($1, 'T1', 'T', 't@a.in')", [o.colA]);
    await rejected(u.hmC, "INSERT INTO job_roles (org_id, title) VALUES ($1, 'HM role')", [o.coC]);
    expect(await changes(u.hmC, "UPDATE role_candidates SET stage = 'hired'")).toBe(0);
    await rejected(u.recruiterC, `INSERT INTO questions (org_id, type, title, statement, difficulty, languages, status)
      VALUES ($1, 'coding', 'Fake verified', 'Statement here.', 'easy', '{python}', 'verified')`, [o.coC]);
    await changes(u.recruiterC, `INSERT INTO questions (org_id, type, title, statement, difficulty, languages)
      VALUES ($1, 'coding', 'Draft one', 'Statement here.', 'easy', '{python}')`, [o.coC]);
  });

  it("students and candidates can't write their own scores, attempts or answers directly", async () => {
    await rejected(u.studentA, "INSERT INTO attempts (org_id, assessment_id, subject_user_id, context_type) VALUES ($1, $2, $3, 'practice')", [o.colA, r.asA, u.studentA]);
    expect(await changes(u.studentA, "UPDATE attempts SET score = 100")).toBe(0);
    expect(await changes(u.studentA, "UPDATE attempt_answers SET code = 'y'")).toBe(0);
    expect(await changes(u.candC, "UPDATE candidates SET full_name = 'Me'")).toBe(0);
    const sess = await one<{ id: string }>("SELECT id FROM proctoring_sessions WHERE subject_user_id = $1", [u.candC]);
    await rejected(u.candC, "INSERT INTO proctoring_events (session_id, org_id, type, severity, started_at) VALUES ($1, $2, 'x_x_x', 'low', now())", [sess.id, o.coC]);
    expect(await changes(u.candC, "UPDATE proctoring_sessions SET integrity_score = 100")).toBe(0);
    expect(await changes(u.studentA, "UPDATE students SET cgpa = 10")).toBe(0);
  });

  it("an org admin can't attach a user account to a student record", async () => {
    await rejected(u.adminA, "UPDATE students SET user_id = $1 WHERE id = $2", [u.b2c, r.sA2]);
  });
});

describe("tenancy rules", () => {
  it("roles must fit the org type, and the type is locked once there are members", async () => {
    await expect(db.query("INSERT INTO org_memberships (org_id, user_id, role) VALUES ($1, $2, 'recruiter')", [o.colA, u.b2c])).rejects.toThrow(/ROLE_NOT_ALLOWED/);
    await expect(db.query("INSERT INTO org_memberships (org_id, user_id, role) VALUES ($1, $2, 'student')", [o.coC, u.b2c])).rejects.toThrow(/ROLE_NOT_ALLOWED/);
    await expect(db.query("UPDATE organizations SET type = 'company' WHERE id = $1", [o.colA])).rejects.toThrow(/ORG_TYPE_LOCKED/);
    await expect(db.query("INSERT INTO students (org_id, roll_no, full_name, email) VALUES ($1, 'Z', 'Z', 'z@c.in')", [o.coC])).rejects.toThrow(/WRONG_ORG_TYPE/);
    await expect(db.query("INSERT INTO job_roles (org_id, title) VALUES ($1, 'Nope')", [o.colA])).rejects.toThrow(/WRONG_ORG_TYPE/);
  });

  it("admin actions are audited with the actor; org admins read their org's log only", async () => {
    await asUser(db, u.adminA, (tx) => tx.query("UPDATE students SET department = 'ECE' WHERE id = $1", [r.sA2]), { commit: true });
    const row = await one<{ actor_id: string; meta: { changed: Record<string, unknown> } }>(
      "SELECT actor_id, meta FROM audit_logs WHERE action = 'students.update' AND target_id = $1 ORDER BY id DESC LIMIT 1", [r.sA2]);
    expect(row.actor_id).toBe(u.adminA);
    expect(row.meta.changed).toHaveProperty("department");
    expect(await visible(u.adminA, "audit_logs")).toEqual(["colA"]);
    expect(await count(u.adminB, "SELECT 1 FROM audit_logs WHERE target_id = $1", [r.sA2])).toBe(0);
    await asUser(db, u.adminA, async (tx) => {
      await expectRejected(tx, "INSERT INTO audit_logs (action) VALUES ('fake.entry')");
      expect(await affected(tx, "DELETE FROM audit_logs")).toBe(0);
    });
  });
});

describe("credits", () => {
  const svc = <T = Row>(sql: string, params: unknown[]) =>
    asService(db, async (tx) => (await tx.query<{ r: T }>(sql, params)).rows[0].r);
  const consume = (org: string, amount: number, ref: string) =>
    svc<Row>("SELECT public.b2b_consume_credits($1, $2, 'practice_interview', 'interview', $3, NULL) AS r", [org, amount, ref]);

  it("only a super admin adds credits; staff can't touch the balance", async () => {
    await asUser(db, u.adminA, async (tx: Transaction) => {
      expect(await expectRejected(tx, "SELECT public.super_adjust_credits($1, 100, 'grant')", [o.colA])).toMatch(/FORBIDDEN/);
      expect(await affected(tx, "UPDATE organizations SET credits_balance = 9999 WHERE id = $1", [o.colA])).toBe(0);
      expect(await expectRejected(tx, "SELECT public.b2b_consume_credits($1, 1, 'f', 'x', 'y', NULL)", [o.colA])).toMatch(/permission denied/);
    });
    const bal = await asUser(db, u.super, async (tx) =>
      (await tx.query<{ b: string }>("SELECT public.super_adjust_credits($1, 3, 'grant', 'pilot pool') AS b", [o.colB])).rows[0].b, { commit: true });
    expect(Number(bal)).toBe(3);
  });

  it("consumes atomically, once per reference, and stops at zero", async () => {
    expect(await consume(o.colB, 1, "iv-1")).toMatchObject({ ok: true, balance: 2 });
    expect(await consume(o.colB, 1, "iv-1")).toMatchObject({ ok: true, already: true });
    expect(await consume(o.colB, 1.5, "iv-2")).toMatchObject({ ok: true, balance: 0.5 });
    expect(await consume(o.colB, 1, "iv-3")).toMatchObject({ ok: false, reason: "NO_CREDITS" });
    expect(await svc("SELECT public.b2b_refund_credits($1, 'interview', 'iv-2', NULL) AS r", [o.colB])).toMatchObject({ ok: true, refunded: 1.5 });
    expect(await svc("SELECT public.b2b_refund_credits($1, 'interview', 'iv-2', NULL) AS r", [o.colB])).toMatchObject({ ok: false });
    const ledger = (await db.query<{ reason: string }>("SELECT reason FROM org_credit_ledger WHERE org_id = $1 ORDER BY id", [o.colB])).rows.map((x) => x.reason);
    expect(ledger).toEqual(["grant", "grant", "consume", "consume", "refund"]);
  });

  it("refuses suspended orgs", async () => {
    await db.query("UPDATE organizations SET status = 'suspended' WHERE id = $1", [o.colB]);
    expect(await consume(o.colB, 0.5, "iv-9")).toMatchObject({ ok: false, reason: "ORG_SUSPENDED" });
    await db.query("UPDATE organizations SET status = 'active' WHERE id = $1", [o.colB]);
  });
});

describe("staff invites and student activation", () => {
  const hash = () => randomUUID().replace(/-/g, "").padEnd(64, "b");
  const svc = (sql: string, params: unknown[]) => asService(db, async (tx) => (await tx.query<{ r: Row }>(sql, params)).rows[0].r);

  it("only super admins invite staff (R3.3/D7); roles must fit the org type", async () => {
    // Org admins can't add staff of any role, in their own org or another.
    for (const role of ["trainer", "org_admin"]) {
      await expect(svc(`SELECT public.b2b_invite_staff($1, $2, 'x@a.in', 'X', '${role}', $3) AS r`, [u.adminA, o.colA, hash()])).rejects.toThrow(/FORBIDDEN/);
    }
    await expect(svc("SELECT public.b2b_invite_staff($1, $2, 'x@b.in', 'X', 'trainer', $3) AS r", [u.adminA, o.colB, hash()])).rejects.toThrow(/FORBIDDEN/);
    expect(await svc("SELECT public.b2b_invite_staff($1, $2, 'tpo2@a.in', 'TPO Two', 'trainer', $3) AS r", [u.super, o.colA, hash()])).toMatchObject({ ok: true });
    expect(await svc("SELECT public.b2b_invite_staff($1, $2, 'r@a.in', 'R', 'recruiter', $3) AS r", [u.super, o.colA, hash()])).toMatchObject({ ok: false, reason: "ROLE_NOT_ALLOWED" });
    expect(await svc("SELECT public.b2b_invite_staff($1, $2, 's@a.in', 'S', 'student', $3) AS r", [u.super, o.colA, hash()])).toMatchObject({ ok: false, reason: "ROLE_NOT_ALLOWED" });
  });

  it("org admins manage student memberships only: no promotions, no touching staff (R3.3/D7)", async () => {
    const stu = await createUser(db);
    const trainer = await createUser(db);
    await db.query("INSERT INTO org_memberships (org_id, user_id, role) VALUES ($1, $2, 'student'), ($1, $3, 'trainer')", [o.colA, stu, trainer]);
    await asUser(db, u.adminA, async (tx) => {
      // A student row can be edited, but not promoted.
      expect(await affected(tx, "UPDATE org_memberships SET full_name = 'Renamed' WHERE user_id = $1 AND org_id = $2", [stu, o.colA])).toBe(1);
      expect(await expectRejected(tx, "UPDATE org_memberships SET role = 'org_admin' WHERE user_id = $1 AND org_id = $2", [stu, o.colA])).toMatch(/row-level security/);
      // Staff rows are invisible to updates and deletes.
      expect(await affected(tx, "UPDATE org_memberships SET role = 'org_admin' WHERE user_id = $1 AND org_id = $2", [trainer, o.colA])).toBe(0);
      expect(await affected(tx, "DELETE FROM org_memberships WHERE user_id = $1 AND org_id = $2", [trainer, o.colA])).toBe(0);
      expect(await affected(tx, "DELETE FROM org_memberships WHERE user_id = $1 AND org_id = $2", [stu, o.colA])).toBe(1);
    });
    expect((await one<{ role: string }>("SELECT role FROM org_memberships WHERE user_id = $1", [trainer])).role).toBe("trainer");
  });


  it("a staff link works only for the invited email", async () => {
    const t = hash();
    await svc("SELECT public.b2b_invite_staff($1, $2, 'boss@c.in', 'Boss', 'org_admin', $3) AS r", [u.super, o.coC, t]);
    const stranger = await createUser(db);
    expect(await svc("SELECT public.b2b_accept_invite($1, $2, NULL, NULL) AS r", [t, stranger])).toMatchObject({ ok: false, reason: "WRONG_ACCOUNT" });
    const boss = await createUser(db);
    await db.query("UPDATE auth.users SET email = 'boss@c.in' WHERE id = $1", [boss]);
    expect(await svc("SELECT public.b2b_accept_invite($1, $2, NULL, NULL) AS r", [t, boss])).toMatchObject({ ok: true, role: "org_admin" });
    expect((await one<{ role: string }>("SELECT role FROM org_memberships WHERE user_id = $1", [boss])).role).toBe("org_admin");
  });

  it("a student invite tied to a student record activates it; held minors can't activate", async () => {
    const t = hash();
    await db.query("INSERT INTO org_invites (org_id, full_name, email, roll_no, token_hash, student_id) VALUES ($1, 'Bala', 'bala@a.in', '21A02', $2, $3)", [o.colA, t, r.sA2]);
    const bala = await createUser(db);
    expect(await svc("SELECT public.b2b_accept_invite($1, $2, 'v1', 'I agree') AS r", [t, bala])).toMatchObject({ ok: true });
    expect(await one("SELECT user_id, status FROM students WHERE id = $1", [r.sA2])).toEqual({ user_id: bala, status: "active" });

    const minor = await id("INSERT INTO students (org_id, roll_no, full_name, email, dob, status) VALUES ($1, '21A99', 'Kid', 'kid@a.in', current_date - interval '17 years', 'held_minor') RETURNING id", [o.colA]);
    const t2 = hash();
    await db.query("INSERT INTO org_invites (org_id, full_name, email, roll_no, token_hash, student_id) VALUES ($1, 'Kid', 'kid@a.in', '21A99', $2, $3)", [o.colA, t2, minor]);
    expect(await svc("SELECT public.b2b_accept_invite($1, $2, 'v1', 'I agree') AS r", [t2, await createUser(db)])).toMatchObject({ ok: false, reason: "HELD_MINOR" });
    expect((await one<{ m: boolean }>("SELECT public.b2b_is_minor((current_date - interval '17 years')::date) AS m")).m).toBe(true);
    expect((await one<{ m: boolean }>("SELECT public.b2b_is_minor((current_date - interval '19 years')::date) AS m")).m).toBe(false);
  });
});

describe("consents", () => {
  it("are itemised per purpose and the subject can withdraw their own", async () => {
    await asService(db, (tx) => tx.query("SELECT public.b2b_record_consent($1, $2, 'proctoring_camera', 'v1', 'Camera snapshots every 30 s')", [o.colA, u.studentA]));
    const has = () => asService(db, async (tx) => (await tx.query<{ h: boolean }>("SELECT public.b2b_has_consent($1, $2, 'proctoring_camera') AS h", [o.colA, u.studentA])).rows[0].h);
    expect(await has()).toBe(true);
    const n = await asUser(db, u.studentA, async (tx) => (await tx.query<{ n: number }>("SELECT public.withdraw_consent($1, 'proctoring_camera') AS n", [o.colA])).rows[0].n, { commit: true });
    expect(n).toBe(1);
    expect(await has()).toBe(false);
    // Someone else can't withdraw it for them (no rows match their uid).
    expect(await asUser(db, u.adminA, async (tx) => (await tx.query<{ n: number }>("SELECT public.withdraw_consent($1, 'proctoring_camera') AS n", [o.colA])).rows[0].n)).toBe(0);
  });
});
