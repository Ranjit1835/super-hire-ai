// @vitest-environment node
// Organisation deactivate / delete and drive delete-only-while-unused (20261109000001_b2b_org_lifecycle.sql).
import { describe, it, expect, beforeAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb, createUser, asUser, asService } from "../helpers/pgdb";

let db: PGlite;
const u: Record<string, string> = {};
let org = "";
let asmt = "";
const one = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0];
const id = async (sql: string, params: unknown[] = []) => (await one<{ id: string }>(sql, params)).id;
const call = <T = Record<string, unknown>>(sql: string, params: unknown[]) =>
  asService(db, async (tx) => (await tx.query<{ r: T }>(sql, params)).rows[0].r);
const tpoSees = (table: string) =>
  asUser(db, u.tpo, async (tx) => (await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table} WHERE org_id = $1`, [org])).rows[0].n);
const isMember = (user: string) =>
  asUser(db, user, async (tx) => (await tx.query<{ r: boolean }>("SELECT public.is_org_member($1) AS r", [org])).rows[0].r);

beforeAll(async () => {
  db = await createTestDb();
  u.super = await createUser(db, { superAdmin: true });
  u.tpo = await createUser(db);
  u.student = await createUser(db);
  u.late = await createUser(db);
  org = await id("INSERT INTO organizations (name, slug, type) VALUES ('Lifecycle College', 'lifecycle-college', 'college') RETURNING id");
  await db.query("INSERT INTO org_memberships (org_id, user_id, role) VALUES ($1, $2, 'org_admin'), ($1, $3, 'student')", [org, u.tpo, u.student]);
  await db.query("INSERT INTO students (org_id, user_id, roll_no, full_name, email, status) VALUES ($1, $2, 'L1', 'Asha', 'asha@x.in', 'active')", [org, u.student]);
  await db.query("INSERT INTO org_credit_ledger (org_id, delta, balance_after, reason) VALUES ($1, 100, 100, 'grant')", [org]);
  asmt = await id("INSERT INTO assessments (org_id, title, duration_min, status) VALUES ($1, 'Round 1', 30, 'ready') RETURNING id", [org]);
}, 120_000);

const access = (user: string) =>
  asUser(db, user, async (tx) => (await tx.query<{ r: { ok: boolean; reason?: string } }>("SELECT public.b2b_access_check() AS r")).rows[0].r);

describe("sign-in access check", () => {
  it("lets super admins, active staff and plain users in; refuses a student with no drive", async () => {
    const plain = await createUser(db);
    expect(await access(u.super)).toEqual({ ok: true });
    expect(await access(u.tpo)).toEqual({ ok: true });
    expect(await access(plain)).toEqual({ ok: true });
    expect(await access(u.student)).toEqual({ ok: false, reason: "NO_DRIVE" });
  });

  it("lets a student in once a drive is assigned, and not when the assignment is removed", async () => {
    const d = await id("INSERT INTO drives (org_id, name, assessment_id) VALUES ($1, 'Access drive', $2) RETURNING id", [org, asmt]);
    const s = await id("SELECT id FROM students WHERE roll_no = 'L1'");
    await db.query("INSERT INTO drive_assignments (drive_id, org_id, student_id) VALUES ($1, $2, $3)", [d, org, s]);
    expect(await access(u.student)).toEqual({ ok: true });
    await db.query("UPDATE drive_assignments SET status = 'removed' WHERE drive_id = $1", [d]);
    expect(await access(u.student)).toEqual({ ok: false, reason: "NO_DRIVE" });
    await db.query("UPDATE drive_assignments SET status = 'assigned' WHERE drive_id = $1", [d]);
    await db.query("UPDATE students SET status = 'deactivated' WHERE id = $1", [s]);
    expect(await access(u.student)).toEqual({ ok: false, reason: "NO_DRIVE" });
    await db.query("UPDATE students SET status = 'active' WHERE id = $1", [s]);
    expect(await access(u.student)).toEqual({ ok: true });
  });
});

describe("drive delete only while unused", () => {
  it("a TPO deletes a drive nobody has started", async () => {
    const d = await id("INSERT INTO drives (org_id, name, assessment_id) VALUES ($1, 'Unused drive', $2) RETURNING id", [org, asmt]);
    await asUser(db, u.tpo, (tx) => tx.query("DELETE FROM drives WHERE id = $1", [d]), { commit: true });
    expect(await one("SELECT 1 AS x FROM drives WHERE id = $1", [d])).toBeUndefined();
    expect(await one("SELECT action FROM audit_logs WHERE target_id = $1 AND action = 'drives.delete'", [d])).toEqual({ action: "drives.delete" });
  });

  it("once a student has an attempt, delete is refused and the drive can be closed instead", async () => {
    const d = await id("INSERT INTO drives (org_id, name, assessment_id, status) VALUES ($1, 'Started drive', $2, 'live') RETURNING id", [org, asmt]);
    const s = await id("SELECT id FROM students WHERE roll_no = 'L1'");
    await db.query(`INSERT INTO attempts (org_id, assessment_id, subject_user_id, student_id, context_type, context_id, status)
                    VALUES ($1, $2, $3, $4, 'drive', $5, 'submitted')`, [org, asmt, u.student, s, d]);
    expect((await one<{ s: boolean }>("SELECT public.b2b_drive_started($1) AS s", [d])).s).toBe(true);
    await expect(asUser(db, u.tpo, (tx) => tx.query("DELETE FROM drives WHERE id = $1", [d]), { commit: true })).rejects.toThrow(/DRIVE_STARTED/);
    await asUser(db, u.tpo, (tx) => tx.query("UPDATE drives SET status = 'closed' WHERE id = $1", [d]), { commit: true });
    expect(await one("SELECT status FROM drives WHERE id = $1", [d])).toEqual({ status: "closed" });
  });
});

describe("deactivate an organisation", () => {
  it("only a super admin can, and members lose access at once", async () => {
    expect(await tpoSees("students")).toBe(1);
    expect(await isMember(u.student)).toBe(true);
    expect(await call("SELECT public.b2b_set_org_active($1, $2, false) AS r", [u.tpo, org])).toEqual({ ok: false, reason: "FORBIDDEN" });

    expect(await call("SELECT public.b2b_set_org_active($1, $2, false) AS r", [u.super, org])).toEqual({ ok: true });
    expect(await tpoSees("students")).toBe(0);
    expect(await isMember(u.student)).toBe(false);
    expect(await asUser(db, u.tpo, async (tx) => (await tx.query<{ r: boolean }>("SELECT public.is_org_admin($1) AS r", [org])).rows[0].r)).toBe(false);
    expect(await call("SELECT public.actor_org_role($1, $2) AS r", [u.tpo, org])).toBeNull();
    expect(await access(u.tpo)).toEqual({ ok: false, reason: "ORG_DEACTIVATED" });
    expect(await access(u.student)).toEqual({ ok: false, reason: "ORG_DEACTIVATED" });
    // The super admin still sees everything.
    expect(await asUser(db, u.super, async (tx) => (await tx.query<{ n: number }>("SELECT count(*)::int AS n FROM students WHERE org_id = $1", [org])).rows[0].n)).toBe(1);
  });

  it("nobody can join a deactivated organisation", async () => {
    await expect(db.query("INSERT INTO org_memberships (org_id, user_id, role) VALUES ($1, $2, 'student')", [org, u.late])).rejects.toThrow(/ORG_DEACTIVATED/);
  });

  it("reactivating restores access with nothing lost", async () => {
    expect(await call("SELECT public.b2b_set_org_active($1, $2, true) AS r", [u.super, org])).toEqual({ ok: true });
    expect(await tpoSees("students")).toBe(1);
    expect(await isMember(u.student)).toBe(true);
    const log = await db.query<{ action: string }>("SELECT action FROM audit_logs WHERE org_id = $1 AND action LIKE 'org.%' ORDER BY id", [org]);
    expect(log.rows.map((r) => r.action)).toEqual(["org.deactivate", "org.reactivate"]);
  });
});

describe("delete an organisation permanently", () => {
  it("is refused while active, for a wrong name, and for non-super admins", async () => {
    expect(await call("SELECT public.b2b_delete_org($1, $2, 'Lifecycle College') AS r", [u.super, org])).toEqual({ ok: false, reason: "NOT_DEACTIVATED" });
    await call("SELECT public.b2b_set_org_active($1, $2, false) AS r", [u.super, org]);
    expect(await call("SELECT public.b2b_delete_org($1, $2, 'Lifecycle') AS r", [u.super, org])).toEqual({ ok: false, reason: "NAME_MISMATCH" });
    expect(await call("SELECT public.b2b_delete_org($1, $2, 'Lifecycle College') AS r", [u.tpo, org])).toEqual({ ok: false, reason: "FORBIDDEN" });
  });

  it("removes everything, including started drives, and keeps the credit ledger in the restricted store", async () => {
    expect(await call("SELECT public.b2b_delete_org($1, $2, ' Lifecycle College ') AS r", [u.super, org])).toEqual({ ok: true });
    for (const t of ["organizations", "students", "drives", "attempts", "org_memberships", "org_credit_ledger"]) {
      const col = t === "organizations" ? "id" : "org_id";
      expect((await one<{ n: number }>(`SELECT count(*)::int AS n FROM ${t} WHERE ${col} = $1`, [org])).n).toBe(0);
    }
    const kept = await one<{ name: string; n: number; years: number }>(
      "SELECT name, jsonb_array_length(credit_ledger) AS n, extract(year FROM age(delete_after, deleted_at))::int AS years FROM b2b_deleted_orgs WHERE org_id = $1", [org]);
    expect(kept).toEqual({ name: "Lifecycle College", n: 1, years: 8 });
    expect(await one("SELECT action FROM audit_logs WHERE org_id = $1 AND action = 'org.delete'", [org])).toEqual({ action: "org.delete" });
  });

  it("the restricted store and the lifecycle functions are closed to signed-in users", async () => {
    await expect(asUser(db, u.super, (tx) => tx.query("SELECT * FROM b2b_deleted_orgs"))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, u.super, (tx) => tx.query("SELECT public.b2b_delete_org($1, $2, 'x')", [u.super, org]))).rejects.toThrow(/permission denied/);
  });
});

describe("question digest for generation (20261110000003)", () => {
  it("lists the org's and global questions on a topic, only to editors", async () => {
    const o = await id("INSERT INTO organizations (name, slug, type) VALUES ('Digest College', 'digest-college', 'college') RETURNING id");
    const tpo = await createUser(db);
    const outsider = await createUser(db);
    await db.query("INSERT INTO org_memberships (org_id, user_id, role) VALUES ($1, $2, 'org_admin')", [o, tpo]);
    const q = (org: string | null, title: string, topics: string, status = "draft") => db.query(
      `INSERT INTO questions (org_id, type, title, statement, difficulty, topics, options, answer, status)
       VALUES ($1, 'mcq', $2, $3, 'easy', $4::text[], '[{"id":"a","text":"1"},{"id":"b","text":"2"}]', '["a"]', $5)`,
      [org, title, `${title}: what is the answer?`, topics, status]);
    await q(o, "Own speed", "{speed}");
    await q(null, "Global speed", "{speed}");
    await q(null, "Retired speed", "{speed}", "retired");
    await q(null, "Global ratio", "{ratio}");
    const digest = (actor: string, org: string | null) => call<{ title: string }[]>(
      "SELECT public.b2b_question_digest_as($1, $2, 'mcq', 'speed') AS r", [actor, org]);
    expect((await digest(tpo, o)).map((r) => r.title).sort()).toEqual(["Global speed", "Own speed"]);
    expect(await digest(outsider, o)).toEqual([]);
    expect(await digest(tpo, null)).toEqual([]);                       // the global bank is the super admin's
    expect((await digest(u.super, null)).map((r) => r.title)).toEqual(["Global speed"]);
  });
});
