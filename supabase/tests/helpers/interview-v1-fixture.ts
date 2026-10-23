// Shared fixture for track C (interview V1) DB and handler tests: two colleges, one company, a drive with an
// interview module, a job role with a skills matrix, and the people around them. Applies supabase/migrations/20261021000009_b2b_v1_interview.sql.
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb, createUser, asService } from "./pgdb";

export interface Fixture {
  db: PGlite;
  u: Record<string, string>;
  o: Record<string, string>;
  ids: Record<string, string>;
  svc: <T = Record<string, unknown>>(fn: string, args: Record<string, unknown>) => Promise<T>;
  one: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<T>;
}

const SPEC = { name: "CSE interview", type: "skill", topics: ["Self-introduction", "OOP", "DBMS"], pass_threshold: 6, max_turns: 8, max_minutes: 15 };

/** Call a service-role function with named arguments, as the edge function's rpc() does. */
export function namedCall(db: PGlite) {
  return async <T = Record<string, unknown>>(fn: string, args: Record<string, unknown>): Promise<T> =>
    asService(db, async (tx) => {
      const keys = Object.keys(args);
      const ph = keys.map((k, i) => `${k} => $${i + 1}`).join(", ");
      const vals = keys.map((k) => {
        const v = args[k];
        return v !== null && typeof v === "object" ? JSON.stringify(v) : v;
      });
      const r = await tx.query<{ r: T }>(`SELECT to_jsonb(public.${fn}(${ph})) AS r`, vals);
      return r.rows[0].r;
    });
}

