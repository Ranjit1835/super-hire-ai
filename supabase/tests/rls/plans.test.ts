// @vitest-environment node
// Plans & entitlements: caps enforced in the database, not the client.
import { describe, it, expect, beforeAll } from "vitest";
import type { PGlite, Transaction } from "@electric-sql/pglite";
import { createTestDb, createUser, asUser, asService, expectRejected } from "../helpers/pgdb";

let db: PGlite;
const u: Record<string, string> = {};
const org = { a: "", b: "", tiny: "" };

type Credit = { ok: boolean; reason?: string; used?: number; limit?: number; remaining?: number };

async function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> {
  return (await db.query<T>(sql, params)).rows[0];
}

const consume = (orgId: string, userId: string) =>
  asService(db, async (tx) =>
    (await tx.query<{ r: Credit }>("SELECT public.consume_interview_credit($1, $2) AS r", [orgId, userId])).rows[0].r);

beforeAll(async () => {
  db = await createTestDb();
  u.super = await createUser(db, { superAdmin: true });
  for (const k of ["adminA", "studentA", "studentA2", "trainerA", "studentB", "adminB", "b2c"]) u[k] = await createUser(db);

  const mkOrg = async (slug: string, plan: string) =>
    (await one<{ id: string }>("INSERT INTO organizations (name, slug, type, plan_id) VALUES ($1, $1, 'college', $2) RETURNING id", [slug, plan])).id;
  org.a = await mkOrg("college-a", "pilot");
  org.b = await mkOrg("college-b", "basic");

  const add = (o: string, user: string, role: string) =>
    db.query("INSERT INTO org_memberships (org_id, user_id, role) VALUES ($1, $2, $3)", [o, user, role]);
  await add(org.a, u.adminA, "org_admin");
  await add(org.a, u.trainerA, "trainer");
  await add(org.a, u.studentA, "student");
  await add(org.a, u.studentA2, "student");
  await add(org.b, u.adminB, "org_admin");
  await add(org.b, u.studentB, "student");
});

describe("seeded plans", () => {
  it("match the pilot / basic / pro spec", async () => {
    const rows = (await db.query("SELECT id, interviews_per_student, company_packs_enabled, dashboard_enabled, max_students FROM plans ORDER BY id")).rows;
    expect(rows).toEqual([
      { id: "basic", interviews_per_student: 4, company_packs_enabled: false, dashboard_enabled: false, max_students: null },
      { id: "pilot", interviews_per_student: 6, company_packs_enabled: true, dashboard_enabled: true, max_students: 150 },
      { id: "pro", interviews_per_student: 10, company_packs_enabled: true, dashboard_enabled: true, max_students: null },
    ]);
  });
});

describe("interview credits", () => {
  it("allows exactly the plan's interviews per student, then refuses", async () => {
    const results: Credit[] = [];
    for (let i = 0; i < 7; i++) results.push(await consume(org.a, u.studentA));
    expect(results.slice(0, 6).map((r) => r.remaining)).toEqual([5, 4, 3, 2, 1, 0]);
    expect(results[6]).toMatchObject({ ok: false, reason: "LIMIT_REACHED", remaining: 0 });
    expect((await one<{ n: number }>("SELECT interviews_used AS n FROM org_student_usage WHERE user_id = $1", [u.studentA])).n).toBe(6);
  });

  it("counts per student and per org", async () => {
    expect(await consume(org.a, u.studentA2)).toMatchObject({ ok: true, used: 1, remaining: 5 });
    expect(await consume(org.b, u.studentB)).toMatchObject({ ok: true, used: 1, limit: 4, remaining: 3 });
  });

  it("refuses non-students, users of other orgs, and expired plans", async () => {
    expect(await consume(org.a, u.adminA)).toMatchObject({ ok: false, reason: "NOT_A_STUDENT" });
    expect(await consume(org.a, u.studentB)).toMatchObject({ ok: false, reason: "NOT_A_STUDENT" });
    expect(await consume(org.a, u.b2c)).toMatchObject({ ok: false, reason: "NOT_A_STUDENT" });
    await db.query("UPDATE organizations SET plan_starts_at = now() - interval '7 weeks', plan_ends_at = now() - interval '1 day' WHERE id = $1", [org.b]);
    expect(await consume(org.b, u.studentB)).toMatchObject({ ok: false, reason: "PLAN_EXPIRED" });
    await db.query("UPDATE organizations SET plan_ends_at = NULL WHERE id = $1", [org.b]);
  });

  it("refund gives one credit back and never goes negative", async () => {
    await asService(db, (tx) => tx.query("SELECT public.refund_interview_credit($1, $2)", [org.a, u.studentA]));
    expect(await consume(org.a, u.studentA)).toMatchObject({ ok: true, remaining: 0 });
    const fresh = await createUser(db);
    await db.query("INSERT INTO org_memberships (org_id, user_id, role) VALUES ($1, $2, 'student')", [org.a, fresh]);
    await asService(db, (tx) => tx.query("SELECT public.refund_interview_credit($1, $2)", [org.a, fresh]));
    expect(await consume(org.a, fresh)).toMatchObject({ ok: true, used: 1 });
  });

  it("students, admins and anon cannot consume, refund, or edit usage directly", async () => {
    for (const who of [u.studentA2, u.adminA, u.super, null]) {
      await asUser(db, who, async (tx: Transaction) => {
        expect(await expectRejected(tx, "SELECT public.consume_interview_credit($1, $2)", [org.a, u.studentA2])).toMatch(/permission denied/);
        expect(await expectRejected(tx, "SELECT public.refund_interview_credit($1, $2)", [org.a, u.studentA])).toMatch(/permission denied/);
        const upd = await tx.query("UPDATE org_student_usage SET interviews_used = 0 WHERE org_id = $1", [org.a]);
        expect(upd.affectedRows ?? 0).toBe(0);
        await expectRejected(tx, "INSERT INTO org_student_usage (org_id, user_id, interviews_used) VALUES ($1, $2, 0)", [org.a, u.b2c]);
      });
    }
  });
});

