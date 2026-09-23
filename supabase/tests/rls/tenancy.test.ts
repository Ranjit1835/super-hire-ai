// @vitest-environment node
// Proves org isolation is enforced by the database (RLS), not by app code.
// Every query below runs as the `authenticated`/`anon` role with a JWT subject,
// which is exactly what a direct PostgREST call (supabase-js with anon key + a
// user's access token) does.
import { describe, it, expect, beforeAll } from "vitest";
import type { PGlite, Transaction } from "@electric-sql/pglite";
import { createTestDb, createUser, asUser, expectRejected, affected } from "../helpers/pgdb";

let db: PGlite;
const u: Record<string, string> = {};
const org = { a: "", b: "" };
const batch = { a1: "", a2: "", b1: "" };

async function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> {
  return (await db.query<T>(sql, params)).rows[0];
}

beforeAll(async () => {
  db = await createTestDb();

  u.super = await createUser(db, { superAdmin: true });
  for (const k of ["adminA", "trainerA", "studentA1", "studentA2", "adminB", "studentB", "b2c"]) {
    u[k] = await createUser(db);
  }

  // Seed as the table owner (like the service role), bypassing RLS.
  org.a = (await one<{ id: string }>(
    "INSERT INTO organizations (name, slug, type) VALUES ('College A', 'college-a', 'college') RETURNING id")).id;
  org.b = (await one<{ id: string }>(
    "INSERT INTO organizations (name, slug, type) VALUES ('Institute B', 'institute-b', 'coaching_institute') RETURNING id")).id;

  const mkBatch = async (orgId: string, name: string) =>
    (await one<{ id: string }>("INSERT INTO batches (org_id, name, department) VALUES ($1, $2, 'CSE') RETURNING id", [orgId, name])).id;
  batch.a1 = await mkBatch(org.a, "CSE 2026 A");
  batch.a2 = await mkBatch(org.a, "CSE 2026 B");
  batch.b1 = await mkBatch(org.b, "Java Weekend");

  const member = (orgId: string, userId: string, role: string, batchId: string | null, roll: string | null) =>
    db.query(
      "INSERT INTO org_memberships (org_id, user_id, role, batch_id, full_name, roll_no) VALUES ($1, $2, $3, $4, $5, $6)",
      [orgId, userId, role, batchId, `User ${roll ?? role}`, roll],
    );
  await member(org.a, u.adminA, "org_admin", null, null);
  await member(org.a, u.trainerA, "trainer", null, null);
  await member(org.a, u.studentA1, "student", batch.a1, "A001");
  await member(org.a, u.studentA2, "student", batch.a2, "A002");
  await member(org.b, u.adminB, "org_admin", null, null);
  await member(org.b, u.studentB, "student", batch.b1, "B001");
});

const count = async (tx: Transaction, sql: string, params: unknown[] = []) => (await tx.query(sql, params)).rows.length;

describe("anonymous and B2C users", () => {
  it("anon sees no B2B rows and cannot call helper functions", async () => {
    await asUser(db, null, async (tx) => {
      expect(await count(tx, "SELECT * FROM organizations")).toBe(0);
      expect(await count(tx, "SELECT * FROM batches")).toBe(0);
      expect(await count(tx, "SELECT * FROM org_memberships")).toBe(0);
      expect(await expectRejected(tx, "SELECT public.is_org_member($1)", [org.a])).toMatch(/permission denied/);
    });
  });

  it("a B2C user with no org sees nothing and cannot create an org or join one", async () => {
    await asUser(db, u.b2c, async (tx) => {
      expect(await count(tx, "SELECT * FROM organizations")).toBe(0);
      expect(await count(tx, "SELECT * FROM org_memberships")).toBe(0);
      await expectRejected(tx, "INSERT INTO organizations (name, slug, type) VALUES ('Mine', 'mine-org', 'college')");
      await expectRejected(tx,
        "INSERT INTO org_memberships (org_id, user_id, role) VALUES ($1, $2, 'org_admin')", [org.a, u.b2c]);
    });
  });
});

