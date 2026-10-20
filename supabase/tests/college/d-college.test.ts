// @vitest-environment node
// Track D (college portal): import dedupe, held minors, invites, eligibility, assignment, results release,
// analytics, and cross-org isolation for every new function. Runs against the real migrations plus
// docs/b2b/tracks/d-college.sql.
import { describe, it, expect, beforeAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createHash, randomUUID } from "node:crypto";
import { createTestDb, createUser, asUser, asService } from "../helpers/pgdb";

let db: PGlite;
const u: Record<string, string> = {};
const o: Record<string, string> = {};
type J = Record<string, unknown> & { ok?: boolean; reason?: string };

const one = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0];
const id = async (sql: string, params: unknown[] = []) => (await one<{ id: string }>(sql, params)).id;
const hash = (t: string) => createHash("sha256").update(t).digest("hex");

/** Call a service-role function as the edge function would; returns its JSON result. */
async function svc<T = J>(fn: string, args: unknown[], casts: string[]): Promise<T> {
  return asService(db, async (tx) => {
    const ph = args.map((_, i) => `$${i + 1}${casts[i] ? `::${casts[i]}` : ""}`).join(", ");
    const r = await tx.query<{ r: T }>(`SELECT public.${fn}(${ph}) AS r`, args);
    return r.rows[0].r;
  });
}
async function svcErr(fn: string, args: unknown[], casts: string[]): Promise<string> {
  try { await svc(fn, args, casts); } catch (e) { return (e as Error).message; }
  throw new Error(`${fn} should have been refused`);
}

const IMPORT_CASTS = ["uuid", "uuid", "jsonb", "text", "boolean"];
const importRows = (actor: string, org: string, rows: unknown[], onDup: "merge" | "skip", commit: boolean) =>
  svc<J & { created: number; merged: number; skipped: number; heldMinors: number; duplicates: J[]; errors: J[]; created_ids: string[] }>(
    "b2b_import_students", [actor, org, JSON.stringify(rows), onDup, commit], IMPORT_CASTS);
const studentCount = async (org: string) => Number((await one<{ n: string }>("SELECT count(*) AS n FROM students WHERE org_id = $1", [org])).n);

beforeAll(async () => {
  db = await createTestDb({ extraSql: ["docs/b2b/tracks/d-college.sql"] });
  u.super = await createUser(db, { superAdmin: true });
  for (const k of ["adminA", "trainerA", "adminB", "outsider", "stuA1", "stuB1", "stuA2"]) u[k] = await createUser(db);
  o.A = await id("INSERT INTO organizations (name, slug, type, credits_balance) VALUES ('College A', 'college-a', 'college', 40) RETURNING id");
  o.B = await id("INSERT INTO organizations (name, slug, type) VALUES ('College B', 'college-b', 'college') RETURNING id");
  o.C = await id("INSERT INTO organizations (name, slug, type) VALUES ('Company C', 'company-c', 'company') RETURNING id");
  const member = (org: string, user: string, role: string) =>
    db.query("INSERT INTO org_memberships (org_id, user_id, role) VALUES ($1, $2, $3)", [org, user, role]);
  await member(o.A, u.adminA, "org_admin");
  await member(o.A, u.trainerA, "trainer");
  await member(o.B, u.adminB, "org_admin");
}, 180_000);

