// @vitest-environment node
// R2.1–R2.3 paper uniqueness (migration 0029) on embedded Postgres.
import { describe, it, expect, beforeAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb, createUser, asUser, asService, expectRejected } from "../helpers/pgdb";

let db: PGlite;
const u: Record<string, string> = {};
let org = "";
let asmt = "";
let drive = "";
const students: { user: string; id: string }[] = [];
const id = async (sql: string, p: unknown[] = []) => (await db.query<{ id: string }>(sql, p)).rows[0].id;
type Cap = { feasible: boolean; expected_overlap_pct: number; fixed: { count: number; shared_pct: number; ok: boolean };
  rules: { count: number; pool: number; needed: number; ok: boolean }[] };
const capacity = (batch: number, a = asmt) => asUser(db, u.tpo, async (tx) =>
  (await tx.query<{ r: Cap }>("SELECT public.b2b_paper_capacity($1, $2) AS r", [a, batch])).rows[0].r);
const setOverlap = (pct: number, a = asmt) => db.query("UPDATE assessments SET max_overlap_pct = $2 WHERE id = $1", [a, pct]);

beforeAll(async () => {
  db = await createTestDb();
  u.super = await createUser(db, { superAdmin: true });
  u.tpo = await createUser(db);
  org = await id("INSERT INTO organizations (name, slug, type) VALUES ('Paper College', 'paper-college', 'college') RETURNING id");
  await db.query("INSERT INTO org_memberships (org_id, user_id, role) VALUES ($1, $2, 'org_admin')", [org, u.tpo]);
  for (let i = 0; i < 60; i++) {
    await db.query(`INSERT INTO questions (org_id, type, title, statement, difficulty, topics, options, answer, status)
      VALUES ($1, 'mcq', $2, 'Pick the right answer for this aptitude item.', 'easy', '{aptitude}', '[{"id":"a","text":"A"},{"id":"b","text":"B"}]', '["a"]', 'verified')`,
      [org, `Aptitude ${i}`]);
  }
  asmt = await id(`INSERT INTO assessments (org_id, title, duration_min, sections, status)
    VALUES ($1, 'Round 1', 30, $2, 'ready') RETURNING id`, [org, JSON.stringify([{ type: "mcq", title: "Aptitude", pick: [{ topics: ["aptitude"], count: 10 }] }])]);
  drive = await id(`INSERT INTO drives (org_id, name, assessment_id, status, window_start, window_end)
    VALUES ($1, 'Drive', $2, 'draft', now() - interval '1 hour', now() + interval '3 hours') RETURNING id`, [org, asmt]);
  for (let i = 0; i < 30; i++) {
    const user = await createUser(db);
    await db.query("INSERT INTO org_memberships (org_id, user_id, role) VALUES ($1, $2, 'student')", [org, user]);
    const sid = await id("INSERT INTO students (org_id, user_id, roll_no, full_name, email, status) VALUES ($1, $2, $3, $3, $4, 'active') RETURNING id",
      [org, user, `S${i}`, `s${i}@x.in`]);
    await db.query("INSERT INTO drive_assignments (drive_id, org_id, student_id) VALUES ($1, $2, $3)", [drive, org, sid]);
    students.push({ user, id: sid });
  }
});

describe("pool calculator (R2.1/R2.2)", () => {
  it("shows exactly what's short for the batch and the target", async () => {
    const c = await capacity(30);
    expect(c.feasible).toBe(false);
    expect(c.rules[0]).toMatchObject({ count: 10, pool: 60, needed: 200, ok: false });   // 10 per paper at 10% → ~200
    expect(c.expected_overlap_pct).toBeCloseTo(16.7, 1);                                  // 10/60
    await setOverlap(40);
    expect((await capacity(30)).feasible).toBe(true);                                     // needs 50, has 60
    expect((await capacity(1)).feasible).toBe(true);                                      // one student can't overlap
  });

  it("hand-picked questions are shared by everyone and count against the target", async () => {
    const qs = (await db.query<{ id: string }>("SELECT id FROM questions WHERE org_id = $1 ORDER BY title LIMIT 5", [org])).rows.map((r) => r.id);
    const fixed = await id(`INSERT INTO assessments (org_id, title, duration_min, sections, status, max_overlap_pct)
      VALUES ($1, 'Fixed', 30, $2, 'ready', 40) RETURNING id`, [org, JSON.stringify([{ type: "mcq", title: "A", question_ids: qs, pick: [{ topics: ["aptitude"], count: 5 }] }])]);
    const c = await capacity(30, fixed);
    expect(c.fixed).toMatchObject({ count: 5, shared_pct: 50, ok: false });
    expect(c.feasible).toBe(false);
  });

  it("only the org's staff (or super admins) can ask", async () => {
    const outsider = await createUser(db);
    await asUser(db, outsider, async (tx) => {
      expect(await expectRejected(tx, "SELECT public.b2b_paper_capacity($1, 5)", [asmt])).toMatch(/FORBIDDEN/);
    });
  });
});

