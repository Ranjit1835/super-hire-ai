// @vitest-environment node
// R5.5 retention SQL (migration 0023) on embedded Postgres (no storage schema here: event evidence only).
import { describe, it, expect, beforeAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb, createUser, asUser, asService, expectRejected } from "../helpers/pgdb";

let db: PGlite;
const id: Record<string, string> = {};
const svc = <T,>(sql: string, params: unknown[] = []) =>
  asService(db, async (tx) => (await tx.query<{ r: T }>(`SELECT ${sql} AS r`, params)).rows[0].r);
const one = async (sql: string, p: unknown[] = []) => (await db.query<{ id: string }>(sql, p)).rows[0].id;

beforeAll(async () => {
  db = await createTestDb();
  id.org = await one("INSERT INTO organizations (name, slug, type) VALUES ('Ret College', 'ret-college', 'college') RETURNING id");
  id.org30 = await one(`INSERT INTO organizations (name, slug, type, settings) VALUES ('Short', 'ret-short', 'college', '{"retention_days": 30}') RETURNING id`);
  id.co = await one("INSERT INTO organizations (name, slug, type) VALUES ('Ret Co', 'ret-co', 'company') RETURNING id");
  for (const [key, org] of [["s", id.org], ["s30", id.org30]] as const) {
    const user = await createUser(db);
    // A session belongs to an attempt or an interview; a bare interview row is enough here.
    const iv = await one("INSERT INTO b2b_interviews (org_id, user_id, module_spec, state, prompt_version, kind, deadline_at) VALUES ($1, $2, '{}', '{}', 'p', 'drive', now()) RETURNING id", [org, user]);
    id[key] = await one("INSERT INTO proctoring_sessions (org_id, subject_user_id, context_type, interview_id, policy) VALUES ($1, $2, 'practice', $3, 'standard') RETURNING id",
      [org, user, iv]);
  }
  const ev = (session: string, org: string, daysAgo: number, path: string | null) => db.query(
    "INSERT INTO proctoring_events (session_id, org_id, type, severity, confidence, started_at, evidence_path) VALUES ($1, $2, 'snapshot', 'info', 1, now() - make_interval(days => $3), $4)",
    [session, org, daysAgo, path]);
  await ev(id.s, id.org, 91, "org/a/old.jpg");       // past 90 days
  await ev(id.s, id.org, 89, "org/a/recent.jpg");    // within 90
  await ev(id.s30, id.org30, 31, "org/b/old30.jpg"); // past this org's 30 days
  await ev(id.s, id.org, 200, null);                 // no evidence: nothing to do
});

describe("retention SQL (R5.5)", () => {
  it("lists evidence past each org's own retention, and clears links after the files are gone", async () => {
    const due = await svc<{ paths: string[]; event_ids: number[] }>("public.b2b_retention_due(500)");
    expect([...due.paths].sort()).toEqual(["org/a/old.jpg", "org/b/old30.jpg"]);
    expect(due.event_ids).toHaveLength(2);
    expect(await svc<number>("public.b2b_retention_clear_evidence($1)", [due.event_ids])).toBe(2);
    expect((await svc<{ paths: string[] }>("public.b2b_retention_due(500)")).paths).toEqual([]);
    const cleared = (await db.query<{ meta: Record<string, unknown> }>(
      "SELECT meta FROM proctoring_events WHERE meta ? 'evidence_deleted_at'")).rows;
    expect(cleared).toHaveLength(2);
    expect((await db.query("SELECT 1 FROM proctoring_events WHERE evidence_path = 'org/a/recent.jpg'")).rows).toHaveLength(1);
  });

  it("purges company transcripts once the role has been closed past retention; open roles and scores stay", async () => {
    const role = async (status: string) => one("INSERT INTO job_roles (org_id, title, status) VALUES ($1, 'Role', $2) RETURNING id", [id.co, status]);
    const closedOld = await role("closed");
    const open = await role("open");
    await db.query("ALTER TABLE job_roles DISABLE TRIGGER USER");
    await db.query("UPDATE job_roles SET updated_at = now() - interval '100 days' WHERE id = $1", [closedOld]);
    await db.query("ALTER TABLE job_roles ENABLE TRIGGER USER");
    // One live interview per user: each candidate gets their own.
    const iv = async (ctx: string) => one(
      `INSERT INTO b2b_interviews (org_id, user_id, module_spec, state, prompt_version, kind, context_id, deadline_at)
       VALUES ($1, $2, '{}', '{}', 'p', 'job_role', $3, now()) RETURNING id`, [id.co, await createUser(db), ctx]);
    const ivOld = await iv(closedOld);
    const ivOpen = await iv(open);
    for (const i of [ivOld, ivOpen]) {
      await db.query("INSERT INTO b2b_interview_turns (interview_id, org_id, turn_index, role, content) VALUES ($1, $2, 1, 'interviewer', 'Q'), ($1, $2, 1, 'student', 'A')", [i, id.co]);
    }
    expect(await svc<number>("public.b2b_retention_purge_transcripts()")).toBe(2);
    expect((await db.query("SELECT 1 FROM b2b_interview_turns WHERE interview_id = $1", [ivOld])).rows).toHaveLength(0);
    expect((await db.query("SELECT 1 FROM b2b_interview_turns WHERE interview_id = $1", [ivOpen])).rows).toHaveLength(2);
    expect((await db.query("SELECT 1 FROM b2b_interviews WHERE id = $1", [ivOld])).rows).toHaveLength(1);
    expect((await db.query("SELECT 1 FROM audit_logs WHERE action = 'retention.transcripts'")).rows).toHaveLength(1);
  });

  it("only the service role can run any of it", async () => {
    const u = await createUser(db);
    await asUser(db, u, async (tx) => {
      for (const f of ["b2b_retention_due(10)", "b2b_retention_purge_transcripts()", "b2b_retention_clear_evidence('{1}')"]) {
        expect(await expectRejected(tx, `SELECT public.${f}`)).toMatch(/permission denied/);
      }
    });
  });
});