export async function buildFixture(): Promise<Fixture> {
  const db = await createTestDb();
  const one = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0];
  const id = async (sql: string, params: unknown[] = []) => (await one<{ id: string }>(sql, params)).id;
  const u: Record<string, string> = {};
  const o: Record<string, string> = {};
  const ids: Record<string, string> = {};
  u.super = await createUser(db, { superAdmin: true });
  for (const k of ["tpoA", "tpoB", "stuA", "stuA2", "stuB", "recC", "candC", "candC2", "hmC", "outsider"]) u[k] = await createUser(db);

  o.A = await id("INSERT INTO organizations (name, slug, type) VALUES ('SVR Engineering College', 'svr', 'college') RETURNING id");
  o.B = await id("INSERT INTO organizations (name, slug, type) VALUES ('College B', 'college-b', 'college') RETURNING id");
  o.C = await id("INSERT INTO organizations (name, slug, type) VALUES ('Acme Labs', 'acme', 'company') RETURNING id");
  const member = (org: string, user: string, role: string, name: string | null = null) =>
    db.query("INSERT INTO org_memberships (org_id, user_id, role, full_name) VALUES ($1, $2, $3, $4)", [org, user, role, name]);
  await member(o.A, u.tpoA, "org_admin");
  await member(o.B, u.tpoB, "org_admin");
  await member(o.A, u.stuA, "student", "Asha Reddy");
  await member(o.A, u.stuA2, "student");
  await member(o.B, u.stuB, "student");
  await member(o.C, u.recC, "recruiter");
  await member(o.C, u.hmC, "hiring_manager");

  const student = (org: string, user: string, roll: string, name: string) =>
    id("INSERT INTO students (org_id, user_id, roll_no, full_name, email, status) VALUES ($1, $2, $3, $4, $5, 'active') RETURNING id",
      [org, user, roll, name, `${roll.toLowerCase()}@x.in`]);
  ids.sA = await student(o.A, u.stuA, "A01", "Asha Reddy");
  ids.sA2 = await student(o.A, u.stuA2, "A02", "Bala K");
  ids.sB = await student(o.B, u.stuB, "B01", "Chitra");

  ids.module = await id("INSERT INTO interview_modules (org_id, spec) VALUES ($1, $2) RETURNING id", [o.A, JSON.stringify(SPEC)]);
  ids.moduleB = await id("INSERT INTO interview_modules (org_id, spec) VALUES ($1, $2) RETURNING id", [o.B, JSON.stringify(SPEC)]);
  ids.drive = await id(
    "INSERT INTO drives (org_id, name, interview_module_id, status, window_start, window_end, results_release) VALUES ($1, 'CSE 2027 drive', $2, 'live', now() - interval '1 hour', now() + interval '1 day', 'manual') RETURNING id",
    [o.A, ids.module]);
  ids.driveClosed = await id(
    "INSERT INTO drives (org_id, name, interview_module_id, status, window_start, window_end) VALUES ($1, 'Old drive', $2, 'live', now() - interval '3 days', now() - interval '1 day') RETURNING id",
    [o.A, ids.module]);
  ids.driveNoIv = await id("INSERT INTO drives (org_id, name, status) VALUES ($1, 'No interview', 'live') RETURNING id", [o.A]);
  ids.driveB = await id("INSERT INTO drives (org_id, name, interview_module_id, status) VALUES ($1, 'B drive', $2, 'live') RETURNING id", [o.B, ids.moduleB]);
  for (const [drive, sid, org] of [[ids.drive, ids.sA, o.A], [ids.driveClosed, ids.sA, o.A], [ids.driveNoIv, ids.sA, o.A], [ids.driveB, ids.sB, o.B]]) {
    await db.query("INSERT INTO drive_assignments (drive_id, org_id, student_id) VALUES ($1, $2, $3)", [drive, org, sid]);
  }

  ids.role = await id(
    "INSERT INTO job_roles (org_id, title, skills_matrix, seniority, status, hiring_manager_ids) VALUES ($1, 'Backend Engineer', $2, 'junior', 'open', ARRAY[$3]::uuid[]) RETURNING id",
    [o.C, JSON.stringify({ must_have: [{ skill: "Java", weight: 5 }, { skill: "SQL", weight: 4 }], nice_to_have: [{ skill: "Docker", weight: 2 }], seniority: "junior" }), u.hmC]);
  ids.cand = await id("INSERT INTO candidates (org_id, email, full_name, user_id) VALUES ($1, 'ravi@x.in', 'Ravi Kumar', $2) RETURNING id", [o.C, u.candC]);
  ids.cand2 = await id("INSERT INTO candidates (org_id, email, full_name, user_id) VALUES ($1, 'meera@x.in', 'Meera', $2) RETURNING id", [o.C, u.candC2]);
  ids.rc = await id("INSERT INTO role_candidates (org_id, job_role_id, candidate_id) VALUES ($1, $2, $3) RETURNING id", [o.C, ids.role, ids.cand]);

  // A finished coding attempt for the job role, with a hidden test that must never reach the interviewer.
  ids.assessment = await id("INSERT INTO assessments (org_id, title, duration_min, status) VALUES ($1, 'Backend test', 30, 'ready') RETURNING id", [o.C]);
  ids.question = await id(
    "INSERT INTO questions (org_id, type, title, statement, difficulty, languages) VALUES ($1, 'coding', 'Pair sum', 'Count the pairs of numbers that sum to k.', 'easy', '{python}') RETURNING id",
    [o.C]);
  await db.query("INSERT INTO test_cases (question_id, input, expected_output, is_sample) VALUES ($1, 'HIDDEN-INPUT-123', 'HIDDEN-OUT', false)", [ids.question]);
  ids.attempt = await id(
    "INSERT INTO attempts (org_id, assessment_id, subject_user_id, candidate_id, context_type, context_id, status) VALUES ($1, $2, $3, $4, 'job_role', $5, 'submitted') RETURNING id",
    [o.C, ids.assessment, u.candC, ids.cand, ids.role]);
  await db.query(
    "INSERT INTO submissions (attempt_id, question_id, org_id, kind, language, code, status, passed, total) VALUES ($1, $2, $3, 'final', 'python', 'def solve(a, k):\n    seen = set()\n    return 0', 'done', 4, 5)",
    [ids.attempt, ids.question, o.C]);

  return { db, u, o, ids, svc: namedCall(db), one };
}