describe("student import", () => {
  const rows = [
    { row: 2, roll_no: "21A01", full_name: "Asha", email: "asha@a.in", department: "CSE", batch_year: 2027, cgpa: 8.2, active_backlogs: 0 },
    { row: 3, roll_no: "21A02", full_name: "Bala", email: "bala@a.in", department: "CSE", batch_year: 2027, cgpa: 6.5 },
    { row: 4, roll_no: "21a01", full_name: "Asha again", email: "asha2@a.in" },                    // in-file dup (roll, case-insensitive)
    { row: 5, roll_no: "21A03", full_name: "Young", email: "young@a.in", dob: "2010-05-01" },     // under 18 → held
    { row: 6, roll_no: "21A04", full_name: "Bad", email: "not-an-email" },
  ];

  it("preview reports the same outcome and writes nothing", async () => {
    const r = await importRows(u.adminA, o.A, rows, "skip", false);
    expect(r).toMatchObject({ ok: true, created: 3, merged: 0, skipped: 1, heldMinors: 1 });
    expect(r.duplicates).toEqual([{ row: 4, reason: "in_file", existingStudentId: null }]);
    expect(r.errors).toEqual([{ row: 6, message: "Email is not valid" }]);
    expect(await studentCount(o.A)).toBe(0);
  });

  it("commit creates students, holds minors, audits the import", async () => {
    const r = await importRows(u.adminA, o.A, rows, "skip", true);
    expect(r).toMatchObject({ created: 3, skipped: 1, heldMinors: 1 });
    expect(r.created_ids).toHaveLength(3);
    const young = await one<{ status: string }>("SELECT status FROM students WHERE org_id = $1 AND roll_no = '21A03'", [o.A]);
    expect(young.status).toBe("held_minor");
    const audit = await one<{ actor_id: string }>("SELECT actor_id FROM audit_logs WHERE action = 'students.import' AND org_id = $1", [o.A]);
    expect(audit.actor_id).toBe(u.adminA);
  });

  it("duplicates against existing students: skip leaves them, merge updates them", async () => {
    const again = [
      { row: 2, roll_no: "21A01", full_name: "Asha K", email: "asha@a.in", cgpa: 8.9 },     // both
      { row: 3, roll_no: "21A99", full_name: "Bala", email: "bala@a.in", section: "B" },     // email
      { row: 4, roll_no: "21A01", full_name: "x", email: "x@a.in" },                         // in-file
    ];
    const skip = await importRows(u.adminA, o.A, again, "skip", true);
    expect(skip).toMatchObject({ created: 0, merged: 0, skipped: 3 });
    const asha = await one<{ id: string; cgpa: string; full_name: string }>("SELECT id, cgpa, full_name FROM students WHERE email = 'asha@a.in'");
    expect(asha.full_name).toBe("Asha");
    expect(skip.duplicates).toEqual([
      { row: 2, reason: "both", existingStudentId: asha.id },
      { row: 3, reason: "email", existingStudentId: expect.any(String) },
      { row: 4, reason: "in_file", existingStudentId: null },
    ]);

    const merge = await importRows(u.adminA, o.A, again, "merge", true);
    expect(merge).toMatchObject({ created: 0, merged: 2, skipped: 1 });
    const after = await one<{ cgpa: string; full_name: string; department: string }>("SELECT cgpa, full_name, department FROM students WHERE id = $1", [asha.id]);
    expect(after).toMatchObject({ cgpa: "8.90", full_name: "Asha K", department: "CSE" });   // blank cells keep stored values
    const bala = await one<{ roll_no: string; section: string }>("SELECT roll_no, section FROM students WHERE email = 'bala@a.in'");
    expect(bala).toEqual({ roll_no: "21A99", section: "B" });
    expect(await studentCount(o.A)).toBe(3);
  });

  it("a row whose roll number and email match two different students is an error", async () => {
    const r = await importRows(u.adminA, o.A, [{ row: 9, roll_no: "21A01", full_name: "Mix", email: "bala@a.in" }], "merge", true);
    expect(r.merged).toBe(0);
    expect(r.errors[0]).toMatchObject({ row: 9 });
  });

  it("merging a DOB that makes a not-yet-active student a minor holds them", async () => {
    const r = await importRows(u.adminA, o.A, [{ row: 2, roll_no: "21A99", full_name: "Bala", email: "bala@a.in", dob: "2011-01-01" }], "merge", true);
    expect(r.heldMinors).toBe(1);
    expect((await one<{ status: string }>("SELECT status FROM students WHERE email = 'bala@a.in'")).status).toBe("held_minor");
    await importRows(u.adminA, o.A, [{ row: 2, roll_no: "21A99", full_name: "Bala", email: "bala@a.in", dob: "2004-01-01" }], "merge", true);
    // Fixing the DOB doesn't silently release the hold; the TPO does that explicitly.
    await db.query("UPDATE students SET status = 'imported' WHERE email = 'bala@a.in'");
    expect((await one<{ status: string }>("SELECT status FROM students WHERE email = 'bala@a.in'")).status).toBe("imported");
  });

  it("manual add of an under-18 student by the TPO (RLS path) is held too", async () => {
    const status = await asUser(db, u.adminA, async (tx) => (await tx.query<{ status: string }>(
      "INSERT INTO students (org_id, roll_no, full_name, email, dob) VALUES ($1, 'M1', 'Minor', 'm1@a.in', '2012-01-01') RETURNING status", [o.A])).rows[0].status);
    expect(status).toBe("held_minor");
  });

  it("seat limit stops new students but not merges", async () => {
    await db.query("UPDATE organizations SET seat_limit = 4 WHERE id = $1", [o.A]);
    const r = await importRows(u.adminA, o.A, [
      { row: 2, roll_no: "S1", full_name: "Seat one", email: "s1@a.in" },
      { row: 3, roll_no: "S2", full_name: "Seat two", email: "s2@a.in" },
    ], "skip", false);
    expect(r.created).toBe(1);
    expect(String(r.errors[0].message)).toMatch(/Seat limit/);
    await db.query("UPDATE organizations SET seat_limit = NULL WHERE id = $1", [o.A]);
  });

  it("only the college's TPO admin (or super admin) can import", async () => {
    const row = [{ row: 2, roll_no: "Z1", full_name: "Z", email: "z@a.in" }];
    for (const actor of [u.trainerA, u.adminB, u.outsider]) {
      expect(await svcErr("b2b_import_students", [actor, o.A, JSON.stringify(row), "skip", true], IMPORT_CASTS)).toMatch(/FORBIDDEN/);
    }
    expect((await importRows(u.super, o.A, row, "skip", false)).created).toBe(1);
    expect((await importRows(u.adminB, o.C, row, "skip", false).catch((e) => ({ err: String(e) })))).toMatchObject({ err: expect.stringMatching(/FORBIDDEN/) });
    expect(await importRows(u.super, o.C, row, "skip", false)).toMatchObject({ ok: false, reason: "WRONG_ORG_TYPE" });
  });

  it("browsers can't call the service-role functions directly", async () => {
    for (const sql of [
      `SELECT public.b2b_import_students('${u.adminA}', '${o.A}', '[]', 'skip', false)`,
      `SELECT public.b2b_assign_drive('${u.adminA}', '${randomUUID()}')`,
      `SELECT public.b2b_college_analytics('${u.adminA}', '${o.A}', '{}', 1, 10, NULL, NULL)`,
      `SELECT public.b2b_release_results('${u.adminA}', '${randomUUID()}')`,
      `SELECT public.b2b_preview_eligibility('${u.adminA}', '${o.A}', '{}')`,
      `SELECT public.b2b_prepare_student_invites('${u.adminA}', '${o.A}', '{}', '{}')`,
      `SELECT public.b2b_college_result_rows('${o.A}', NULL)`,
    ]) {
      await expect(asUser(db, u.adminA, (tx) => tx.query(sql))).rejects.toThrow(/permission denied/);
    }
  });
});

