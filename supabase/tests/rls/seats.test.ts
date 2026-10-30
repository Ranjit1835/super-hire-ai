// @vitest-environment node
// R1.3 seat cap on every path and R1.4 no seat recycling (migration 0018) on embedded Postgres.
import { describe, it, expect, beforeAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb, createUser, asUser, asService, expectRejected, affected } from "../helpers/pgdb";

let db: PGlite;
const u: Record<string, string> = {};
let org = "";
let other = "";
const one = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0];
const addAs = (user: string, roll: string, orgId = org) => asUser(db, user, (tx) =>
  tx.query("INSERT INTO students (org_id, roll_no, full_name, email) VALUES ($1, $2, $2, $3)", [orgId, roll, `${roll.toLowerCase()}@x.in`]), { commit: true });
const seats = async (orgId = org) => (await one<{ n: number }>("SELECT public.b2b_seats_used($1) AS n", [orgId])).n;
const row = (roll: string) => one<{ id: string; status: string; seat_locked_at: string | null }>("SELECT id, status, seat_locked_at FROM students WHERE roll_no = $1 AND org_id = $2", [roll, org]);

beforeAll(async () => {
  db = await createTestDb();
  u.super = await createUser(db, { superAdmin: true });
  u.tpo = await createUser(db);
  u.tpoOther = await createUser(db);
  org = (await one<{ id: string }>("INSERT INTO organizations (name, slug, type, seat_limit) VALUES ('Seat College', 'seat-college', 'college', 3) RETURNING id")).id;
  other = (await one<{ id: string }>("INSERT INTO organizations (name, slug, type, seat_limit) VALUES ('Other College', 'other-college', 'college', 1) RETURNING id")).id;
  await db.query("INSERT INTO org_memberships (org_id, user_id, role) VALUES ($1, $2, 'org_admin'), ($3, $4, 'org_admin')", [org, u.tpo, other, u.tpoOther]);
});

describe("seat cap (R1.3)", () => {
  it("a single add past the cap is refused, like an import", async () => {
    for (const r of ["S1", "S2", "S3"]) await addAs(u.tpo, r);
    expect(await seats()).toBe(3);
    await expect(addAs(u.tpo, "S4")).rejects.toThrow(/SEAT_LIMIT/);
    expect(await seats()).toBe(3);
  });

  it("the import counts the same seats and reports over-cap rows instead of failing", async () => {
    const r = await asService(db, async (tx) => (await tx.query<{ r: Record<string, unknown> }>(
      "SELECT public.b2b_import_students($1, $2, $3, 'skip', true) AS r",
      [u.tpo, org, JSON.stringify([{ row: 2, roll_no: "S9", full_name: "Nine", email: "s9@x.in" }])])).rows[0].r);
    expect(JSON.stringify(r)).toMatch(/Seat limit reached/);
    expect(await seats()).toBe(3);
  });

  it("reactivating a deactivated student needs a free seat", async () => {
    await asUser(db, u.tpo, (tx) => tx.query("UPDATE students SET status = 'deactivated' WHERE roll_no = 'S3' AND org_id = $1", [org]), { commit: true });
    expect(await seats()).toBe(2);            // never used: the seat is free again
    await addAs(u.tpo, "S5");
    await expect(asUser(db, u.tpo, (tx) => tx.query("UPDATE students SET status = 'imported' WHERE roll_no = 'S3' AND org_id = $1", [org]), { commit: true }))
      .rejects.toThrow(/SEAT_LIMIT/);
  });
});

describe("no seat recycling (R1.4)", () => {
  it("a used seat stays taken after deactivation; TPOs can't free or delete it; super admins can free it", async () => {
    // First counted session stamps the seat (R1.5 does this through the session ledger).
    await asService(db, (tx) => tx.query("UPDATE students SET seat_locked_at = now() WHERE roll_no = 'S1' AND org_id = $1", [org]));
    await asUser(db, u.tpo, (tx) => tx.query("UPDATE students SET status = 'deactivated' WHERE roll_no = 'S1' AND org_id = $1", [org]), { commit: true });
    expect(await seats()).toBe(3);            // S1 still holds its seat
    await expect(addAs(u.tpo, "S6")).rejects.toThrow(/SEAT_LIMIT/);

    const s1 = (await row("S1")).id;   // read outside the transactions below (PGlite has one connection)
    await asUser(db, u.tpo, async (tx) => {
      expect(await expectRejected(tx, "UPDATE students SET seat_locked_at = NULL WHERE roll_no = 'S1' AND org_id = $1", [org])).toMatch(/SEAT_LOCKED/);
      expect(await expectRejected(tx, "DELETE FROM students WHERE roll_no = 'S1' AND org_id = $1", [org])).toMatch(/SEAT_LOCKED/);
      expect(await expectRejected(tx, "SELECT public.super_free_seat($1)", [s1])).toMatch(/FORBIDDEN/);
    });

    const freed = await asUser(db, u.super, async (tx) =>
      (await tx.query<{ r: { ok: boolean } }>("SELECT public.super_free_seat($1) AS r", [s1])).rows[0].r, { commit: true });
    expect(freed).toMatchObject({ ok: true });
    expect(await seats()).toBe(2);
    await addAs(u.tpo, "S6");
  });

  it("a never-used student can still be deleted by the TPO", async () => {
    expect(await asUser(db, u.tpo, (tx) => affected(tx, "DELETE FROM students WHERE roll_no = 'S6' AND org_id = $1", [org]), { commit: true })).toBe(1);
  });
});

describe("seat helper isolation", () => {
  it("another org's staff can't probe this org's seats", async () => {
    await asUser(db, u.tpoOther, async (tx) => {
      expect(await expectRejected(tx, "SELECT public.b2b_take_seat_check($1)", [org])).toMatch(/FORBIDDEN/);
      expect(await expectRejected(tx, "SELECT public.b2b_seats_used($1)", [org])).toMatch(/permission denied/);
    });
  });
});
