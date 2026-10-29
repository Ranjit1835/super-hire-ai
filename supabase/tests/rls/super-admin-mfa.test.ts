// @vitest-environment node
// R3.5 (migration 0022): super-admin powers need an MFA-verified login (aal2); admin role changes, AI pricing and
// interview modules are audited with before/after.
import { describe, it, expect, beforeAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb, createUser, asUser, asService } from "../helpers/pgdb";

let db: PGlite;
const u: Record<string, string> = {};
let org = "";

/** Run as a signed-in user whose JWT carries the given aal (PostgREST sets request.jwt.claims). */
const withAal = <T,>(user: string, aal: "aal1" | "aal2", sql: string, params: unknown[] = []) =>
  asUser(db, user, async (tx) => {
    await tx.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: user, aal, role: "authenticated" })]);
    return (await tx.query<T>(sql, params)).rows;
  });

beforeAll(async () => {
  db = await createTestDb();
  u.super = await createUser(db, { superAdmin: true });
  u.tpo = await createUser(db);
  org = (await db.query<{ id: string }>("INSERT INTO organizations (name, slug, type) VALUES ('MFA College', 'mfa-college', 'college') RETURNING id")).rows[0].id;
  await db.query("INSERT INTO org_memberships (org_id, user_id, role) VALUES ($1, $2, 'org_admin')", [org, u.tpo]);
});

describe("super admin MFA (R3.5)", () => {
  it("is_super_admin() is false at aal1 and true at aal2; the admin-role probe grants nothing", async () => {
    expect((await withAal<{ s: boolean }>(u.super, "aal1", "SELECT public.is_super_admin() AS s"))[0].s).toBe(false);
    expect((await withAal<{ s: boolean }>(u.super, "aal2", "SELECT public.is_super_admin() AS s"))[0].s).toBe(true);
    expect((await withAal<{ a: boolean }>(u.super, "aal1", "SELECT public.b2b_is_admin_role() AS a"))[0].a).toBe(true);
    expect((await withAal<{ a: boolean }>(u.tpo, "aal2", "SELECT public.b2b_is_admin_role() AS a"))[0].a).toBe(false);
  });

  it("without MFA a super admin sees no other org's data; with MFA they do", async () => {
    expect(await withAal(u.super, "aal1", "SELECT id FROM organizations WHERE id = $1", [org])).toEqual([]);
    expect(await withAal(u.super, "aal2", "SELECT id FROM organizations WHERE id = $1", [org])).toEqual([{ id: org }]);
    // An org admin's own access doesn't depend on MFA.
    expect(await withAal(u.tpo, "aal1", "SELECT id FROM organizations WHERE id = $1", [org])).toEqual([{ id: org }]);
  });

  it("the edge gate refuses super admins without MFA and passes everyone else", async () => {
    const gate = (user: string, aal: string) => asService(db, async (tx) =>
      (await tx.query<{ r: { ok: boolean; reason?: string } }>("SELECT public.b2b_request_gate($1, 'sess', $2) AS r", [user, aal])).rows[0].r);
    expect(await gate(u.super, "aal1")).toMatchObject({ ok: false, reason: "MFA_REQUIRED" });
    expect(await gate(u.super, "")).toMatchObject({ ok: false, reason: "MFA_REQUIRED" });
    expect(await gate(u.super, "aal2")).toMatchObject({ ok: true });
    expect(await gate(u.tpo, "aal1")).toMatchObject({ ok: true, student: false });
  });
});

describe("admin audit additions (R3.5)", () => {
  it("granting or removing the admin role, AI rates and interview modules are audited with before/after", async () => {
    const newAdmin = await createUser(db);
    await db.query("INSERT INTO user_roles (user_id, role) VALUES ($1, 'admin')", [newAdmin]);
    await db.query("DELETE FROM user_roles WHERE user_id = $1", [newAdmin]);
    const roleRows = (await db.query<{ action: string }>("SELECT action FROM audit_logs WHERE target_type = 'user_roles' ORDER BY id")).rows.map((r) => r.action);
    expect(roleRows).toEqual(expect.arrayContaining(["user_roles.insert", "user_roles.delete"]));

    const price = (await db.query<{ id: string }>("SELECT id FROM b2b_pricing LIMIT 1")).rows[0];
    if (price) {
      await db.query("UPDATE b2b_pricing SET unit_inr = unit_inr + 1 WHERE id = $1", [price.id]);
      const a = (await db.query<{ meta: { changed: Record<string, { from: unknown; to: unknown }> } }>(
        "SELECT meta FROM audit_logs WHERE action = 'b2b_pricing.update' ORDER BY id DESC LIMIT 1")).rows[0];
      expect(Object.keys(a.meta.changed)).toContain("unit_inr");
    }

    await db.query(`INSERT INTO interview_modules (org_id, spec) VALUES ($1, '{"name":"DBMS","type":"skill","topics":["Joins"],"pass_threshold":6,"max_turns":5,"max_minutes":10}')`, [org]);
    expect((await db.query("SELECT 1 FROM audit_logs WHERE action = 'interview_modules.insert' AND org_id = $1", [org])).rows).toHaveLength(1);
  });
});
