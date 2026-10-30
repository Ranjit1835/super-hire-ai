// @vitest-environment node
// R2.8 similarity (migration 0031): the run queue the Dolos worker drains, staff-only results, MCQ answer patterns.
import { describe, it, expect, beforeAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb, createUser, asUser, asService, expectRejected } from "../helpers/pgdb";

let db: PGlite;
const u: Record<string, string> = {};
let org = "", drive = "", coding = "", asmt = "";
const mcqs: string[] = [];
const att: string[] = [];
const id = async (sql: string, p: unknown[] = []) => (await db.query<{ id: string }>(sql, p)).rows[0].id;
type Claim = { run_id: string; language: string; starter_code: string | null; submissions: { attempt_id: string; code: string }[] } | null;
const claim = () => asService(db, async (tx) => (await tx.query<{ r: Claim }>("SELECT public.b2b_similarity_claim('dolos-test') AS r")).rows[0].r);
const complete = (run: string, pairs: unknown, error: string | null = null) => asService(db, async (tx) =>
  (await tx.query<{ r: { ok: boolean; pairs?: number; retry?: boolean } }>("SELECT public.b2b_similarity_complete($1, $2, $3) AS r",
    [run, pairs == null ? null : JSON.stringify(pairs), error])).rows[0].r);
type Overview = { runs: { status: string; language: string; submissions: number }[];
  pairs: { id: number; similarity: number; a: { name: string }; b: { name: string } }[];
  mcq: { shared_wrong: number; a: { name: string }; b: { name: string } }[] };
const overview = (user: string) => asUser(db, user, async (tx) =>
  (await tx.query<{ r: Overview }>("SELECT public.b2b_drive_similarity($1) AS r", [drive])).rows[0].r);

beforeAll(async () => {
  db = await createTestDb();
  u.tpo = await createUser(db);
  u.outsider = await createUser(db);
  org = await id("INSERT INTO organizations (name, slug, type) VALUES ('Sim College', 'sim-college', 'college') RETURNING id");
  await db.query("INSERT INTO org_memberships (org_id, user_id, role) VALUES ($1, $2, 'org_admin')", [org, u.tpo]);
  coding = await id(`INSERT INTO questions (org_id, type, title, statement, difficulty, topics, languages, starter_code, status)
    VALUES ($1, 'coding', 'Two sum', 'Return the indices of two numbers that add up to target.', 'easy', '{arrays}', '{python}', '{"python":"def solve(nums, target):"}', 'draft') RETURNING id`, [org]);
  for (let i = 0; i < 4; i++) {
    mcqs.push(await id(`INSERT INTO questions (org_id, type, title, statement, difficulty, topics, options, answer, status)
      VALUES ($1, 'mcq', $2, 'Pick the right answer for this aptitude item.', 'easy', '{aptitude}', '[{"id":"a","text":"A"},{"id":"b","text":"B"},{"id":"c","text":"C"}]', '["a"]', 'verified') RETURNING id`,
      [org, `Aptitude item ${i}`]));
  }
  asmt = await id(`INSERT INTO assessments (org_id, title, duration_min, sections, languages, status, max_overlap_pct)
    VALUES ($1, 'Round 1', 30, '[]', '{python}', 'ready', 100) RETURNING id`, [org]);
  drive = await id(`INSERT INTO drives (org_id, name, assessment_id, status, window_start, window_end)
    VALUES ($1, 'Drive', $2, 'draft', now() - interval '3 hours', now() - interval '1 hour') RETURNING id`, [org, asmt]);
  const names = ["Asha", "Ravi", "Meena"];
  // Asha and Ravi share the same wrong choices on three MCQs; Meena answers everything right.
  const choices = [["b", "c", "b", "a"], ["b", "c", "b", "a"], ["a", "a", "a", "a"]];
  for (let i = 0; i < 3; i++) {
    const user = await createUser(db);
    const sid = await id("INSERT INTO students (org_id, user_id, roll_no, full_name, email, status) VALUES ($1, $2, $3, $4, $5, 'active') RETURNING id",
      [org, user, `R${i}`, names[i], `s${i}@x.in`]);
    const a = await id(`INSERT INTO attempts (org_id, assessment_id, subject_user_id, student_id, context_type, context_id, status, question_set)
      VALUES ($1, $2, $3, $4, 'drive', $5, 'submitted', '[]') RETURNING id`, [org, asmt, user, sid, drive]);
    att.push(a);
    await db.query("INSERT INTO attempt_answers (attempt_id, question_id, org_id, language, code, seq) VALUES ($1, $2, $3, 'python', $4, 1)",
      [a, coding, org, `def solve(nums, target):\n    return [${i}]`]);
    for (let q = 0; q < 4; q++) {
      await db.query("INSERT INTO attempt_answers (attempt_id, question_id, org_id, mcq_choice, seq) VALUES ($1, $2, $3, $4, 1)",
        [a, mcqs[q], org, JSON.stringify([choices[i][q]])]);
    }
  }
});