describe("usage visibility", () => {
  it("students see their own remaining interviews only", async () => {
    await asUser(db, u.studentA2, async (tx) => {
      const q = (await tx.query("SELECT org_id, interviews_used, interviews_limit, interviews_remaining FROM public.my_interview_quota()")).rows;
      expect(q).toEqual([{ org_id: org.a, interviews_used: 1, interviews_limit: 6, interviews_remaining: 5 }]);
      const usage = (await tx.query<{ user_id: string }>("SELECT user_id FROM org_student_usage")).rows;
      expect(usage.map((r) => r.user_id)).toEqual([u.studentA2]);
    });
  });

  it("a B2C user has no quota rows", async () => {
    await asUser(db, u.b2c, async (tx) => {
      expect((await tx.query("SELECT * FROM public.my_interview_quota()")).rows).toEqual([]);
    });
  });

  it("staff see org usage summary; other orgs are forbidden", async () => {
    for (const who of [u.adminA, u.trainerA]) {
      await asUser(db, who, async (tx) => {
        const s = (await tx.query<{ s: Record<string, unknown> }>("SELECT public.org_usage_summary($1) AS s", [org.a])).rows[0].s;
        expect(s).toMatchObject({ students: 3, students_exhausted: 1, plan: { id: "pilot", max_students: 150 } });
        expect(await expectRejected(tx, "SELECT public.org_usage_summary($1)", [org.b])).toMatch(/FORBIDDEN/);
      });
    }
    await asUser(db, u.studentA, async (tx) => {
      expect(await expectRejected(tx, "SELECT public.org_usage_summary($1)", [org.a])).toMatch(/FORBIDDEN/);
    });
  });

  it("plans are visible to staff of an org on that plan, not to students or B2C users", async () => {
    await asUser(db, u.adminA, async (tx) => {
      expect((await tx.query<{ id: string }>("SELECT id FROM plans")).rows.map((r) => r.id)).toEqual(["pilot"]);
    });
    for (const who of [u.studentA, u.b2c]) {
      await asUser(db, who, async (tx) => expect((await tx.query("SELECT id FROM plans")).rows).toEqual([]));
    }
  });

  it("only super-admin can change plans or reassign an org's plan", async () => {
    await asUser(db, u.adminA, async (tx) => {
      expect((await tx.query("UPDATE plans SET interviews_per_student = 99")).affectedRows ?? 0).toBe(0);
      expect((await tx.query("UPDATE organizations SET plan_id = 'pro' WHERE id = $1", [org.a])).affectedRows ?? 0).toBe(0);
    });
    await asUser(db, u.super, async (tx) => {
      expect((await tx.query("UPDATE organizations SET plan_id = 'pro' WHERE id = $1", [org.a])).affectedRows).toBe(1);
    });
  });
});

describe("max students", () => {
  it("refuses the student that would exceed the plan cap, but still allows staff", async () => {
    await db.query("INSERT INTO plans (id, name, interviews_per_student, max_students) VALUES ('tiny', 'Tiny', 1, 2)");
    org.tiny = (await one<{ id: string }>("INSERT INTO organizations (name, slug, type, plan_id) VALUES ('Tiny', 'tiny-org', 'college', 'tiny') RETURNING id")).id;
    const [s1, s2, s3, staff] = [await createUser(db), await createUser(db), await createUser(db), await createUser(db)];
    const add = (user: string, role: string) =>
      db.query("INSERT INTO org_memberships (org_id, user_id, role) VALUES ($1, $2, $3)", [org.tiny, user, role]);
    await add(s1, "student");
    await add(s2, "student");
    await expect(add(s3, "student")).rejects.toThrow(/STUDENT_LIMIT_REACHED/);
    await add(staff, "trainer");
    // Promoting the trainer to student is also a new student.
    await expect(db.query("UPDATE org_memberships SET role = 'student' WHERE user_id = $1", [staff])).rejects.toThrow(/STUDENT_LIMIT_REACHED/);
  });
});

describe("super_add_org_member", () => {
  it("attaches an existing account by email, super-admin only", async () => {
    const tpo = await createUser(db);
    const email = `${tpo}@test.local`;
    await asUser(db, u.adminA, async (tx) => {
      expect(await expectRejected(tx, "SELECT public.super_add_org_member($1, $2, 'org_admin')", [org.a, email])).toMatch(/FORBIDDEN/);
    });
    await asUser(db, u.super, async (tx) => {
      expect(await expectRejected(tx, "SELECT public.super_add_org_member($1, 'nobody@x.in', 'org_admin')", [org.a])).toMatch(/USER_NOT_FOUND/);
      await tx.query("SELECT public.super_add_org_member($1, $2, 'org_admin', 'TPO')", [org.a, `  ${email.toUpperCase()} `]);
      const m = (await tx.query("SELECT role, full_name FROM org_memberships WHERE user_id = $1", [tpo])).rows[0];
      expect(m).toEqual({ role: "org_admin", full_name: "TPO" });
    });
  });
});
