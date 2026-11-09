// @vitest-environment node
// Paging/aggregate functions and the interview-module tenant guard (migrations 0012-0014) on embedded Postgres.
import { describe, it, expect, beforeAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb, createUser, asUser, expectRejected } from "../helpers/pgdb";

let db: PGlite;
const u: Record<string, string> = {};
const o: Record<string, string> = {};
const m: Record<string, string> = {};
type J = Record<string, unknown>;

const one = async <T = J>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0];
const id = async (sql: string, params: unknown[] = []) => (await one<{ id: string }>(sql, params)).id;
/** Call a function as a signed-in user and return its JSON result. */
const as = (user: string, sql: string, params: unknown[] = []) =>
  asUser(db, user, async (tx) => (await tx.query<{ r: J }>(`SELECT ${sql} AS r`, params)).rows[0].r);
const spec = (name: string) => JSON.stringify({ name, type: "skill", topics: ["Joins"], pass_threshold: 6, max_turns: 5, max_minutes: 10 });
const mcq = (org: string | null, title: string, topics: string[], status = "verified", type = "mcq") => id(
  `INSERT INTO questions (org_id, type, title, statement, difficulty, topics, options, answer, languages, status)
   VALUES ($1, $5, $2, 'Choose the correct answer here.', 'easy', $3,
           CASE WHEN $5 = 'mcq' THEN '[{"id":"a","text":"A"},{"id":"b","text":"B"}]'::jsonb END,
           CASE WHEN $5 = 'mcq' THEN '["a"]'::jsonb END, CASE WHEN $5 = 'coding' THEN '{python}'::text[] ELSE '{}'::text[] END, $4)
   RETURNING id`, [org, title, topics, status, type]);

beforeAll(async () => {
  db = await createTestDb();
  u.super = await createUser(db, { superAdmin: true });
  for (const k of ["adminA", "adminB", "recruiterC", "managerC"]) u[k] = await createUser(db);
  const org = (slug: string, type: string) => id("INSERT INTO organizations (name, slug, type) VALUES ($1, $1, $2) RETURNING id", [slug, type]);
  o.A = await org("college-a", "college");
  o.B = await org("college-b", "college");
  o.C = await org("company-c", "company");
  const member = (orgId: string, user: string, role: string) =>
    db.query("INSERT INTO org_memberships (org_id, user_id, role) VALUES ($1, $2, $3)", [orgId, user, role]);
  await member(o.A, u.adminA, "org_admin");
  await member(o.B, u.adminB, "org_admin");
  await member(o.C, u.recruiterC, "recruiter");
  await member(o.C, u.managerC, "hiring_manager");

  // Bank: A has 3 own (one draft, one retired, one coding), B has 1 private, global has 2 verified + 1 draft.
  await mcq(o.A, "Train speed", ["Aptitude"]);
  await mcq(o.A, "Pipes and cisterns", ["aptitude"], "draft");
  await mcq(o.A, "100% sure", ["percentages"], "retired");
  await mcq(o.A, "Pair sums", ["Arrays"], "verified", "coding");
  await mcq(o.B, "B private question", ["aptitude"]);
  await mcq(null, "Global joins", ["SQL"]);
  await mcq(null, "Global indexes", ["sql"]);
  await mcq(null, "Global draft", ["sql"], "draft");

  m.A = await id("INSERT INTO interview_modules (org_id, spec) VALUES ($1, $2) RETURNING id", [o.A, spec("A module")]);
  m.B = await id("INSERT INTO interview_modules (org_id, spec) VALUES ($1, $2) RETURNING id", [o.B, spec("B module")]);
  m.global = await id("INSERT INTO interview_modules (org_id, spec) VALUES (NULL, $1) RETURNING id", [spec("Library")]);

  // Roster for facets: messy branches and blanks.
  for (const [roll, dept, batch, sec] of [["1", "CSE", 2027, "A"], ["2", "ECE", 2026, "B"], ["3", "CSE", 2027, ""], ["4", "  ", null, null]] as const) {
    await db.query("INSERT INTO students (org_id, roll_no, full_name, email, department, batch_year, section) VALUES ($1, $2, $2, $3, $4, $5, $6)",
      [o.A, roll, `s${roll}@a.in`, dept, batch, sec]);
  }
});