describe("similarity queue (R2.8)", () => {
  it("a drive whose window ended is queued once per coding question and language", async () => {
    expect(await asService(db, async (tx) => (await tx.query<{ n: number }>("SELECT public.b2b_similarity_enqueue_due() AS n")).rows[0].n)).toBe(1);
    expect(await asService(db, async (tx) => (await tx.query<{ n: number }>("SELECT public.b2b_similarity_enqueue_due() AS n")).rows[0].n)).toBe(0);
    await asUser(db, u.tpo, async (tx) => {
      expect((await tx.query<{ n: number }>("SELECT public.b2b_request_similarity($1) AS n", [drive])).rows[0].n).toBe(0);   // already queued
    });
  });

  it("only the service role can drive the queue; outsiders can't request or read", async () => {
    await asUser(db, u.tpo, async (tx) => {
      expect(await expectRejected(tx, "SELECT public.b2b_similarity_claim('x')")).toMatch(/permission denied/);
      expect(await expectRejected(tx, "SELECT public.b2b_similarity_complete(gen_random_uuid(), '[]', NULL)")).toMatch(/permission denied/);
    });
    await asUser(db, u.outsider, async (tx) => {
      expect(await expectRejected(tx, "SELECT public.b2b_request_similarity($1)", [drive])).toMatch(/FORBIDDEN/);
      expect(await expectRejected(tx, "SELECT public.b2b_drive_similarity($1)", [drive])).toMatch(/FORBIDDEN/);
      expect((await tx.query("SELECT * FROM similarity_runs")).rows).toHaveLength(0);
    });
  });

  it("a failed run is retried, then the worker's pairs are stored (floor 30%, own drive only)", async () => {
    const first = await claim();
    expect(first).toMatchObject({ language: "python", starter_code: "def solve(nums, target):" });
    expect(first!.submissions).toHaveLength(3);
    expect(await complete(first!.run_id, null, "parser crashed")).toEqual({ ok: true, retry: true });

    const again = await claim();
    expect(again!.run_id).toBe(first!.run_id);
    expect(await claim()).toBeNull();                                   // nothing else queued
    const frag = [{ a: [1, 4, 1, 20], b: [0, 0, 0, 9] }];   // a = att[1] as sent
    const r = await complete(again!.run_id, [
      { attempt_a: att[1], attempt_b: att[0], similarity: 0.92, longest: 14, overlap: 30, fragments: frag },
      { attempt_a: att[0], attempt_b: att[2], similarity: 0.1, longest: 1, overlap: 2, fragments: [] },          // below the floor
      { attempt_a: att[0], attempt_b: "00000000-0000-0000-0000-000000000001", similarity: 0.99 },               // not in this drive
    ]);
    expect(r).toEqual({ ok: true, pairs: 1 });
    expect(await complete(again!.run_id, [])).toMatchObject({ ok: false, reason: "NOT_RUNNING" });
  });

  it("staff see the latest results with names, and one pair side by side", async () => {
    const o = await overview(u.tpo);
    expect(o.runs).toMatchObject([{ status: "done", language: "python", submissions: 3 }]);
    expect(o.pairs).toHaveLength(1);
    expect(Number(o.pairs[0].similarity)).toBeCloseTo(0.92);
    expect([o.pairs[0].a.name, o.pairs[0].b.name].sort()).toEqual(["Asha", "Ravi"]);
    const pair = await asUser(db, u.tpo, async (tx) => (await tx.query<{ r: { a: { code: string }; fragments: unknown[] } }>(
      "SELECT public.b2b_similarity_pair($1) AS r", [o.pairs[0].id])).rows[0].r);
    expect(pair.a.code).toContain("def solve");
    // Stored lowest attempt id first; the regions follow their attempt.
    const ravi = att[1] < att[0];
    expect(pair.fragments).toEqual([ravi ? { a: [1, 4, 1, 20], b: [0, 0, 0, 9] } : { a: [0, 0, 0, 9], b: [1, 4, 1, 20] }]);
    await asUser(db, u.outsider, async (tx) => {
      expect(await expectRejected(tx, "SELECT public.b2b_similarity_pair($1)", [o.pairs[0].id])).toMatch(/FORBIDDEN/);
    });
  });

  it("MCQ: the same wrong choices are flagged, the same right ones aren't", async () => {
    const o = await overview(u.tpo);
    expect(o.mcq).toHaveLength(1);
    expect(o.mcq[0].shared_wrong).toBe(3);
    expect([o.mcq[0].a.name, o.mcq[0].b.name].sort()).toEqual(["Asha", "Ravi"]);
  });

  it("a new check replaces the old pairs; nothing is re-queued when no answer changed", async () => {
    await asUser(db, u.tpo, async (tx) => {
      expect((await tx.query<{ n: number }>("SELECT public.b2b_request_similarity($1) AS n", [drive])).rows[0].n).toBe(0);
    }, { commit: true });
    await db.query("UPDATE attempt_answers SET code = code || '\n# edited', updated_at = now() + interval '1 second' WHERE attempt_id = $1 AND question_id = $2", [att[2], coding]);
    await asUser(db, u.tpo, async (tx) => {
      expect((await tx.query<{ n: number }>("SELECT public.b2b_request_similarity($1) AS n", [drive])).rows[0].n).toBe(1);
    }, { commit: true });
    const c = await claim();
    await complete(c!.run_id, [{ attempt_a: att[2], attempt_b: att[0], similarity: 0.5, longest: 3, overlap: 5, fragments: [] }]);
    const o = await overview(u.tpo);
    expect(o.pairs).toHaveLength(1);
    expect(Number(o.pairs[0].similarity)).toBeCloseTo(0.5);
  });
});
