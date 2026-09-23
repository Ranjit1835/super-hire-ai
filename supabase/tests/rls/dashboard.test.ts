// @vitest-environment node
import { describe, it, expect, beforeAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb, createUser, asUser, expectRejected } from "../helpers/pgdb";

let db: PGlite;
const u: Record<string, string> = {};
let orgA = "", orgBasic = "";
type R = Record<string, unknown>;
async function one<T = R>(sql: string, params: unknown[] = []): Promise<T> {
  return (await db.query<T>(sql, params)).rows[0];
}

const spec = { name: "SQL", type: "skill", topics: ["Joins", "Indexes"], pass_threshold: 6, max_turns: 5, max_minutes: 10 };

async function evaluated(org: string, mod: string, user: string, version: string, overall: number, at: string) {
  const iv = (await one<{ id: string }>(
    `INSERT INTO b2b_interviews (org_id, user_id, module_id, module_version, module_spec, state, status, prompt_version, started_at, deadline_at, completed_at)
     VALUES ($1, $2, $3, 1, $4, '{}'::jsonb, 'completed', 'p', $5::timestamptz, $5::timestamptz + interval '10 minutes', $5::timestamptz) RETURNING id`,
    [org, user, mod, JSON.stringify(spec), at])).id;
  const result = {
    dimensions: { technical_knowledge: { score: overall, evidence: ["x y z"], reason: "r" }, resume_project_knowledge: { score: "insufficient_data", evidence: [], reason: "r" } },
    per_topic: { Joins: { score: 7, evidence: ["a b c"], reason: "r" }, Indexes: { score: "insufficient_data", evidence: [], reason: "r" } },
  };
  await db.query(
    `INSERT INTO b2b_evaluations (interview_id, org_id, user_id, module_id, evaluator_version, status, result, overall_score, readiness_level, primary_gap, completed_at)
     VALUES ($1, $2, $3, $4, $5, 'completed', $6, $7, 'developing', 'gap', $8::timestamptz)`,
    [iv, org, user, mod, version, JSON.stringify(result), overall, at]);
  return iv;
}

beforeAll(async () => {
  db = await createTestDb();
  for (const k of ["admin", "trainer", "student", "otherAdmin", "basicAdmin", "super"]) u[k] = await createUser(db, { superAdmin: k === "super" });
  orgA = (await one<{ id: string }>("INSERT INTO organizations (name, slug, type) VALUES ('College A', 'dash-a', 'college') RETURNING id")).id;
  const orgB = (await one<{ id: string }>("INSERT INTO organizations (name, slug, type) VALUES ('College B', 'dash-b', 'college') RETURNING id")).id;
  orgBasic = (await one<{ id: string }>("INSERT INTO organizations (name, slug, type, plan_id) VALUES ('Basic College', 'dash-basic', 'college', 'basic') RETURNING id")).id;
  const add = (o: string, id: string, role: string) => db.query("INSERT INTO org_memberships (org_id, user_id, role) VALUES ($1, $2, $3)", [o, id, role]);
  await add(orgA, u.admin, "org_admin");
  await add(orgA, u.trainer, "trainer");
  await add(orgA, u.student, "student");
  await add(orgB, u.otherAdmin, "org_admin");
  await add(orgBasic, u.basicAdmin, "org_admin");
  const mod = (await one<{ id: string }>("INSERT INTO interview_modules (org_id, spec) VALUES ($1, $2) RETURNING id", [orgA, JSON.stringify(spec)])).id;
  const iv = await evaluated(orgA, mod, u.student, "v1", 5, "2026-09-01T10:00:00Z");
  // Re-scored with a newer rubric: only the latest completed evaluation is returned.
  await db.query(
    `INSERT INTO b2b_evaluations (interview_id, org_id, user_id, module_id, evaluator_version, status, result, overall_score, readiness_level, completed_at)
     SELECT interview_id, org_id, user_id, module_id, 'v2', 'completed', result, 6, 'ready', '2026-09-05T10:00:00Z' FROM b2b_evaluations WHERE interview_id = $1`, [iv]);
  await evaluated(orgA, mod, u.student, "v1", 8, "2026-09-10T10:00:00Z");
});

describe("org_dashboard_evaluations", () => {
  it("returns compact score rows (no evidence) for staff, latest evaluation per interview, oldest first", async () => {
    for (const who of [u.admin, u.trainer, u.super]) {
      await asUser(db, who, async (tx) => {
        const rows = (await tx.query<R>("SELECT * FROM public.org_dashboard_evaluations($1)", [orgA])).rows;
        expect(rows).toHaveLength(2);
        expect(rows[0]).toMatchObject({
          user_id: u.student, module_name: "SQL", module_type: "skill", overall_score: "6.0", readiness_level: "ready",
          dimensions: { technical_knowledge: 5, resume_project_knowledge: null },
          per_topic: { Joins: 7, Indexes: null },
        });
        expect(JSON.stringify(rows)).not.toContain("x y z");
        expect(Number(rows[1].overall_score)).toBe(8);
      });
    }
  });

  it("is refused for students, other orgs and anon", async () => {
    for (const who of [u.student, u.otherAdmin]) {
      await asUser(db, who, async (tx) => {
        expect(await expectRejected(tx, "SELECT * FROM public.org_dashboard_evaluations($1)", [orgA])).toMatch(/FORBIDDEN/);
      });
    }
    await asUser(db, null, async (tx) => {
      expect(await expectRejected(tx, "SELECT * FROM public.org_dashboard_evaluations($1)", [orgA])).toMatch(/permission denied/);
    });
  });

  it("is a plan feature: Basic-plan staff get individual reports only", async () => {
    await asUser(db, u.basicAdmin, async (tx) => {
      expect(await expectRejected(tx, "SELECT * FROM public.org_dashboard_evaluations($1)", [orgBasic])).toMatch(/PLAN_FEATURE/);
    });
  });
});
