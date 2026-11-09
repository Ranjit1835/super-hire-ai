// @vitest-environment node
// R1.8 per-college practice cost (migration 0028): set by super admins in organizations.settings.practice_credits.
import { describe, it, expect, beforeAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb, createUser, asUser, asService } from "../helpers/pgdb";

let db: PGlite;
let org = "";
let assessment = "";
const id = async (sql: string, p: unknown[] = []) => (await db.query<{ id: string }>(sql, p)).rows[0].id;
const balance = async () => Number((await db.query<{ c: string }>("SELECT credits_balance::text AS c FROM organizations WHERE id = $1", [org])).rows[0].c);
const student = async (roll: string) => {
  const user = await createUser(db);
  await db.query("INSERT INTO org_memberships (org_id, user_id, role) VALUES ($1, $2, 'student')", [org, user]);
  await db.query("INSERT INTO students (org_id, user_id, roll_no, full_name, email, status) VALUES ($1, $2, $3, $3, $4, 'active')", [org, user, roll, `${roll.toLowerCase()}@x.in`]);
  return user;
};
const startPractice = (user: string) => asService(db, async (tx) => (await tx.query<{ r: { ok: boolean; reason?: string } }>(
  "SELECT public.b2b_start_attempt($1, 'practice', NULL, $2, NULL) AS r", [user, assessment])).rows[0].r);
const setCost = (v: number | null) => db.query(
  `UPDATE organizations SET settings = CASE WHEN $2::numeric IS NULL THEN settings - 'practice_credits' ELSE settings || jsonb_build_object('practice_credits', $2::numeric) END WHERE id = $1`, [org, v]);

beforeAll(async () => {
  db = await createTestDb();
  org = await id("INSERT INTO organizations (name, slug, type, credits_balance) VALUES ('Cost College', 'cost-college-r18', 'college', 10) RETURNING id");
  await id(`INSERT INTO questions (org_id, type, title, statement, difficulty, topics, options, answer, status)
    VALUES ($1, 'mcq', 'Train speed', 'A train covers 120 km in 2 hours. Speed?', 'easy', '{aptitude}', '[{"id":"a","text":"60"},{"id":"b","text":"40"}]', '["a"]', 'verified') RETURNING id`, [org]);
  assessment = await id(`INSERT INTO assessments (org_id, title, duration_min, sections, practice_enabled, status)
    VALUES ($1, 'Practice set', 30, $2, true, 'ready') RETURNING id`, [org, JSON.stringify([{ type: "mcq", title: "Aptitude", pick: [{ topics: ["aptitude"], count: 1 }] }])]);
});

describe("practice cost per college (R1.8)", () => {
  it("defaults to ¼ credit", async () => {
    const before = await balance();
    expect(await startPractice(await student("D1"))).toMatchObject({ ok: true });
    expect(await balance()).toBe(before - 0.25);
  });

  it("a super admin can make practice free: no charge and no ledger row", async () => {
    await setCost(0);
    const before = await balance();
    expect(await startPractice(await student("F1"))).toMatchObject({ ok: true });
    expect(await balance()).toBe(before);
    expect((await db.query("SELECT 1 FROM org_credit_ledger WHERE org_id = $1 AND reason = 'consume'", [org])).rows).toHaveLength(1);
  });

  it("or set another price; students see it in b2b_my_practice", async () => {
    await setCost(2);
    const user = await student("P1");
    const before = await balance();
    expect(await startPractice(user)).toMatchObject({ ok: true });
    expect(await balance()).toBe(before - 2);
    const mine = await asUser(db, user, async (tx) => (await tx.query<{ r: { practice_cost: number }[] }>("SELECT public.b2b_my_practice() AS r")).rows[0].r);
    expect(Number(mine[0].practice_cost)).toBe(2);
    await setCost(null);
  });
});