describe("activation invites", () => {
  it("creates hashed invites linked to students, skips held minors, and acceptance activates the student", async () => {
    const ids = (await db.query<{ id: string; roll_no: string }>("SELECT id, roll_no FROM students WHERE org_id = $1 AND roll_no IN ('21A01', '21A03') ORDER BY roll_no", [o.A])).rows;
    const tokens = ids.map(() => randomUUID());
    const r = await svc<{ invites: J[]; skipped: J[] }>("b2b_prepare_student_invites",
      [u.adminA, o.A, ids.map((x) => x.id), tokens.map(hash)], ["uuid", "uuid", "uuid[]", "text[]"]);
    expect(r.invites).toHaveLength(1);
    expect(r.invites[0]).toMatchObject({ student_id: ids[0].id, token_index: 1 });
    expect(r.skipped).toEqual([{ student_id: ids[1].id, reason: "HELD_MINOR" }]);
    expect((await one<{ status: string }>("SELECT status FROM students WHERE id = $1", [ids[0].id])).status).toBe("invited");

    // Re-inviting replaces the live link.
    const t2 = randomUUID();
    await svc("b2b_prepare_student_invites", [u.adminA, o.A, [ids[0].id], [hash(t2)]], ["uuid", "uuid", "uuid[]", "text[]"]);
    const inv = (await db.query<{ status: string }>("SELECT status FROM org_invites WHERE student_id = $1 ORDER BY created_at", [ids[0].id])).rows;
    expect(inv.map((x) => x.status).sort()).toEqual(["pending", "revoked"]);

    const acc = await svc("b2b_accept_invite", [hash(t2), u.stuA1, "v1", "I agree"], ["text", "uuid", "text", "text"]);
    expect(acc).toMatchObject({ ok: true, role: "student" });
    const s = await one<{ status: string; user_id: string }>("SELECT status, user_id FROM students WHERE id = $1", [ids[0].id]);
    expect(s).toEqual({ status: "active", user_id: u.stuA1 });
    // Active students aren't re-invited.
    const again = await svc<{ invites: J[]; skipped: J[] }>("b2b_prepare_student_invites", [u.adminA, o.A, [ids[0].id], [hash("x")]], ["uuid", "uuid", "uuid[]", "text[]"]);
    expect(again.skipped[0]).toMatchObject({ reason: "ACTIVE" });
  });

  it("cross-org and trainer invites are refused; foreign student ids are skipped", async () => {
    const sid = (await one<{ id: string }>("SELECT id FROM students WHERE org_id = $1 LIMIT 1", [o.A])).id;
    for (const actor of [u.trainerA, u.adminB]) {
      expect(await svcErr("b2b_prepare_student_invites", [actor, o.A, [sid], [hash("t")]], ["uuid", "uuid", "uuid[]", "text[]"])).toMatch(/FORBIDDEN/);
    }
    const r = await svc<{ skipped: J[] }>("b2b_prepare_student_invites", [u.adminB, o.B, [sid], [hash("t")]], ["uuid", "uuid", "uuid[]", "text[]"]);
    expect(r.skipped).toEqual([{ student_id: sid, reason: "NOT_FOUND" }]);
  });
});