describe("students", () => {
  it("see only their own org, own batch, and own membership", async () => {
    await asUser(db, u.studentA1, async (tx) => {
      const orgs = (await tx.query<{ id: string }>("SELECT id FROM organizations")).rows.map((r) => r.id);
      expect(orgs).toEqual([org.a]);
      const batches = (await tx.query<{ id: string }>("SELECT id FROM batches")).rows.map((r) => r.id);
      expect(batches).toEqual([batch.a1]);
      const members = (await tx.query<{ user_id: string }>("SELECT user_id FROM org_memberships")).rows;
      expect(members.map((m) => m.user_id)).toEqual([u.studentA1]);
    });
  });

  it("cannot read another org by id", async () => {
    await asUser(db, u.studentA1, async (tx) => {
      expect(await count(tx, "SELECT * FROM organizations WHERE id = $1", [org.b])).toBe(0);
      expect(await count(tx, "SELECT * FROM org_memberships WHERE org_id = $1", [org.b])).toBe(0);
    });
  });

  it("cannot promote themselves or change their batch", async () => {
    await asUser(db, u.studentA1, async (tx) => {
      expect(await affected(tx, "UPDATE org_memberships SET role = 'org_admin' WHERE user_id = $1", [u.studentA1])).toBe(0);
      expect(await affected(tx, "UPDATE org_memberships SET batch_id = $1 WHERE user_id = $2", [batch.a2, u.studentA1])).toBe(0);
    });
    expect((await one<{ role: string }>("SELECT role FROM org_memberships WHERE user_id = $1", [u.studentA1])).role).toBe("student");
  });

  it("helper functions reveal nothing about other orgs", async () => {
    await asUser(db, u.studentA1, async (tx) => {
      const r = await tx.query<{ role: string | null; member: boolean }>(
        "SELECT public.org_role_of($1) AS role, public.is_org_member($1) AS member", [org.b]);
      expect(r.rows[0]).toEqual({ role: null, member: false });
    });
  });
});

describe("trainers", () => {
  it("read their org's roster but cannot modify it", async () => {
    await asUser(db, u.trainerA, async (tx) => {
      expect(await count(tx, "SELECT * FROM org_memberships")).toBe(4);
      expect(await count(tx, "SELECT * FROM batches")).toBe(2);
      expect(await affected(tx, "UPDATE org_memberships SET batch_id = $1 WHERE user_id = $2", [batch.a2, u.studentA1])).toBe(0);
      await expectRejected(tx, "INSERT INTO batches (org_id, name) VALUES ($1, 'Trainer batch')", [org.a]);
    });
  });
});

