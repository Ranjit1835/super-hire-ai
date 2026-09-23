// @vitest-environment node
// Interview lifecycle in the database: start (credit + snapshot), idempotent turns,
// optimistic concurrency, resume, end/cancel with refund, isolation.
import { describe, it, expect, beforeAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { createTestDb, createUser, asUser, asService, expectRejected } from "../helpers/pgdb";
import { initState, planTurn, applyTurn } from "../../functions/_shared/interview-engine";
import type { ModuleSpec } from "../../functions/_shared/module-spec";
import { INTERVIEWER_PROMPT_VERSION } from "../../functions/_shared/interview-prompts";

let db: PGlite;
const u: Record<string, string> = {};
let orgA = "", orgB = "", moduleA = "", moduleB = "", archivedModule = "";
const spec: ModuleSpec = { name: "SQL", type: "skill", topics: ["Joins", "Indexes"], pass_threshold: 6, max_turns: 4, max_minutes: 10 };

type R = Record<string, unknown>;
const svc = async <T = R>(sql: string, params: unknown[]) =>
  asService(db, async (tx) => (await tx.query<{ r: T }>(sql, params)).rows[0]?.r as T);

const start = (user: string, mod: string, version = 1) =>
  svc("SELECT public.b2b_start_interview($1, $2, $3, $4, $5, '{}'::jsonb) AS r",
    [user, mod, version, JSON.stringify(initState(mod, spec)), INTERVIEWER_PROMPT_VERSION]);

const opening = (id: string, mod: string) =>
  asService(db, (tx) => tx.query("SELECT public.b2b_record_opening($1, 'Tell me about joins.', '{}'::jsonb, $2)", [id, JSON.stringify(initState(mod, spec))]));

async function answer(id: string, user: string, expected: number, clientTurnId = randomUUID(), text = "An inner join returns matching rows.") {
  const iv = (await db.query<{ state: ReturnType<typeof initState> }>("SELECT state FROM b2b_interviews WHERE id = $1", [id])).rows[0];
  const plan = planTurn(iv.state, spec, 60);
  const out = applyTurn(iv.state, spec, plan, {
    answer_signal: "adequate", answer_score: 6, topic_covered: false, next_topic: iv.state.topics_remaining[0] ?? iv.state.current_topic, question: "Next?",
  });
  return svc("SELECT public.b2b_record_turn($1, $2, $3, $4, $5, '{}'::jsonb, $6, $7, $8, '{}'::jsonb, $9, $10) AS r", [
    id, user, expected, clientTurnId, text, iv.state.current_topic, iv.state.difficulty,
    out.next ? out.next.question ?? "Fallback?" : null, JSON.stringify(out.state), out.endReason,
  ]);
}

async function one<T = R>(sql: string, params: unknown[] = []): Promise<T> {
  return (await db.query<T>(sql, params)).rows[0];
}

beforeAll(async () => {
  db = await createTestDb();
  for (const k of ["s1", "s2", "s3", "s4", "s5", "staffA", "studentB", "b2c"]) u[k] = await createUser(db);
  orgA = (await one<{ id: string }>("INSERT INTO organizations (name, slug, type) VALUES ('College A', 'org-a', 'college') RETURNING id")).id;
  orgB = (await one<{ id: string }>("INSERT INTO organizations (name, slug, type) VALUES ('College B', 'org-b', 'college') RETURNING id")).id;
  const add = (o: string, id: string, role = "student") =>
    db.query("INSERT INTO org_memberships (org_id, user_id, role) VALUES ($1, $2, $3)", [o, id, role]);
  for (const k of ["s1", "s2", "s3", "s4", "s5"]) await add(orgA, u[k]);
  await add(orgA, u.staffA, "trainer");
  await add(orgB, u.studentB);
  const mk = async (o: string, active = true) =>
    (await one<{ id: string }>("INSERT INTO interview_modules (org_id, spec, is_active) VALUES ($1, $2, $3) RETURNING id",
      [o, JSON.stringify({ ...spec, name: `SQL ${randomUUID().slice(0, 4)}` }), active])).id;
  moduleA = await mk(orgA);
  moduleB = await mk(orgB);
  archivedModule = await mk(orgA, false);
});

describe("start", () => {
  it("consumes one credit, snapshots the module and deadline", async () => {
    const r = await start(u.s1, moduleA);
    expect(r).toMatchObject({ ok: true, resumed: false, credit: { ok: true, used: 1, remaining: 5 } });
    const iv = await one<R>("SELECT org_id, module_version, module_spec->>'max_minutes' AS mins, status, prompt_version, (deadline_at - started_at) AS dur FROM b2b_interviews WHERE id = $1", [r.interview_id]);
    expect(iv).toMatchObject({ org_id: orgA, module_version: 1, mins: "10", status: "in_progress", prompt_version: INTERVIEWER_PROMPT_VERSION });
  });

  it("a second start for the same module resumes without another credit; a different module is refused", async () => {
    const first = await one<{ id: string }>("SELECT id FROM b2b_interviews WHERE user_id = $1", [u.s1]);
    expect(await start(u.s1, moduleA)).toMatchObject({ ok: true, resumed: true, interview_id: first.id });
    const other = await one<{ id: string }>("INSERT INTO interview_modules (org_id, spec) VALUES ($1, $2) RETURNING id", [orgA, JSON.stringify({ ...spec, name: "Other" })]);
    expect(await start(u.s1, other.id)).toMatchObject({ ok: false, reason: "OTHER_IN_PROGRESS", interview_id: first.id });
    expect((await one<{ n: number }>("SELECT interviews_used AS n FROM org_student_usage WHERE user_id = $1", [u.s1])).n).toBe(1);
  });

  it("refuses other orgs' modules, archived modules, stale versions, staff and B2C users", async () => {
    expect(await start(u.s2, moduleB)).toMatchObject({ ok: false, reason: "NOT_A_STUDENT" });
    expect(await start(u.s2, archivedModule)).toMatchObject({ ok: false, reason: "MODULE_UNAVAILABLE" });
    expect(await start(u.s2, moduleA, 99)).toMatchObject({ ok: false, reason: "MODULE_CHANGED" });
    expect(await start(u.staffA, moduleA)).toMatchObject({ ok: false, reason: "NOT_A_STUDENT" });
    expect(await start(u.b2c, moduleA)).toMatchObject({ ok: false, reason: "NOT_A_STUDENT" });
    expect(await one("SELECT count(*)::int AS n FROM org_student_usage WHERE user_id = $1", [u.s2])).toEqual({ n: 0 });
  });

  it("stops at the plan's interview cap", async () => {
    await db.query("INSERT INTO org_student_usage (org_id, user_id, interviews_used) VALUES ($1, $2, 6)", [orgA, u.s5]);
    expect(await start(u.s5, moduleA)).toMatchObject({ ok: false, reason: "LIMIT_REACHED" });
  });
});

describe("turns", () => {
  let id = "";
  beforeAll(async () => {
    id = (await start(u.s2, moduleA)).interview_id as string;
    await opening(id, moduleA);
  });

  it("records answer + next question and advances state", async () => {
    expect(await answer(id, u.s2, 0)).toEqual({ ok: true, duplicate: false });
    const turns = (await db.query<R>("SELECT turn_index, role, topic FROM b2b_interview_turns WHERE interview_id = $1 ORDER BY turn_index, (role = 'student')", [id])).rows;
    expect(turns).toEqual([
      { turn_index: 1, role: "interviewer", topic: "Joins" },
      { turn_index: 1, role: "student", topic: "Joins" },
      { turn_index: 2, role: "interviewer", topic: "Indexes" },
    ]);
    expect((await one<{ c: string }>("SELECT state->>'turn_count' AS c FROM b2b_interviews WHERE id = $1", [id])).c).toBe("1");
  });

  it("is idempotent on client_turn_id (network retry) and rejects stale turn numbers", async () => {
    const ct = randomUUID();
    expect(await answer(id, u.s2, 1, ct)).toMatchObject({ ok: true, duplicate: false });
    expect(await answer(id, u.s2, 1, ct)).toMatchObject({ ok: true, duplicate: true });
    expect(await answer(id, u.s2, 1)).toMatchObject({ ok: false, reason: "TURN_CONFLICT", turn_count: 2 });
    const n = await one<{ n: number }>("SELECT count(*)::int AS n FROM b2b_interview_turns WHERE interview_id = $1 AND role = 'student'", [id]);
    expect(n.n).toBe(2);
  });

  it("completes when the engine ends and refuses further answers", async () => {
    await answer(id, u.s2, 2);
    const last = await answer(id, u.s2, 3); // 4th answer = max_turns
    expect(last).toMatchObject({ ok: true });
    const iv = await one<R>("SELECT status, end_reason, completed_at IS NOT NULL AS done FROM b2b_interviews WHERE id = $1", [id]);
    expect(iv).toEqual({ status: "completed", end_reason: "max_turns", done: true });
    expect(await answer(id, u.s2, 4)).toMatchObject({ ok: false, reason: "NOT_IN_PROGRESS" });
  });

  it("rejects answers from another user", async () => {
    const other = (await start(u.s3, moduleA)).interview_id as string;
    await opening(other, moduleA);
    expect(await answer(other, u.s4, 0)).toMatchObject({ ok: false, reason: "NOT_FOUND" });
  });
});

describe("ending and cancelling", () => {
  it("ending before any answer cancels and refunds; after answers it completes", async () => {
    const s = await createUser(db);
    await db.query("INSERT INTO org_memberships (org_id, user_id, role) VALUES ($1, $2, 'student')", [orgA, s]);
    const a = (await start(s, moduleA)).interview_id as string;
    await opening(a, moduleA);
    expect(await svc("SELECT public.b2b_end_interview($1, $2, NULL) AS r", [a, s])).toMatchObject({ status: "cancelled", refunded: true });
    expect((await one<{ n: number }>("SELECT interviews_used AS n FROM org_student_usage WHERE user_id = $1", [s])).n).toBe(0);

    const b = (await start(s, moduleA)).interview_id as string;
    await opening(b, moduleA);
    await answer(b, s, 0);
    expect(await svc("SELECT public.b2b_end_interview($1, $2, NULL, 'time_limit') AS r", [b, s])).toMatchObject({ status: "completed", refunded: false });
    expect(await one("SELECT end_reason FROM b2b_interviews WHERE id = $1", [b])).toEqual({ end_reason: "time_limit" });
    expect((await one<{ n: number }>("SELECT interviews_used AS n FROM org_student_usage WHERE user_id = $1", [s])).n).toBe(1);
  });

  it("a failed opening (LLM outage) cancels and refunds", async () => {
    const s = await createUser(db);
    await db.query("INSERT INTO org_memberships (org_id, user_id, role) VALUES ($1, $2, 'student')", [orgA, s]);
    const a = (await start(s, moduleA)).interview_id as string;
    await asService(db, (tx) => tx.query("SELECT public.b2b_cancel_failed_start($1)", [a]));
    expect(await one("SELECT status FROM b2b_interviews WHERE id = $1", [a])).toEqual({ status: "cancelled" });
    expect((await one<{ n: number }>("SELECT interviews_used AS n FROM org_student_usage WHERE user_id = $1", [s])).n).toBe(0);
  });

  it("abandons interviews 30 minutes past their deadline, freeing the student to start again", async () => {
    const s = await createUser(db);
    await db.query("INSERT INTO org_memberships (org_id, user_id, role) VALUES ($1, $2, 'student')", [orgA, s]);
    const a = (await start(s, moduleA)).interview_id as string;
    await db.query("UPDATE b2b_interviews SET started_at = now() - interval '2 hours', deadline_at = now() - interval '31 minutes' WHERE id = $1", [a]);
    const b = await start(s, moduleA);
    expect(b).toMatchObject({ ok: true, resumed: false });
    expect(await one("SELECT status, end_reason FROM b2b_interviews WHERE id = $1", [a])).toEqual({ status: "abandoned", end_reason: "abandoned" });
  });
});

describe("visibility", () => {
  it("students read only their own interviews and turns; staff read their org; other orgs and B2C read nothing", async () => {
    const s2Interviews = (await db.query<{ id: string }>("SELECT id FROM b2b_interviews WHERE user_id = $1", [u.s2])).rows.map((r) => r.id);
    await asUser(db, u.s2, async (tx) => {
      expect((await tx.query<{ user_id: string }>("SELECT user_id FROM b2b_interviews")).rows.every((r) => r.user_id === u.s2)).toBe(true);
      const turns = (await tx.query<{ interview_id: string }>("SELECT interview_id FROM b2b_interview_turns")).rows;
      expect(turns.length).toBeGreaterThan(0);
      expect(turns.every((t) => s2Interviews.includes(t.interview_id))).toBe(true);
    });
    await asUser(db, u.staffA, async (tx) => {
      const orgs = (await tx.query<{ org_id: string }>("SELECT DISTINCT org_id FROM b2b_interviews")).rows.map((r) => r.org_id);
      expect(orgs).toEqual([orgA]);
    });
    for (const who of [u.studentB, u.b2c]) {
      await asUser(db, who, async (tx) => {
        expect((await tx.query("SELECT * FROM b2b_interviews WHERE org_id = $1", [orgA])).rows).toEqual([]);
        expect((await tx.query("SELECT * FROM b2b_interview_turns WHERE org_id = $1", [orgA])).rows).toEqual([]);
      });
    }
  });

  it("nobody can write interviews or turns directly, or call the lifecycle functions from the browser", async () => {
    const id = (await one<{ id: string }>("SELECT id FROM b2b_interviews WHERE user_id = $1 LIMIT 1", [u.s2])).id;
    await asUser(db, u.s2, async (tx) => {
      expect((await tx.query("UPDATE b2b_interviews SET status = 'completed' WHERE id = $1", [id])).affectedRows ?? 0).toBe(0);
      expect((await tx.query("UPDATE b2b_interview_turns SET content = 'edited' WHERE interview_id = $1", [id])).affectedRows ?? 0).toBe(0);
      await expectRejected(tx, "INSERT INTO b2b_interview_turns (interview_id, org_id, turn_index, role, content) VALUES ($1, $2, 9, 'student', 'x')", [id, orgA]);
      expect(await expectRejected(tx, "SELECT public.b2b_start_interview($1, $2, 1, '{}'::jsonb, 'v', '{}'::jsonb)", [u.s2, moduleA])).toMatch(/permission denied/);
      expect(await expectRejected(tx, "SELECT public.b2b_end_interview($1, $2, NULL)", [id, u.s2])).toMatch(/permission denied/);
    });
  });
});