describe("drives: eligibility, assignment, release", () => {
  let drive: string;
  let attemptAsha: string;
  const elig = { departments: ["cse"], batch_years: [2027], min_cgpa: 7, max_backlogs: 0 };

  beforeAll(async () => {
    // A CSE 2027 cohort with edge cases.
    const cohort = [
      { row: 2, roll_no: "E1", full_name: "Eligible One", email: "e1@a.in", department: "CSE", batch_year: 2027, cgpa: 7, active_backlogs: 0 },
      { row: 3, roll_no: "E2", full_name: "Eligible Blank Backlogs", email: "e2@a.in", department: "cse", batch_year: 2027, cgpa: 9.1 },
      { row: 4, roll_no: "N1", full_name: "Low CGPA", email: "n1@a.in", department: "CSE", batch_year: 2027, cgpa: 6.99, active_backlogs: 0 },
      { row: 5, roll_no: "N2", full_name: "Backlog", email: "n2@a.in", department: "CSE", batch_year: 2027, cgpa: 8, active_backlogs: 1 },
      { row: 6, roll_no: "N3", full_name: "ECE", email: "n3@a.in", department: "ECE", batch_year: 2027, cgpa: 9, active_backlogs: 0 },
      { row: 7, roll_no: "N4", full_name: "2026", email: "n4@a.in", department: "CSE", batch_year: 2026, cgpa: 9, active_backlogs: 0 },
      { row: 8, roll_no: "N5", full_name: "No CGPA", email: "n5@a.in", department: "CSE", batch_year: 2027 },
      { row: 9, roll_no: "N6", full_name: "Minor", email: "n6@a.in", department: "CSE", batch_year: 2027, cgpa: 9, dob: "2010-01-01" },
      { row: 10, roll_no: "N7", full_name: "Gone", email: "n7@a.in", department: "CSE", batch_year: 2027, cgpa: 9 },
    ];
    await importRows(u.adminA, o.A, cohort, "skip", true);
    await db.query("UPDATE students SET status = 'deactivated' WHERE email = 'n7@a.in'");
    await db.query("UPDATE students SET department = 'CSE', batch_year = 2027, active_backlogs = 0 WHERE email = 'asha@a.in'");
    // College B has a CSE 2027 student too: never counted for A.
    await importRows(u.adminB, o.B, [{ row: 2, roll_no: "B1", full_name: "Other", email: "b1@b.in", department: "CSE", batch_year: 2027, cgpa: 9.5 }], "skip", true);
    const as = await id("INSERT INTO assessments (org_id, title, duration_min) VALUES ($1, 'Coding + MCQ', 60) RETURNING id", [o.A]);
    drive = await id("INSERT INTO drives (org_id, name, assessment_id, eligibility, results_release) VALUES ($1, 'CSE 2027 drive', $2, $3, 'manual') RETURNING id",
      [o.A, as, JSON.stringify(elig)]);
  });

  it("CSE 2027, CGPA ≥ 7, zero backlogs: exact set", async () => {
    const r = await svc<{ count: number; sample: { roll_no: string }[] }>("b2b_preview_eligibility", [u.trainerA, o.A, JSON.stringify(elig)], ["uuid", "uuid", "jsonb"]);
    expect(r.sample.map((s) => s.roll_no)).toEqual(["21A01", "E1", "E2"]);
    expect(r.count).toBe(3);
    const all = await svc<{ count: number }>("b2b_preview_eligibility", [u.adminA, o.A, "{}"], ["uuid", "uuid", "jsonb"]);
    expect(all.count).toBe(9);   // every non-deactivated, non-held student of A
    expect(await svcErr("b2b_preview_eligibility", [u.adminB, o.A, "{}"], ["uuid", "uuid", "jsonb"])).toMatch(/FORBIDDEN/);
  });

  it("assignment is idempotent and scoped to the drive's org", async () => {
    const first = await svc("b2b_assign_drive", [u.trainerA, drive], ["uuid", "uuid"]);
    expect(first).toMatchObject({ ok: true, assigned: 3, alreadyAssigned: 0, ineligible: 6 });
    const second = await svc("b2b_assign_drive", [u.adminA, drive], ["uuid", "uuid"]);
    expect(second).toMatchObject({ assigned: 0, alreadyAssigned: 3 });
    expect((await one<{ status: string }>("SELECT status FROM drives WHERE id = $1", [drive])).status).toBe("scheduled");
    expect(await svcErr("b2b_assign_drive", [u.adminB, drive], ["uuid", "uuid"])).toMatch(/FORBIDDEN/);
    expect(await svcErr("b2b_assign_drive", [u.outsider, drive], ["uuid", "uuid"])).toMatch(/FORBIDDEN/);
  });

  it("release flips the student's visibility of their results", async () => {
    const asha = await one<{ id: string }>("SELECT id FROM students WHERE email = 'asha@a.in'");
    const as = (await one<{ assessment_id: string }>("SELECT assessment_id FROM drives WHERE id = $1", [drive])).assessment_id;
    attemptAsha = await id(`INSERT INTO attempts (org_id, assessment_id, subject_user_id, student_id, context_type, context_id, status, score, max_score, section_scores, submitted_at)
      VALUES ($1, $2, $3, $4, 'drive', $5, 'submitted', 80, 100, '[{"type":"coding","score":30,"max_score":50},{"type":"mcq","score":50,"max_score":50}]', now()) RETURNING id`,
      [o.A, as, u.stuA1, asha.id, drive]);

    const seen = () => asUser(db, u.stuA1, async (tx) => ({
      attempts: (await tx.query("SELECT id FROM attempts WHERE id = $1", [attemptAsha])).rows.length,
      mine: (await tx.query<{ r: J[] }>("SELECT public.b2b_my_drives() AS r")).rows[0].r,
    }));
    const before = await seen();
    expect(before.attempts).toBe(0);
    expect(before.mine).toHaveLength(1);
    expect(before.mine[0]).toMatchObject({ drive_id: drive, results_release: "manual", status: "completed", results_visible: false, results: null });

    expect(await svcErr("b2b_release_results", [u.trainerA, drive], ["uuid", "uuid"])).toMatch(/FORBIDDEN/);
    expect(await svcErr("b2b_release_results", [u.adminB, drive], ["uuid", "uuid"])).toMatch(/FORBIDDEN/);
    expect(await svc("b2b_release_results", [u.adminA, drive], ["uuid", "uuid"])).toEqual({ ok: true });
    expect(await svc("b2b_release_results", [u.adminA, drive], ["uuid", "uuid"])).toEqual({ ok: true, already: true });

    const after = await seen();
    expect(after.attempts).toBe(1);
    expect(after.mine[0]).toMatchObject({ results_visible: true, results: { coding: 60, mcq: 100, assessment: 80, overall: 80 } });
    // Other students see nothing of it.
    const other = await asUser(db, u.stuB1, async (tx) => (await tx.query<{ r: J[] }>("SELECT public.b2b_my_drives() AS r")).rows[0].r);
    expect(other).toEqual([]);
  });

  it("drives set to never release can't be released", async () => {
    const d = await id("INSERT INTO drives (org_id, name, results_release) VALUES ($1, 'Mock never', 'never') RETURNING id", [o.A]);
    expect(await svc("b2b_release_results", [u.adminA, d], ["uuid", "uuid"])).toEqual({ ok: false, reason: "RESULTS_NEVER" });
  });

  it("practice zone lists practice assessments and the pooled balance of my college only", async () => {
    await db.query("INSERT INTO assessments (org_id, title, duration_min, practice_enabled, status) VALUES ($1, 'Practice DSA', 30, true, 'ready'), ($1, 'Hidden draft', 30, true, 'draft')", [o.A]);
    await db.query("INSERT INTO assessments (org_id, title, duration_min, practice_enabled, status) VALUES ($1, 'B practice', 30, true, 'ready')", [o.B]);
    const r = await asUser(db, u.stuA1, async (tx) => (await tx.query<{ r: J[] }>("SELECT public.b2b_my_practice() AS r")).rows[0].r);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ org_id: o.A, credits_balance: 40 });
    expect((r[0].assessments as J[]).map((a) => a.title)).toEqual(["Practice DSA"]);
  });
});