describe("org admin of A vs org B data", () => {
  it("reads all of org A and none of org B", async () => {
    await asUser(db, u.adminA, async (tx) => {
      expect(await count(tx, "SELECT * FROM org_memberships")).toBe(4);
      expect(await count(tx, "SELECT * FROM org_memberships WHERE org_id = $1", [org.b])).toBe(0);
      expect(await count(tx, "SELECT * FROM batches WHERE org_id = $1", [org.b])).toBe(0);
      expect(await count(tx, "SELECT * FROM organizations WHERE id = $1", [org.b])).toBe(0);
    });
  });

  it("cannot write org B rows", async () => {
    await asUser(db, u.adminA, async (tx) => {
      await expectRejected(tx, "INSERT INTO batches (org_id, name) VALUES ($1, 'Injected')", [org.b]);
      expect(await affected(tx, "UPDATE batches SET name = 'pwned' WHERE org_id = $1", [org.b])).toBe(0);
      expect(await affected(tx, "DELETE FROM batches WHERE org_id = $1", [org.b])).toBe(0);
      expect(await affected(tx, "UPDATE org_memberships SET role = 'student' WHERE org_id = $1", [org.b])).toBe(0);
      expect(await affected(tx, "DELETE FROM org_memberships WHERE org_id = $1", [org.b])).toBe(0);
      expect(await affected(tx, "UPDATE organizations SET name = 'pwned' WHERE id = $1", [org.b])).toBe(0);
      expect(await affected(tx, "DELETE FROM organizations WHERE id = $1", [org.b])).toBe(0);
    });
    expect((await one<{ n: number }>("SELECT count(*)::int AS n FROM batches WHERE org_id = $1", [org.b])).n).toBe(1);
    expect((await one<{ name: string }>("SELECT name FROM organizations WHERE id = $1", [org.b])).name).toBe("Institute B");
  });

  it("cannot move a member into org B, re-point a membership, or use org B's batch", async () => {
    await asUser(db, u.adminA, async (tx) => {
      expect(await expectRejected(tx, "UPDATE org_memberships SET org_id = $1 WHERE user_id = $2", [org.b, u.studentA1]))
        .toMatch(/immutable|row-level security/);
      expect(await expectRejected(tx, "UPDATE org_memberships SET user_id = $1 WHERE user_id = $2", [u.b2c, u.studentA1]))
        .toMatch(/immutable/);
      expect(await expectRejected(tx, "UPDATE org_memberships SET batch_id = $1 WHERE user_id = $2", [batch.b1, u.studentA1]))
        .toMatch(/foreign key/);
    });
  });

  it("cannot attach arbitrary users to their own org (invites only)", async () => {
    await asUser(db, u.adminA, async (tx) => {
      await expectRejected(tx,
        "INSERT INTO org_memberships (org_id, user_id, role) VALUES ($1, $2, 'student')", [org.a, u.b2c]);
    });
  });

  it("can manage their own org's batches and members", async () => {
    await asUser(db, u.adminA, async (tx) => {
      await tx.query("INSERT INTO batches (org_id, name) VALUES ($1, 'ECE 2026')", [org.a]);
      expect(await affected(tx, "UPDATE org_memberships SET batch_id = $1 WHERE user_id = $2", [batch.a2, u.studentA1])).toBe(1);
      expect(await affected(tx, "DELETE FROM org_memberships WHERE user_id = $1", [u.studentA2])).toBe(1);
    });
  });

  it("cannot change org-level settings (super-admin only)", async () => {
    await asUser(db, u.adminA, async (tx) => {
      expect(await affected(tx, "UPDATE organizations SET is_demo = true WHERE id = $1", [org.a])).toBe(0);
    });
  });
});

describe("super-admin", () => {
  it("can create orgs and add members to any org", async () => {
    await asUser(db, u.super, async (tx) => {
      expect(await count(tx, "SELECT * FROM organizations")).toBe(2);
      const r = await tx.query<{ id: string }>(
        "INSERT INTO organizations (name, slug, type, created_by) VALUES ('New College', 'new-college', 'college', $1) RETURNING id",
        [u.super]);
      await tx.query("INSERT INTO org_memberships (org_id, user_id, role) VALUES ($1, $2, 'org_admin')", [r.rows[0].id, u.b2c]);
      expect(await affected(tx, "UPDATE organizations SET name = 'Institute B2' WHERE id = $1", [org.b])).toBe(1);
    });
  });
});

describe("schema constraints", () => {
  it("rejects bad slugs and duplicate roll numbers within an org", async () => {
    await expect(db.query("INSERT INTO organizations (name, slug, type) VALUES ('X Y', 'Bad Slug!', 'college')")).rejects.toThrow();
    const extra = await createUser(db);
    await expect(db.query(
      "INSERT INTO org_memberships (org_id, user_id, role, roll_no) VALUES ($1, $2, 'student', 'A001')", [org.a, extra],
    )).rejects.toThrow(/duplicate/);
    // Same roll number in a different org is fine.
    await db.query("INSERT INTO org_memberships (org_id, user_id, role, roll_no) VALUES ($1, $2, 'student', 'A001')", [org.b, extra]);
  });
});