describe("b2b_bank_page", () => {
  const page = (user: string, org: string | null, owner: string, type: string, search: string, p = 1, size = 50) =>
    as(user, "public.b2b_bank_page($1, $2, $3, $4, $5, $6)", [org, owner, type, search, p, size]);
  const titles = (r: J) => (r.rows as { title: string }[]).map((x) => x.title).sort();

  it("an org editor sees their own questions and verified global ones, never another org's", async () => {
    const r = await page(u.adminA, o.A, "all", "all", "");
    expect(titles(r)).toEqual(["100% sure", "Global indexes", "Global joins", "Pair sums", "Pipes and cisterns", "Train speed"]);
    expect(r.total).toBe(6);
    expect(r.counts).toEqual({ verified: 4, draft: 1, retired: 1, coding: 1, mcq: 5 });
    // Asking for org B's bank as A's admin returns B's rows only if RLS allows: it doesn't.
    expect(titles(await page(u.adminA, o.B, "ours", "all", ""))).toEqual([]);
  });

  it("filters by source and type; counts ignore type and search", async () => {
    expect(titles(await page(u.adminA, o.A, "ours", "all", ""))).toEqual(["100% sure", "Pair sums", "Pipes and cisterns", "Train speed"]);
    expect(titles(await page(u.adminA, o.A, "global", "all", ""))).toEqual(["Global indexes", "Global joins"]);
    const coding = await page(u.adminA, o.A, "all", "coding", "");
    expect(titles(coding)).toEqual(["Pair sums"]);
    expect((coding.counts as J).mcq).toBe(5);
  });

  it("searches title and topics case-insensitively, with LIKE wildcards taken literally", async () => {
    expect(titles(await page(u.adminA, o.A, "all", "all", "APTITUDE"))).toEqual(["Pipes and cisterns", "Train speed"]);
    expect(titles(await page(u.adminA, o.A, "all", "all", "join"))).toEqual(["Global joins"]);
    expect(titles(await page(u.adminA, o.A, "all", "all", "100%"))).toEqual(["100% sure"]);
    expect(titles(await page(u.adminA, o.A, "all", "all", "%"))).toEqual(["100% sure"]);
    expect(titles(await page(u.adminA, o.A, "all", "all", "_"))).toEqual([]);
  });

  it("pages in a stable order and reports the full total", async () => {
    const p1 = await page(u.adminA, o.A, "all", "all", "", 1, 4);
    const p2 = await page(u.adminA, o.A, "all", "all", "", 2, 4);
    expect((p1.rows as unknown[]).length).toBe(4);
    expect((p2.rows as unknown[]).length).toBe(2);
    expect(p1.total).toBe(6);
    expect(new Set([...titles(p1), ...titles(p2)]).size).toBe(6);
  });

  it("anonymous callers can't run it", async () => {
    const msg = await asUser(db, null, (tx) => expectRejected(tx, "SELECT public.b2b_bank_page(NULL, 'all', 'all', '', 1, 50)"));
    expect(msg).toMatch(/permission denied/);
  });
});

describe("interview module tenant guard", () => {
  it("a drive or role can use the org's own module or a library template, never another org's", async () => {
    await asUser(db, u.adminA, async (tx) => {
      await tx.query("INSERT INTO drives (org_id, name, interview_module_id) VALUES ($1, 'Own module', $2)", [o.A, m.A]);
      await tx.query("INSERT INTO drives (org_id, name, interview_module_id) VALUES ($1, 'Library', $2)", [o.A, m.global]);
      expect(await expectRejected(tx, "INSERT INTO drives (org_id, name, interview_module_id) VALUES ($1, 'Borrowed', $2)", [o.A, m.B]))
        .toMatch(/MODULE_NOT_IN_ORG/);
      const d = (await tx.query<{ id: string }>("SELECT id FROM drives WHERE org_id = $1 AND name = 'Own module'", [o.A])).rows[0].id;
      expect(await expectRejected(tx, "UPDATE drives SET interview_module_id = $1 WHERE id = $2", [m.B, d])).toMatch(/MODULE_NOT_IN_ORG/);
    });
    await asUser(db, u.recruiterC, async (tx) => {
      expect(await expectRejected(tx, "INSERT INTO job_roles (org_id, title, interview_module_id) VALUES ($1, 'Backend', $2)", [o.C, m.A]))
        .toMatch(/MODULE_NOT_IN_ORG/);
      await tx.query("INSERT INTO job_roles (org_id, title, interview_module_id) VALUES ($1, 'Backend', $2)", [o.C, m.global]);
    });
  });
});

describe("list aggregates", () => {
  it("b2b_student_facets returns distinct, sorted, non-blank values for staff and nothing for other orgs", async () => {
    expect(await as(u.adminA, "public.b2b_student_facets($1)", [o.A])).toEqual({ departments: ["CSE", "ECE"], batchYears: [2026, 2027], sections: ["A", "B"] });
    expect(await as(u.adminB, "public.b2b_student_facets($1)", [o.A])).toEqual({ departments: [], batchYears: [], sections: [] });
  });

  it("b2b_role_counts groups candidates per role and respects who can view a role", async () => {
    const role = await id("INSERT INTO job_roles (org_id, title, status) VALUES ($1, 'Data engineer', 'open') RETURNING id", [o.C]);
    for (const [i, stage] of ["invited", "in_progress", "completed", "shortlisted", "withdrawn"].entries()) {
      const c = await id("INSERT INTO candidates (org_id, email, full_name) VALUES ($1, $2, $2) RETURNING id", [o.C, `c${i}@x.in`]);
      await db.query("INSERT INTO role_candidates (org_id, job_role_id, candidate_id, stage) VALUES ($1, $2, $3, $4)", [o.C, role, c, stage]);
    }
    expect((await as(u.recruiterC, "public.b2b_role_counts($1)", [o.C]))[role]).toEqual({ total: 5, completed: 2 });
    // A hiring manager not assigned to the role can't see its candidates, so they aren't counted.
    expect((await as(u.managerC, "public.b2b_role_counts($1)", [o.C]))[role]).toBeUndefined();
  });

  it("b2b_student_counts_by_org counts student memberships the caller can see", async () => {
    const s1 = await createUser(db);
    const s2 = await createUser(db);
    await db.query("INSERT INTO org_memberships (org_id, user_id, role) VALUES ($1, $2, 'student'), ($1, $3, 'student')", [o.B, s1, s2]);
    expect((await as(u.super, "public.b2b_student_counts_by_org()"))[o.B]).toBe(2);
    expect((await as(u.adminA, "public.b2b_student_counts_by_org()"))[o.B]).toBeUndefined();
  });
});
