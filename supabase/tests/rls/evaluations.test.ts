// @vitest-environment node
import { describe, it, expect, beforeAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { createTestDb, createUser, asUser, asService, expectRejected } from "../helpers/pgdb";

let db: PGlite;
const u: Record<string, string> = {};
let orgA = "", orgB = "", moduleA = "";
const V1 = "evaluator-test-v1";
type R = Record<string, unknown>;

async function one<T = R>(sql: string, params: unknown[] = []): Promise<T> {
  return (await db.query<T>(sql, params)).rows[0];
}
const svc = async <T = R>(sql: string, params: unknown[]) =>
  asService(db, async (tx) => (await tx.query<{ r: T }>(sql, params)).rows[0]?.r as T);

/** Insert an interview directly (as the owner) with N answered turns. */
async function interview(user: string, status: string, answers: number, org = orgA, mod = moduleA): Promise<string> {
  const id = (await one<{ id: string }>(
    `INSERT INTO b2b_interviews (org_id, user_id, module_id, module_version, module_spec, state, status, prompt_version, deadline_at, completed_at)
     VALUES ($1, $2, $3, 1, '{}'::jsonb, '{}'::jsonb, $4::b2b_interview_status, 'p', now() + interval '10 minutes', CASE WHEN $4::text = 'in_progress' THEN NULL ELSE now() END)
     RETURNING id`, [org, user, mod, status])).id;
  for (let i = 1; i <= answers; i++) {
    await db.query("INSERT INTO b2b_interview_turns (interview_id, org_id, turn_index, role, content) VALUES ($1, $2, $3, 'interviewer', 'Q'), ($1, $2, $3, 'student', 'A')", [id, org, i]);
  }
  return id;
}

const claim = (id: string, v = V1) => svc("SELECT public.b2b_claim_evaluation($1, $2) AS r", [id, v]);
const save = (evId: string, status: string, overall: number | null = 7) =>
  asService(db, (tx) => tx.query(
    "SELECT public.b2b_save_evaluation($1, $2, 'm', $3, '{}'::jsonb, $4, $5, 'gap', 1, '[]'::jsonb, NULL)",
    [evId, status, JSON.stringify({ ok: true }), overall, status === "completed" ? "developing" : null]));

beforeAll(async () => {
  db = await createTestDb();
  for (const k of ["s1", "s2", "staffA", "studentB", "b2c"]) u[k] = await createUser(db);
  orgA = (await one<{ id: string }>("INSERT INTO organizations (name, slug, type) VALUES ('College A', 'eval-a', 'college') RETURNING id")).id;
  orgB = (await one<{ id: string }>("INSERT INTO organizations (name, slug, type) VALUES ('College B', 'eval-b', 'college') RETURNING id")).id;
  for (const [o, k, r] of [[orgA, "s1", "student"], [orgA, "s2", "student"], [orgA, "staffA", "trainer"], [orgB, "studentB", "student"]] as const) {
    await db.query("INSERT INTO org_memberships (org_id, user_id, role) VALUES ($1, $2, $3)", [o, u[k], r]);
  }
  moduleA = (await one<{ id: string }>("INSERT INTO interview_modules (org_id, spec) VALUES ($1, $2) RETURNING id",
    [orgA, JSON.stringify({ name: "SQL", type: "skill", topics: ["Joins"], pass_threshold: 6, max_turns: 5, max_minutes: 10 })])).id;
});

describe("claiming", () => {
  it("only finished interviews with answers can be evaluated", async () => {
    expect(await claim(await interview(u.s1, "in_progress", 2))).toMatchObject({ claimed: false, reason: "NOT_FINISHED" });
    expect(await claim(await interview(u.s1, "completed", 0))).toMatchObject({ claimed: false, reason: "NO_ANSWERS" });
    expect(await claim(randomUUID())).toMatchObject({ claimed: false, reason: "NOT_FOUND" });
    expect(await claim(await interview(u.s1, "abandoned", 2))).toMatchObject({ claimed: true });
  });

  it("a second concurrent claim is refused; completed results are returned, not recomputed", async () => {
    const id = await interview(u.s1, "completed", 3);
    const first = await claim(id);
    expect(first).toMatchObject({ claimed: true, status: "pending" });
    expect(await claim(id)).toMatchObject({ claimed: false, status: "pending" });
    await save(first.evaluation_id as string, "completed");
    expect(await claim(id)).toMatchObject({ claimed: false, status: "completed", evaluation_id: first.evaluation_id });
  });

  it("failed or stale claims can be retried; a new evaluator version gets its own row", async () => {
    const id = await interview(u.s2, "completed", 2);
    const c = await claim(id);
    await save(c.evaluation_id as string, "failed", null);
    expect(await claim(id)).toMatchObject({ claimed: true, evaluation_id: c.evaluation_id });
    await db.query("UPDATE b2b_evaluations SET updated_at = now() - interval '5 minutes' WHERE id = $1", [c.evaluation_id]);
    expect(await claim(id)).toMatchObject({ claimed: true });
    await save(c.evaluation_id as string, "completed");
    const v2 = await claim(id, "evaluator-test-v2");
    expect(v2).toMatchObject({ claimed: true });
    expect(v2.evaluation_id).not.toBe(c.evaluation_id);
    expect((await one<{ attempts: number }>("SELECT attempts FROM b2b_evaluations WHERE id = $1", [c.evaluation_id])).attempts).toBe(2);
  });

  it("lists interviews still needing an evaluation at a version (re-run after rubric change)", async () => {
    const need = (v: string) => asService(db, async (tx) =>
      (await tx.query<{ interview_id: string }>("SELECT interview_id FROM public.b2b_interviews_needing_evaluation($1, $2, 100)", [v, orgA])).rows.map((r) => r.interview_id));
    const done = await interview(u.s1, "completed", 1);
    const c = await claim(done);
    await save(c.evaluation_id as string, "completed");
    expect(await need(V1)).not.toContain(done);
    expect(await need("evaluator-test-v9")).toContain(done);
  });
});

describe("visibility", () => {
  it("students see their own evaluations, staff their org's, others nothing; nobody writes directly", async () => {
    const mine = await interview(u.s1, "completed", 1);
    const c = await claim(mine);
    await save(c.evaluation_id as string, "completed");
    const other = await interview(u.studentB, "completed", 1, orgB, (await one<{ id: string }>(
      "INSERT INTO interview_modules (org_id, spec) VALUES ($1, $2) RETURNING id",
      [orgB, JSON.stringify({ name: "SQL B", type: "skill", topics: ["Joins"], pass_threshold: 6, max_turns: 5, max_minutes: 10 })])).id);
    const cb = await claim(other);
    await save(cb.evaluation_id as string, "completed");

    await asUser(db, u.s1, async (tx) => {
      const rows = (await tx.query<{ user_id: string }>("SELECT user_id FROM b2b_latest_evaluations")).rows;
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.user_id === u.s1)).toBe(true);
      expect((await tx.query("UPDATE b2b_evaluations SET overall_score = 10")).affectedRows ?? 0).toBe(0);
      expect(await expectRejected(tx, "SELECT public.b2b_claim_evaluation($1, 'x')", [mine])).toMatch(/permission denied/);
    });
    await asUser(db, u.staffA, async (tx) => {
      const orgs = (await tx.query<{ org_id: string }>("SELECT DISTINCT org_id FROM b2b_latest_evaluations")).rows.map((r) => r.org_id);
      expect(orgs).toEqual([orgA]);
    });
    for (const who of [u.studentB, u.b2c]) {
      await asUser(db, who, async (tx) => {
        expect((await tx.query("SELECT * FROM b2b_evaluations WHERE org_id = $1", [orgA])).rows).toEqual([]);
        expect((await tx.query("SELECT * FROM b2b_latest_evaluations WHERE org_id = $1", [orgA])).rows).toEqual([]);
      });
    }
  });

  it("the latest-evaluation view respects RLS (security_invoker), not the view owner's rights", async () => {
    await asUser(db, u.b2c, async (tx) => expect((await tx.query("SELECT * FROM b2b_latest_evaluations")).rows).toEqual([]));
  });
});
