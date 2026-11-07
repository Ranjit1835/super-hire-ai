// @vitest-environment node
// R6.1 cost breakdown (migration 0027) on embedded Postgres.
import { describe, it, expect, beforeAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb, createUser, asUser, expectRejected } from "../helpers/pgdb";

let db: PGlite;
const u: Record<string, string> = {};
const o: Record<string, string> = {};
type Row = { key: string; label: string; org_name: string | null; calls: number; cost_inr: number; cached_input_tokens: number };
const breakdown = (by: string, org: string | null = null) => asUser(db, u.super, async (tx) => {
  await tx.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: u.super, aal: "aal2" })]);
  return (await tx.query<{ r: Row[] }>("SELECT public.super_cost_breakdown($1, now() - interval '30 days', now() + interval '1 minute', $2) AS r", [by, org])).rows[0].r;
});

beforeAll(async () => {
  db = await createTestDb();
  u.super = await createUser(db, { superAdmin: true });
  for (const k of ["asha", "bala", "tpo"]) u[k] = await createUser(db);
  const org = async (name: string, demo = false) => (await db.query<{ id: string }>(
    "INSERT INTO organizations (name, slug, type, is_demo) VALUES ($1, $2, 'college', $3) RETURNING id", [name, name.toLowerCase().replace(/\s/g, "-"), demo])).rows[0].id;
  o.a = await org("Alpha College"); o.b = await org("Beta College"); o.demo = await org("Demo College", true);
  await db.query("INSERT INTO org_memberships (org_id, user_id, role, full_name) VALUES ($1, $2, 'student', 'Asha'), ($1, $3, 'student', 'Bala'), ($1, $4, 'org_admin', 'TPO')",
    [o.a, u.asha, u.bala, u.tpo]);
  const log = (org: string, user: string | null, feature: string, cost: number, daysAgo = 0, cached = 0) => db.query(
    `INSERT INTO b2b_usage_log (org_id, user_id, kind, provider_key, feature, input_tokens, output_tokens, cached_input_tokens, cost_inr, created_at)
     VALUES ($1, $2, 'llm', 'gemini-2.5-flash', $3, 1000, 200, $6, $4, now() - make_interval(days => $5))`, [org, user, feature, cost, daysAgo, cached]);
  await log(o.a, u.asha, "interview.v1.turn", 2.5, 0, 400);
  await log(o.a, u.asha, "interview.v1.evaluate", 4);
  await log(o.a, u.bala, "interview.v1.turn", 1.5, 1);
  await log(o.b, null, "question.generate", 3, 2);
  await log(o.demo, null, "interview.v1.turn", 99);            // demo orgs are excluded
  await log(o.a, u.asha, "interview.v1.turn", 50, 45);         // outside the 30-day window
});

describe("AI cost breakdown (R6.1)", () => {
  it("by college: totals per org, demo orgs and older calls excluded, most expensive first", async () => {
    const r = await breakdown("org");
    expect(r.map((x) => [x.label, Number(x.cost_inr), Number(x.calls)])).toEqual([["Alpha College", 8, 3], ["Beta College", 3, 1]]);
  });

  it("by student: names with their college; calls without a user grouped separately", async () => {
    const r = await breakdown("student");
    expect(r.find((x) => x.label === "Asha")).toMatchObject({ org_name: "Alpha College" });
    expect(Number(r.find((x) => x.label === "Asha")!.cost_inr)).toBe(6.5);
    expect(Number(r.find((x) => x.label === "Asha")!.cached_input_tokens)).toBe(400);
    expect(r.find((x) => x.label === "System / no user")).toBeTruthy();
  });

  it("by feature and by day (IST), and narrowed to one college", async () => {
    const f = await breakdown("feature");
    expect(f.map((x) => x.label)).toEqual(["interview.v1.turn", "interview.v1.evaluate", "question.generate"]);
    const d = await breakdown("day");
    expect(d.length).toBe(3);
    expect(d[0].key > d[1].key).toBe(true);                    // newest day first
    const onlyB = await breakdown("feature", o.b);
    expect(onlyB.map((x) => x.label)).toEqual(["question.generate"]);
  });

  it("super admins with MFA only; bad groups refused", async () => {
    await asUser(db, u.tpo, async (tx) => {
      expect(await expectRejected(tx, "SELECT public.super_cost_breakdown('org')")).toMatch(/FORBIDDEN/);
    });
    await asUser(db, u.super, async (tx) => {
      await tx.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: u.super, aal: "aal1" })]);
      expect(await expectRejected(tx, "SELECT public.super_cost_breakdown('org')")).toMatch(/FORBIDDEN/);
    });
    await expect(breakdown("plan")).rejects.toThrow(/INVALID_GROUP/);
  });
});
