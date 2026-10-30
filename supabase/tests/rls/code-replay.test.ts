// @vitest-environment node
// R2.7 code playback (migration 0030): staff of the drive get the ordered edit log; nobody else does.
import { describe, it, expect, beforeAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb, createUser, asUser, expectRejected } from "../helpers/pgdb";

let db: PGlite;
const u: Record<string, string> = {};
let org = "", drive = "", student = "", attempt = "", coding = "", mcq = "", otherStudent = "";
const id = async (sql: string, p: unknown[] = []) => (await db.query<{ id: string }>(sql, p)).rows[0].id;
type Replay = { attempt_id: string; questions: { question_id: string; title: string; languages: string[]; final_code: string;
  final_language: string; events: { op: string; text?: string }[]; truncated: boolean }[] } | null;
const replay = (user: string, s = student) => asUser(db, user, async (tx) =>
  (await tx.query<{ r: Replay }>("SELECT public.b2b_drive_code_replay($1, $2) AS r", [drive, s])).rows[0].r);

beforeAll(async () => {
  db = await createTestDb();
  u.tpo = await createUser(db);
  u.student = await createUser(db);
  u.otherTpo = await createUser(db);
  org = await id("INSERT INTO organizations (name, slug, type) VALUES ('Replay College', 'replay-college', 'college') RETURNING id");
  const other = await id("INSERT INTO organizations (name, slug, type) VALUES ('Other College', 'other-college-r27', 'college') RETURNING id");
  await db.query("INSERT INTO org_memberships (org_id, user_id, role) VALUES ($1, $2, 'org_admin'), ($3, $4, 'org_admin'), ($1, $5, 'student')",
    [org, u.tpo, other, u.otherTpo, u.student]);
  student = await id("INSERT INTO students (org_id, user_id, roll_no, full_name, email, status) VALUES ($1, $2, 'R1', 'Asha', 'asha@x.in', 'active') RETURNING id", [org, u.student]);
  otherStudent = await id("INSERT INTO students (org_id, roll_no, full_name, email) VALUES ($1, 'R2', 'Ravi', 'ravi@x.in') RETURNING id", [org]);
  coding = await id(`INSERT INTO questions (org_id, type, title, statement, difficulty, topics, languages, starter_code, status)
    VALUES ($1, 'coding', 'Two sum', 'Return the indices of two numbers that add up to target.', 'easy', '{arrays}', '{python,java}', '{"python":"def f():\\n"}', 'draft') RETURNING id`, [org]);
  mcq = await id(`INSERT INTO questions (org_id, type, title, statement, difficulty, topics, options, answer, status)
    VALUES ($1, 'mcq', 'Speed', 'A train covers 120 km in 2 hours. Speed?', 'easy', '{aptitude}', '[{"id":"a","text":"60"},{"id":"b","text":"40"}]', '["a"]', 'verified') RETURNING id`, [org]);
  const asmt = await id(`INSERT INTO assessments (org_id, title, duration_min, sections, languages, status, max_overlap_pct)
    VALUES ($1, 'Round 1', 30, '[]', '{python}', 'ready', 100) RETURNING id`, [org]);
  drive = await id(`INSERT INTO drives (org_id, name, assessment_id, status, window_start, window_end)
    VALUES ($1, 'Drive', $2, 'draft', now() - interval '1 hour', now() + interval '3 hours') RETURNING id`, [org, asmt]);
  attempt = await id(`INSERT INTO attempts (org_id, assessment_id, subject_user_id, student_id, context_type, context_id, status, started_at, question_set)
    VALUES ($1, $2, $3, $4, 'drive', $5, 'submitted', now() - interval '20 minutes', $6) RETURNING id`,
    [org, asmt, u.student, student, drive, JSON.stringify([{ question_id: mcq, section: 0, type: "mcq" }, { question_id: coding, section: 1, type: "coding" }])]);
  await db.query("INSERT INTO attempt_answers (attempt_id, question_id, org_id, language, code, seq) VALUES ($1, $2, $3, 'python', $4, 3)", [attempt, coding, org, "def f():\n  return 1"]);
  // Saved out of order on purpose: the log must come back ordered by seq.
  await db.query(`INSERT INTO edit_history (attempt_id, question_id, org_id, seq, events) VALUES
    ($1, $2, $3, 2, '[{"t":3,"op":"ins","at":10,"text":"return 1"}]'),
    ($1, $2, $3, 1, '[{"t":1,"op":"ins","at":8,"text":" "},{"t":2,"op":"ins","at":9,"text":" "}]')`, [attempt, coding, org]);
  await db.query("INSERT INTO edit_history (attempt_id, org_id, seq, kind, meta, events) VALUES ($1, $2, 9, 'integrity', '{\"type\":\"second_session\"}', '[]')", [attempt, org]);
});

describe("code replay access and content (R2.7)", () => {
  it("staff get the coding questions only, with starter code, final answer and the log in order", async () => {
    const r = await replay(u.tpo);
    expect(r?.attempt_id).toBe(attempt);
    expect(r?.questions).toHaveLength(1);
    const q = r!.questions[0];
    expect(q).toMatchObject({ question_id: coding, title: "Two sum", languages: ["python"], final_code: "def f():\n  return 1", truncated: false });
    expect(q.events.map((e) => e.text)).toEqual([" ", " ", "return 1"]);
  });

  it("the student can't replay their own attempt; another college can't either", async () => {
    await asUser(db, u.student, async (tx) => {
      expect(await expectRejected(tx, "SELECT public.b2b_attempt_code_replay($1)", [attempt])).toMatch(/FORBIDDEN/);
    });
    await asUser(db, u.otherTpo, async (tx) => {
      expect(await expectRejected(tx, "SELECT public.b2b_drive_code_replay($1, $2)", [drive, student])).toMatch(/FORBIDDEN/);
    });
    await asUser(db, u.otherTpo, async (tx) => {
      // "no attempt" and "not yours" look the same from outside
      expect(await expectRejected(tx, "SELECT public.b2b_drive_code_replay($1, $2)", [drive, otherStudent])).toMatch(/FORBIDDEN/);
    });
  });

  it("a student who hasn't started has no replay", async () => {
    expect(await replay(u.tpo, otherStudent)).toBeNull();
  });
});
