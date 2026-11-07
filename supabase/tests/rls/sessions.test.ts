// @vitest-environment node
// R1.6 student sessions (migration 0021) on embedded Postgres: one active session per student, idle timeout,
// absolute expiry, logout, per-org settings; staff and B2C users untouched; no credits involved.
import { describe, it, expect, beforeAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb, createUser, asUser, asService, expectRejected } from "../helpers/pgdb";

let db: PGlite;
const u: Record<string, string> = {};
let org = "";
type R = { ok: boolean; student: boolean; started?: boolean; reason?: string };
const touch = (user: string, sid: string) =>
  asService(db, async (tx) => (await tx.query<{ r: R }>("SELECT public.b2b_session_touch($1, $2) AS r", [user, sid])).rows[0].r);
const heartbeatAs = (user: string, sid: string) => asUser(db, user, async (tx) => {
  await tx.query("SELECT set_config('request.jwt.claim.session_id', $1, true)", [sid]);
  return (await tx.query<{ r: R }>("SELECT public.b2b_session_heartbeat() AS r")).rows[0].r;
}, { commit: true });
const age = (user: string, sid: string, col: "started_at" | "last_seen_at", interval: string) =>
  db.query(`UPDATE b2b_sessions SET ${col} = now() - interval '${interval}' WHERE user_id = $1 AND auth_session_id = $2`, [user, sid]);

beforeAll(async () => {
  db = await createTestDb();
  for (const k of ["stu", "stu2", "tpo", "b2c"]) u[k] = await createUser(db);
  org = (await db.query<{ id: string }>("INSERT INTO organizations (name, slug, type) VALUES ('Sess College', 'sess-college', 'college') RETURNING id")).rows[0].id;
  await db.query("INSERT INTO org_memberships (org_id, user_id, role) VALUES ($1, $2, 'student'), ($1, $3, 'student'), ($1, $4, 'org_admin')", [org, u.stu, u.stu2, u.tpo]);
});

describe("student sessions (R1.6)", () => {
  it("staff and B2C users pass through and nothing is recorded", async () => {
    expect(await touch(u.tpo, "s-tpo")).toEqual({ ok: true, student: false });
    expect(await touch(u.b2c, "s-b2c")).toEqual({ ok: true, student: false });
    expect((await db.query("SELECT 1 FROM b2b_sessions WHERE user_id IN ($1, $2)", [u.tpo, u.b2c])).rows).toEqual([]);
  });

  it("a new login starts a session; refreshes, reloads and tabs (same session id) don't start another", async () => {
    expect(await touch(u.stu, "laptop")).toMatchObject({ ok: true, student: true, started: true });
    for (let i = 0; i < 3; i++) expect(await touch(u.stu, "laptop")).toMatchObject({ ok: true, started: false });
    expect((await db.query("SELECT 1 FROM b2b_sessions WHERE user_id = $1", [u.stu])).rows).toHaveLength(1);
  });

  it("a login on another device ends the first one", async () => {
    expect(await touch(u.stu, "phone")).toMatchObject({ ok: true, started: true });
    expect(await touch(u.stu, "laptop")).toMatchObject({ ok: false, reason: "REPLACED" });
    expect(await touch(u.stu, "phone")).toMatchObject({ ok: true });
    const open = await db.query("SELECT auth_session_id FROM b2b_sessions WHERE user_id = $1 AND ended_at IS NULL", [u.stu]);
    expect(open.rows).toEqual([{ auth_session_id: "phone" }]);
  });

  it("30 minutes idle ends the session; activity before that keeps it alive", async () => {
    await age(u.stu, "phone", "last_seen_at", "29 minutes");
    expect(await touch(u.stu, "phone")).toMatchObject({ ok: true });
    await age(u.stu, "phone", "last_seen_at", "31 minutes");
    expect(await touch(u.stu, "phone")).toMatchObject({ ok: false, reason: "IDLE" });
    expect(await touch(u.stu, "phone")).toMatchObject({ ok: false, reason: "IDLE" });   // stays ended
    expect(await touch(u.stu, "phone-2")).toMatchObject({ ok: true, started: true });   // signing in again works
  });

  it("8 hours after login the session expires even if active; orgs can change both limits", async () => {
    await age(u.stu, "phone-2", "started_at", "8 hours 1 minute");
    expect(await touch(u.stu, "phone-2")).toMatchObject({ ok: false, reason: "EXPIRED" });
    await db.query(`UPDATE organizations SET settings = settings || '{"session_idle_min": 5, "session_max_hours": 12}' WHERE id = $1`, [org]);
    expect(await touch(u.stu, "tab-x")).toMatchObject({ ok: true, started: true });
    await age(u.stu, "tab-x", "started_at", "9 hours");
    expect(await touch(u.stu, "tab-x")).toMatchObject({ ok: true });              // within 12 h
    await age(u.stu, "tab-x", "last_seen_at", "6 minutes");
    expect(await touch(u.stu, "tab-x")).toMatchObject({ ok: false, reason: "IDLE" });   // 5-minute idle
    await db.query(`UPDATE organizations SET settings = settings - 'session_idle_min' - 'session_max_hours' WHERE id = $1`, [org]);
  });

  it("the browser heartbeat uses the JWT's session id; logout ends it; clients can't call touch or write sessions", async () => {
    expect(await heartbeatAs(u.stu2, "desk")).toMatchObject({ ok: true, student: true, started: true });
    expect(await heartbeatAs(u.stu2, "desk")).toMatchObject({ ok: true, started: false });
    await asUser(db, u.stu2, async (tx) => {
      await tx.query("SELECT set_config('request.jwt.claim.session_id', 'desk', true)");
      await tx.query("SELECT public.b2b_session_end()");
    }, { commit: true });
    expect(await heartbeatAs(u.stu2, "desk")).toMatchObject({ ok: false, reason: "LOGOUT" });
    await asUser(db, u.stu2, async (tx) => {
      expect(await expectRejected(tx, "SELECT public.b2b_session_touch($1, 'forged')", [u.stu])).toMatch(/permission denied/);
      expect(await expectRejected(tx, "INSERT INTO b2b_sessions (user_id, auth_session_id) VALUES ($1, 'x')", [u.stu2])).toMatch(/row-level security|permission denied/);
      expect((await tx.query("SELECT DISTINCT user_id FROM b2b_sessions")).rows).toEqual([{ user_id: u.stu2 }]);
    });
    expect((await db.query<{ n: number }>("SELECT count(*)::int AS n FROM org_credit_ledger WHERE org_id = $1", [org])).rows[0].n).toBe(0);
  });
});