describe("scheduling gate (R2.1)", () => {
  it("a drive can't be scheduled when the pool is short; a super admin override lets it through", async () => {
    await setOverlap(10);
    await asUser(db, u.tpo, async (tx) => {
      expect(await expectRejected(tx, "UPDATE drives SET status = 'scheduled' WHERE id = $1", [drive])).toMatch(/POOL_TOO_SMALL/);
      expect(await expectRejected(tx, "SELECT public.super_override_drive_pool($1, 'pilot batch')", [drive])).toMatch(/FORBIDDEN/);
    });
    await asUser(db, u.super, (tx) => tx.query("SELECT public.super_override_drive_pool($1, 'pilot batch, small bank agreed')", [drive]), { commit: true });
    await asUser(db, u.tpo, (tx) => tx.query("UPDATE drives SET status = 'live' WHERE id = $1", [drive]), { commit: true });
    expect((await db.query<{ status: string; pool_override_note: string }>("SELECT status, pool_override_note FROM drives WHERE id = $1", [drive])).rows[0])
      .toEqual({ status: "live", pool_override_note: "pilot batch, small bank agreed" });
  });
});

describe("draw-time overlap and exposure (R2.1/R2.3)", () => {
  it("every pair of papers in the drive shares at most the target; exposure counts every question handed out", async () => {
    await setOverlap(40);
    const start = (user: string) => asService(db, async (tx) =>
      (await tx.query<{ r: { ok: boolean } }>("SELECT public.b2b_start_attempt($1, 'drive', $2, NULL, NULL) AS r", [user, drive])).rows[0].r);
    for (const s of students.slice(0, 12)) expect(await start(s.user)).toMatchObject({ ok: true });
    const sets = (await db.query<{ ids: string[] }>(
      "SELECT ARRAY(SELECT e->>'question_id' FROM jsonb_array_elements(question_set) e) AS ids FROM attempts WHERE context_id = $1", [drive])).rows.map((r) => r.ids);
    expect(sets).toHaveLength(12);
    let worst = 0;
    for (let i = 0; i < sets.length; i++) for (let j = i + 1; j < sets.length; j++) {
      const shared = sets[i].filter((q) => sets[j].includes(q)).length / sets[i].length;
      worst = Math.max(worst, shared);
    }
    expect(worst).toBeLessThanOrEqual(0.4);
    expect(new Set(sets.map((s) => [...s].sort().join())).size).toBe(12);                 // no two identical papers
    const exposure = (await db.query<{ n: number }>("SELECT sum(exposure_count)::int AS n FROM questions WHERE org_id = $1", [org])).rows[0].n;
    expect(exposure).toBe(12 * 10);
  });

  it("over-exposed questions can be retired by the org's editors", async () => {
    const most = (await db.query<{ m: number }>("SELECT max(exposure_count) AS m FROM questions WHERE org_id = $1", [org])).rows[0].m;
    const retired = await asUser(db, u.tpo, async (tx) =>
      (await tx.query<{ n: number }>("SELECT public.b2b_retire_overexposed($1, $2) AS n", [org, most])).rows[0].n, { commit: true });
    expect(retired).toBeGreaterThan(0);
    expect((await db.query("SELECT 1 FROM questions WHERE org_id = $1 AND status = 'retired' AND exposure_count >= $2", [org, most])).rows).toHaveLength(retired);
  });
});
