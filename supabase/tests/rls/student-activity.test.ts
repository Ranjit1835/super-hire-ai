// @vitest-environment node
// Student activity (migration 0019): no login charges; the record is what a student was assigned and did.
import { describe, it, expect, beforeAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb, createUser, asUser, asService, expectRejected } from "../helpers/pgdb";

let db: PGlite;
const u: Record<string, string> = {};
const id: Record<string, string> = {};
const one = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0];
const kinds = async (student: string) =>
  (await db.query<{ kind: string }>("SELECT kind FROM student_activity WHERE student_id = $1 ORDER BY id", [student])).rows.map((r) => r.kind);
const svc = (sql: string, params: unknown[] = []) => asService(db, (tx) => tx.query(sql, params));

beforeAll(async () => {
  db = await createTestDb();
  u.super = await createUser(db, { superAdmin: true });
  for (const k of ["tpo", "tpoB", "asha", "bala"]) u[k] = await createUser(db);
  id.org = (await one<{ id: string }>("INSERT INTO organizations (name, slug, type, seat_limit) VALUES ('Act College', 'act-college', 'college', 10) RETURNING id")).id;
  id.orgB = (await one<{ id: string }>("INSERT INTO organizations (name, slug, type) VALUES ('Other', 'act-other', 'college') RETURNING id")).id;
  await db.query("INSERT INTO org_memberships (org_id, user_id, role) VALUES ($1, $2, 'org_admin'), ($3, $4, 'org_admin'), ($1, $5, 'student'), ($1, $6, 'student')",
    [id.org, u.tpo, id.orgB, u.tpoB, u.asha, u.bala]);
  id.asha = (await one<{ id: string }>("INSERT INTO students (org_id, roll_no, full_name, email, status) VALUES ($1, 'A1', 'Asha', 'asha@a.in', 'invited') RETURNING id", [id.org])).id;
  id.bala = (await one<{ id: string }>("INSERT INTO students (org_id, roll_no, full_name, email, status, user_id) VALUES ($1, 'B1', 'Bala', 'bala@a.in', 'active', $2) RETURNING id", [id.org, u.bala])).id;
  id.drive1 = (await one<{ id: string }>("INSERT INTO drives (org_id, name, status) VALUES ($1, 'Drive one', 'live') RETURNING id", [id.org])).id;
  id.drive2 = (await one<{ id: string }>("INSERT INTO drives (org_id, name, status) VALUES ($1, 'Drive two', 'live') RETURNING id", [id.org])).id;
});

describe("student activity (no login charges)", () => {
  it("activation is recorded and marks the seat used; no credits move", async () => {
    const before = (await one<{ c: string }>("SELECT credits_balance::text AS c FROM organizations WHERE id = $1", [id.org])).c;
    await svc("UPDATE students SET status = 'active', user_id = $2 WHERE id = $1", [id.asha, u.asha]);
    expect(await kinds(id.asha)).toEqual(["activated"]);
    const s = await one<{ seat_locked_at: string | null; last_active_at: string | null }>("SELECT seat_locked_at, last_active_at FROM students WHERE id = $1", [id.asha]);
    expect(s.seat_locked_at).not.toBeNull();
    expect(s.last_active_at).not.toBeNull();
    expect((await one<{ c: string }>("SELECT credits_balance::text AS c FROM organizations WHERE id = $1", [id.org])).c).toBe(before);
    expect((await one<{ n: number }>("SELECT count(*)::int AS n FROM org_credit_ledger WHERE org_id = $1", [id.org])).n).toBe(0);
  });

  it("assigned → started → completed is recorded per drive; a new drive appears only when the TPO assigns it", async () => {
    await svc("INSERT INTO drive_assignments (drive_id, org_id, student_id) VALUES ($1, $2, $3)", [id.drive1, id.org, id.asha]);
    await svc("UPDATE drive_assignments SET status = 'in_progress' WHERE drive_id = $1 AND student_id = $2", [id.drive1, id.asha]);
    await svc("UPDATE drive_assignments SET status = 'completed', completed_at = now() WHERE drive_id = $1 AND student_id = $2", [id.drive1, id.asha]);
    expect(await kinds(id.asha)).toEqual(["activated", "assigned", "started", "completed"]);
    // One assignment per drive and student: the same drive can't be handed out twice.
    await expect(svc("INSERT INTO drive_assignments (drive_id, org_id, student_id) VALUES ($1, $2, $3)", [id.drive1, id.org, id.asha])).rejects.toThrow(/duplicate key/);
    // Asha sees exactly one drive, completed, until her TPO assigns another.
    const mine = await asUser(db, u.asha, async (tx) => (await tx.query<{ drive_id: string; status: string }>("SELECT drive_id, status FROM drive_assignments")).rows);
    expect(mine).toEqual([{ drive_id: id.drive1, status: "completed" }]);
    await svc("INSERT INTO drive_assignments (drive_id, org_id, student_id) VALUES ($1, $2, $3)", [id.drive2, id.org, id.asha]);
    const after = await asUser(db, u.asha, async (tx) => (await tx.query<{ status: string }>("SELECT status FROM drive_assignments ORDER BY status")).rows.map((r) => r.status));
    expect(after).toEqual(["assigned", "completed"]);
  });

  it("the TPO sees per-student counts and last activity; other orgs see nothing", async () => {
    const s = await asUser(db, u.tpo, async (tx) => (await tx.query<{ r: Record<string, { assigned: number; completed: number; last_active_at: string | null }> }>(
      "SELECT public.b2b_student_activity_summary($1) AS r", [id.org])).rows[0].r);
    expect(s[id.asha]).toMatchObject({ assigned: 2, completed: 1 });
    expect(s[id.asha].last_active_at).not.toBeNull();
    expect(s[id.bala]).toMatchObject({ assigned: 0, completed: 0 });
    expect(await asUser(db, u.tpoB, async (tx) => (await tx.query<{ r: Record<string, unknown> }>(
      "SELECT public.b2b_student_activity_summary($1) AS r", [id.org])).rows[0].r)).toEqual({});
  });

  it("a student reads only their own activity; nobody writes it from the client", async () => {
    const own = await asUser(db, u.asha, async (tx) => (await tx.query<{ student_id: string }>("SELECT DISTINCT student_id FROM student_activity")).rows);
    expect(own).toEqual([{ student_id: id.asha }]);
    expect(await asUser(db, u.bala, async (tx) => (await tx.query("SELECT 1 FROM student_activity WHERE student_id = $1", [id.asha])).rows)).toEqual([]);
    expect(await asUser(db, u.tpoB, async (tx) => (await tx.query("SELECT 1 FROM student_activity WHERE org_id = $1", [id.org])).rows)).toEqual([]);
    for (const who of [u.asha, u.tpo]) {
      await asUser(db, who, async (tx) => {
        expect(await expectRejected(tx, "INSERT INTO student_activity (org_id, student_id, kind) VALUES ($1, $2, 'completed')", [id.org, id.asha]))
          .toMatch(/row-level security|permission denied/);
      });
    }
  });

  it("a TPO can't deactivate an activated student to free the seat", async () => {
    await asUser(db, u.tpo, (tx) => tx.query("UPDATE students SET status = 'deactivated' WHERE id = $1", [id.asha]), { commit: true });
    expect((await one<{ n: number }>("SELECT public.b2b_seats_used($1) AS n", [id.org])).n).toBe(2);
  });
});