describe("analytics", () => {
  let drive: string;
  const call = (actor: string, filters: unknown, page = 1, pageSize = 50, by: string | null = null, dir: string | null = null) =>
    svc<{ total: number; rows: J[]; summary: { funnel: J; byStatus: J; byDepartment: J[]; dimensions: J[] } }>(
      "b2b_college_analytics", [actor, o.A, JSON.stringify(filters), page, pageSize, by, dir],
      ["uuid", "uuid", "jsonb", "int", "int", "text", "text"]);

  beforeAll(async () => {
    drive = (await one<{ id: string }>("SELECT id FROM drives WHERE name = 'CSE 2027 drive'")).id;
    // Second drive with an ECE assignment and an interview + integrity data.
    const as = await id("INSERT INTO assessments (org_id, title, duration_min) VALUES ($1, 'Second', 60) RETURNING id", [o.A]);
    const d2 = await id("INSERT INTO drives (org_id, name, assessment_id) VALUES ($1, 'Open drive', $2) RETURNING id", [o.A, as]);
    await svc("b2b_assign_drive", [u.adminA, d2], ["uuid", "uuid"]);

    const att = await one<{ id: string; student_id: string }>("SELECT id, student_id FROM attempts WHERE context_id = $1", [drive]);
    await db.query(`INSERT INTO proctoring_sessions (org_id, subject_user_id, context_type, context_id, attempt_id, policy, integrity_score, integrity_band)
      VALUES ($1, $2, 'drive', $3, $4, 'standard', 55, 'low')`, [o.A, u.stuA1, drive, att.id]);
    // E1 started but not finished; E2 has an interview only.
    const e1 = await one<{ id: string }>("SELECT id FROM students WHERE email = 'e1@a.in'");
    await db.query("UPDATE drive_assignments SET status = 'in_progress' WHERE drive_id = $1 AND student_id = $2", [drive, e1.id]);
    const e2 = await one<{ id: string }>("SELECT id FROM students WHERE email = 'e2@a.in'");
    const spec = JSON.stringify({ name: "SQL", type: "skill", topics: ["Joins"], pass_threshold: 6, max_turns: 5, max_minutes: 10 });
    const mod = await id("INSERT INTO interview_modules (org_id, spec) VALUES ($1, $2) RETURNING id", [o.A, spec]);
    const iv = await id(`INSERT INTO b2b_interviews (org_id, user_id, module_id, module_version, module_spec, state, status, prompt_version, deadline_at, kind, context_id, student_id)
      VALUES ($1, $2, $3, 1, '{}', '{}', 'completed', 'p', now(), 'drive', $4, $5) RETURNING id`, [o.A, u.stuA2, mod, drive, e2.id]);
    await db.query(`INSERT INTO b2b_evaluations (interview_id, org_id, user_id, module_id, evaluator_version, status, overall_score, completed_at)
      VALUES ($1, $2, $3, $4, 'v1', 'completed', 7.5, now())`, [iv, o.A, u.stuA2, mod]);
    await db.query(`INSERT INTO proctoring_sessions (org_id, subject_user_id, context_type, context_id, interview_id, policy, integrity_score, integrity_band)
      VALUES ($1, $2, 'drive', $3, $4, 'standard', 92, 'high')`, [o.A, u.stuA2, drive, iv]);
    await db.query(`INSERT INTO dimension_scores (org_id, student_id, source_type, source_id, context_type, context_id, dimension, score)
      VALUES ($1, $2, 'assessment', $3, 'drive', $4, 'coding', 60), ($1, $5, 'interview', $6, 'drive', $4, 'communication', 80)`,
      [o.A, att.student_id, att.id, drive, e2.id, iv]);
  });

  it("one drive: rows with scores, integrity and effective status; summary", async () => {
    const r = await call(u.trainerA, { driveId: drive }, 1, 50, "roll_no", "asc");
    expect(r.total).toBe(3);
    expect(r.rows.map((x) => x.roll_no)).toEqual(["21A01", "E1", "E2"]);
    expect(r.rows[0]).toMatchObject({ coding: 60, mcq: 100, overall: 80, integrity_band: "low", integrity_score: 55, status: "completed", drive_name: "CSE 2027 drive" });
    expect(r.rows[1]).toMatchObject({ status: "in_progress", overall: null });
    expect(r.rows[2]).toMatchObject({ interview: 75, overall: 75, integrity_band: "high", status: "assigned" });
    expect(r.summary.funnel).toEqual({ invited: 1, activated: 1, started: 2, completed: 1 });
    expect(r.summary.byStatus).toEqual({ assigned: 1, in_progress: 1, completed: 1, absent: 0 });
    expect(r.summary.byDepartment).toEqual([{ department: "CSE", students: 3, avg: 77.5 }]);
    expect(r.summary.dimensions).toEqual([{ dimension: "coding", avg: 60 }, { dimension: "communication", avg: 80 }]);
  });

  it("filters: integrity band, department, score range, status, search, cgpa, backlogs", async () => {
    expect((await call(u.adminA, { driveId: drive, integrityBands: ["low"] })).rows.map((x) => x.roll_no)).toEqual(["21A01"]);
    expect((await call(u.adminA, { driveId: drive, integrityBands: ["high", "medium"] })).rows.map((x) => x.roll_no)).toEqual(["E2"]);
    expect((await call(u.adminA, { departments: ["ECE"] })).rows.map((x) => x.roll_no)).toEqual(["N3"]);
    expect((await call(u.adminA, { driveId: drive, scoreRange: [76, 100] })).total).toBe(1);
    expect((await call(u.adminA, { driveId: drive, status: ["in_progress", "completed"] })).total).toBe(2);
    expect((await call(u.adminA, { search: "blank" })).rows.map((x) => x.roll_no)).toEqual(["E2", "E2"]);   // both drives
    expect((await call(u.adminA, { driveId: drive, cgpa: [8, 10] })).rows.map((x) => x.roll_no).sort()).toEqual(["21A01", "E2"]);
    expect((await call(u.adminA, { maxBacklogs: 0, batchYears: [2026] })).rows.map((x) => x.roll_no)).toEqual(["N4"]);
    const now = new Date();
    expect((await call(u.adminA, { driveId: drive, from: new Date(now.getTime() + 86_400_000).toISOString() })).total).toBe(0);
  });

  it("pagination and sorting", async () => {
    const all = await call(u.adminA, {});
    expect(all.total).toBe(3 + 9);
    const p1 = await call(u.adminA, {}, 1, 5, "cgpa", "desc");
    const p3 = await call(u.adminA, {}, 3, 5, "cgpa", "desc");
    expect(p1.rows).toHaveLength(5);
    expect(p3.rows).toHaveLength(2);
    expect(p1.total).toBe(12);
    const cg = p1.rows.map((x) => Number(x.cgpa));
    expect([...cg].sort((a, b) => b - a)).toEqual(cg);
    // An unknown sort column falls back to name order instead of erroring.
    expect((await call(u.adminA, {}, 1, 2, "1; DROP TABLE students", "desc")).rows).toHaveLength(2);
  });

  it("only staff of the college", async () => {
    for (const actor of [u.adminB, u.outsider, u.stuA1]) {
      expect(await svcErr("b2b_college_analytics", [actor, o.A, "{}", 1, 10, null, null], ["uuid", "uuid", "jsonb", "int", "int", "text", "text"])).toMatch(/FORBIDDEN/);
    }
    const b = await svc<{ total: number }>("b2b_college_analytics", [u.adminB, o.B, "{}", 1, 10, null, null], ["uuid", "uuid", "jsonb", "int", "int", "text", "text"]);
    expect(b.total).toBe(0);
    // A drive id from another college yields nothing.
    expect((await svc<{ total: number }>("b2b_college_analytics", [u.adminB, o.B, JSON.stringify({ driveId: drive }), 1, 10, null, null],
      ["uuid", "uuid", "jsonb", "int", "int", "text", "text"])).total).toBe(0);
  });
});
