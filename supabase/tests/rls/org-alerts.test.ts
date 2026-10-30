// @vitest-environment node
// R1.9 org alerts (migration 0025) on embedded Postgres.
import { describe, it, expect, beforeAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb, createUser, asUser, asService, expectRejected } from "../helpers/pgdb";

let db: PGlite;
const u: Record<string, string> = {};
type Alert = { org_name: string; kind: string; detail: Record<string, unknown> };
const org = async (name: string, extra: string, cols = "", vals = "") => (await db.query<{ id: string }>(
  `INSERT INTO organizations (name, slug, type${cols}) VALUES ($1, $2, 'college'${vals}) RETURNING id`, [name, name.toLowerCase().replace(/\s+/g, "-") + extra])).rows[0].id;

beforeAll(async () => {
  db = await createTestDb();
  u.super = await createUser(db, { superAdmin: true });
  u.tpo = await createUser(db);
  await org("Healthy", "-1", ", credits_balance, plan_ends_at", ", 500, now() + interval '200 days'");
  await org("Low Credits", "-2", ", credits_balance, plan_ends_at", ", 10, now() + interval '200 days'");
  await org("Custom Threshold", "-3", ", credits_balance, settings, plan_ends_at", `, 80, '{"low_credit_alert": 100}', now() + interval '200 days'`);
  await org("Expiring", "-4", ", credits_balance, plan_ends_at", ", 500, now() + interval '5 days'");
  await org("Expired", "-5", ", credits_balance, plan_starts_at, plan_ends_at", ", 500, now() - interval '400 days', now() - interval '1 day'");
  const full = await org("Full Seats", "-6", ", credits_balance, seat_limit, plan_ends_at", ", 500, 10, now() + interval '200 days'");
  for (let i = 0; i < 9; i++) await db.query("INSERT INTO students (org_id, roll_no, full_name, email) VALUES ($1, $2, $2, $3)", [full, `R${i}`, `r${i}@x.in`]);
  await org("Demo Low", "-7", ", credits_balance, is_demo", ", 0, true");
  const susp = await org("Suspended Low", "-8", ", credits_balance", ", 0");
  await db.query("UPDATE organizations SET status = 'suspended' WHERE id = $1", [susp]);
  const tpoOrg = await org("TPO Org", "-9", ", credits_balance, plan_ends_at", ", 500, now() + interval '200 days'");
  await db.query("INSERT INTO org_memberships (org_id, user_id, role) VALUES ($1, $2, 'org_admin')", [tpoOrg, u.tpo]);
});

describe("org alerts (R1.9)", () => {
  it("flags low credits (incl. per-org threshold), expiring and expired plans, and seats at 90%", async () => {
    const a = await asService(db, async (tx) => (await tx.query<{ r: Alert[] }>("SELECT public.b2b_org_alerts() AS r")).rows[0].r);
    const got = a.map((x) => `${x.org_name}:${x.kind}`).sort();
    expect(got).toEqual(["Custom Threshold:low_credits", "Expired:plan_expired", "Expiring:plan_expiring", "Full Seats:seats_full", "Low Credits:low_credits"]);
    expect(a[0].kind).toBe("plan_expired");                                     // most urgent first
    expect(a.find((x) => x.kind === "plan_expiring")!.detail.days_left).toBe(5);
    expect(a.find((x) => x.kind === "seats_full")!.detail).toMatchObject({ seats_used: 9, seat_limit: 10 });
  });

  it("super admins read them through super_org_alerts(); TPOs and the client can't", async () => {
    const sa = await asUser(db, u.super, async (tx) => (await tx.query<{ r: Alert[] }>("SELECT public.super_org_alerts() AS r")).rows[0].r);
    expect(sa.length).toBe(5);
    await asUser(db, u.tpo, async (tx) => {
      expect(await expectRejected(tx, "SELECT public.super_org_alerts()")).toMatch(/FORBIDDEN/);
      expect(await expectRejected(tx, "SELECT public.b2b_org_alerts()")).toMatch(/permission denied/);
    });
  });
});
