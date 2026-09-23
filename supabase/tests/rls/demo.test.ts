// @vitest-environment node
import { describe, it, expect, beforeAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb, createUser, asUser, asService, expectRejected } from "../helpers/pgdb";

let db: PGlite;
type R = Record<string, unknown>;
async function one<T = R>(sql: string, params: unknown[] = []): Promise<T> {
  return (await db.query<T>(sql, params)).rows[0];
}
const spec = { name: "SQL", type: "skill", topics: ["Joins"], pass_threshold: 6, max_turns: 5, max_minutes: 10 };

async function orgWithInterview(slug: string, demo: boolean, student: string) {
  const org = (await one<{ id: string }>("INSERT INTO organizations (name, slug, type, is_demo) VALUES ($1, $1, 'college', $2) RETURNING id", [slug, demo])).id;
  await db.query("INSERT INTO org_memberships (org_id, user_id, role) VALUES ($1, $2, 'student')", [org, student]);
  const mod = (await one<{ id: string }>("INSERT INTO interview_modules (org_id, spec) VALUES ($1, $2) RETURNING id", [org, JSON.stringify(spec)])).id;
  const iv = (await one<{ id: string }>(
    `INSERT INTO b2b_interviews (org_id, user_id, module_id, module_version, module_spec, state, status, prompt_version, deadline_at, completed_at)
     VALUES ($1, $2, $3, 1, $4, '{}'::jsonb, 'completed', 'p', now(), now()) RETURNING id`, [org, student, mod, JSON.stringify(spec)])).id;
  await db.query("INSERT INTO b2b_interview_turns (interview_id, org_id, turn_index, role, content) VALUES ($1, $2, 1, 'student', 'answer text')", [iv, org]);
  await db.query("INSERT INTO b2b_evaluations (interview_id, org_id, user_id, module_id, evaluator_version, status) VALUES ($1, $2, $3, $4, 'old', 'completed')", [iv, org, student, mod]);
  await db.query("INSERT INTO org_student_usage (org_id, user_id, interviews_used) VALUES ($1, $2, 1)", [org, student]);
  return org;
}

let demo = "", real = "", demoOnly = "", both = "", founder = "";
beforeAll(async () => {
  db = await createTestDb();
  demoOnly = await createUser(db);
  both = await createUser(db);
  founder = await createUser(db); // real email, member of the demo org only
  for (const id of [demoOnly, both]) await db.query("UPDATE auth.users SET email = $2 WHERE id = $1", [id, `${id}@demo.hiresume.invalid`]);
  demo = await orgWithInterview("demo-college", true, demoOnly);
  await db.query("INSERT INTO org_memberships (org_id, user_id, role) VALUES ($1, $2, 'org_admin')", [demo, both]);
  await db.query("INSERT INTO org_memberships (org_id, user_id, role) VALUES ($1, $2, 'org_admin')", [demo, founder]);
  real = await orgWithInterview("real-college", false, both);
});

describe("b2b_demo_reset", () => {
  it("refuses to touch a real organization", async () => {
    await expect(asService(db, (tx) => tx.query("SELECT public.b2b_demo_reset($1)", [real]))).rejects.toThrow(/REFUSED/);
    expect(await one("SELECT count(*)::int AS n FROM b2b_interviews WHERE org_id = $1", [real])).toEqual({ n: 1 });
  });

  it("the evaluation sweep skips demo orgs", async () => {
    const ids = await asService(db, async (tx) =>
      (await tx.query<{ interview_id: string }>("SELECT interview_id FROM public.b2b_interviews_needing_evaluation('new-version', NULL, 100)")).rows);
    const orgs = await Promise.all(ids.map(async (r) => (await one<{ org_id: string }>("SELECT org_id FROM b2b_interviews WHERE id = $1", [r.interview_id])).org_id));
    expect(orgs).toEqual([real]);
  });

  it("deletes all demo data and returns only users who belong solely to demo orgs", async () => {
    const users = await asService(db, async (tx) => (await tx.query<{ u: string[] }>("SELECT public.b2b_demo_reset($1) AS u", [demo])).rows[0].u);
    // `both` is also staff at a real college; `founder` has a real email — neither may be deleted.
    expect(users).toEqual([demoOnly]);
    for (const t of ["organizations", "interview_modules", "b2b_interviews", "b2b_interview_turns", "b2b_evaluations", "org_memberships", "org_student_usage"]) {
      const col = t === "organizations" ? "id" : "org_id";
      expect(await one(`SELECT count(*)::int AS n FROM ${t} WHERE ${col} = $1`, [demo])).toEqual({ n: 0 });
    }
    expect(await one("SELECT count(*)::int AS n FROM b2b_interviews WHERE org_id = $1", [real])).toEqual({ n: 1 });
  });

  it("is service-role only", async () => {
    const s = await createUser(db, { superAdmin: true });
    await asUser(db, s, async (tx) => {
      expect(await expectRejected(tx, "SELECT public.b2b_demo_reset($1)", [real])).toMatch(/permission denied/);
    });
  });
});
