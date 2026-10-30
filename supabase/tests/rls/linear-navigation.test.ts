// @vitest-environment node
// R2.4 one question at a time (migration 0034): only the current question is sent and writable; no going back.
import { describe, it, expect, beforeAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb, createUser, asService } from "../helpers/pgdb";

let db: PGlite;
let org = "", asmt = "", user = "", attempt = "", session = "";
const id = async (sql: string, p: unknown[] = []) => (await db.query<{ id: string }>(sql, p)).rows[0].id;
type R = { ok: boolean; reason?: string; [k: string]: unknown };
const svc = (sql: string, p: unknown[]) => asService(db, async (tx) => (await tx.query<{ r: R }>(`SELECT ${sql} AS r`, p)).rows[0].r);
type State = R & { questions: { id: string }[]; navigation: { mode: string; index: number; total: number } };
const state = async () => (await svc("public.b2b_attempt_state($1, $2, $3)", [user, attempt, session])) as State;
const save = (q: string, choice = "a") =>
  svc("public.b2b_autosave($1, $2, $3, $4, $5, NULL, NULL, $6, NULL)", [user, attempt, session, q, Date.now() % 1e9, JSON.stringify([choice])]);
const advance = (from: number) => svc("public.b2b_advance_question($1, $2, $3, $4)", [user, attempt, session, from]);
let order: string[] = [];

beforeAll(async () => {
  db = await createTestDb();
  user = await createUser(db);
  org = await id("INSERT INTO organizations (name, slug, type, credits_balance) VALUES ('Linear College', 'linear-college', 'college', 10) RETURNING id");
  await db.query("INSERT INTO org_memberships (org_id, user_id, role) VALUES ($1, $2, 'student')", [org, user]);
  await db.query("INSERT INTO students (org_id, user_id, roll_no, full_name, email, status) VALUES ($1, $2, 'L1', 'Lata', 'lata@x.in', 'active')", [org, user]);
  for (let i = 0; i < 3; i++) {
    await db.query(`INSERT INTO questions (org_id, type, title, statement, difficulty, topics, options, answer, status)
      VALUES ($1, 'mcq', $2, 'Pick the right answer for this aptitude item.', 'easy', '{aptitude}', '[{"id":"a","text":"A"},{"id":"b","text":"B"}]', '["a"]', 'verified')`,
      [org, `Aptitude item ${i}`]);
  }
  asmt = await id(`INSERT INTO assessments (org_id, title, duration_min, sections, practice_enabled, status, navigation, max_overlap_pct)
    VALUES ($1, 'One at a time', 30, $2, true, 'ready', 'linear', 100) RETURNING id`,
    [org, JSON.stringify([{ type: "mcq", title: "Aptitude", pick: [{ topics: ["aptitude"], count: 3 }] }])]);
  const r = await svc("public.b2b_start_attempt($1, 'practice', NULL, $2, NULL)", [user, asmt]);
  attempt = String(r.attempt_id);
  session = String(r.session_id);
  order = (await db.query<{ q: string }>("SELECT e->>'question_id' AS q FROM attempts a, jsonb_array_elements(a.question_set) e WHERE a.id = $1", [attempt])).rows.map((x) => x.q);
});

describe("one question at a time (R2.4)", () => {
  it("sends only the current question, with the position", async () => {
    const s = await state();
    expect(s.questions.map((q) => q.id)).toEqual([order[0]]);
    expect(s.navigation).toEqual({ mode: "linear", index: 0, total: 3 });
  });

  it("only the current question can be answered", async () => {
    expect(await save(order[0])).toMatchObject({ ok: true });
    expect(await save(order[1])).toMatchObject({ ok: false, reason: "LOCKED" });
  });

  it("moving on is one way; a retried advance doesn't skip a question", async () => {
    expect(await advance(0)).toMatchObject({ ok: true, index: 1 });
    expect(await advance(0)).toMatchObject({ ok: true, index: 1 });           // retry after a dropped response
    expect(await save(order[0], "b")).toMatchObject({ ok: false, reason: "LOCKED" });
    expect(await save(order[1])).toMatchObject({ ok: true });
    expect((await state()).questions.map((q) => q.id)).toEqual([order[1]]);
    expect(await advance(1)).toMatchObject({ ok: true, index: 2 });
    expect(await advance(2)).toMatchObject({ ok: true, index: 2 });           // the last question stays the last
    expect(await advance(0)).toMatchObject({ ok: false, reason: "LOCKED" });
    // the answer left behind on question 1 wasn't changed
    expect((await db.query<{ c: string[] }>("SELECT mcq_choice AS c FROM attempt_answers WHERE attempt_id = $1 AND question_id = $2", [attempt, order[0]])).rows[0].c).toEqual(["a"]);
  });

  it("free navigation is unchanged: every question is sent and writable", async () => {
    await db.query("UPDATE assessments SET navigation = 'free' WHERE id = $1", [asmt]);
    const s = await state();
    expect(s.questions).toHaveLength(3);
    expect(s.navigation.mode).toBe("free");
    expect(await save(order[0], "b")).toMatchObject({ ok: true });
    expect(await advance(2)).toMatchObject({ ok: false, reason: "NOT_LINEAR" });
  });
});
