// @vitest-environment node
// Drive completion across tracks C and D: finishing the interview completes the drive assignment only once the
// drive's test (if any) is also finished (trigger in 20261021000009_b2b_v1_interview.sql).
import { beforeAll, describe, expect, it } from "vitest";
import { buildFixture, type Fixture } from "../helpers/interview-v1-fixture";

let f: Fixture;

beforeAll(async () => {
  f = await buildFixture();
}, 120_000);

async function interview(driveId: string, status = "in_progress"): Promise<string> {
  const r = await f.one<{ id: string }>(
    `INSERT INTO b2b_interviews (org_id, user_id, student_id, kind, context_id, module_spec, state, prompt_version, deadline_at, status)
     VALUES ($1, $2, $3, 'drive', $4, '{}'::jsonb, '{}'::jsonb, 'test', now() + interval '1 hour', $5::b2b_interview_status) RETURNING id`,
    [f.o.A, f.u.stuA, f.ids.sA, driveId, status]);
  return r.id;
}

async function assignment(driveId: string) {
  return f.one<{ status: string; interview_id: string | null; completed_at: string | null }>(
    "SELECT status, interview_id, completed_at FROM drive_assignments WHERE drive_id = $1 AND student_id = $2", [driveId, f.ids.sA]);
}

async function driveWithTest(name: string): Promise<string> {
  const a = await f.one<{ id: string }>(
    "INSERT INTO assessments (org_id, title, duration_min, status) VALUES ($1, $2, 30, 'ready') RETURNING id", [f.o.A, name]);
  const d = await f.one<{ id: string }>(
    `INSERT INTO drives (org_id, name, assessment_id, interview_module_id, status) VALUES ($1, $2, $3, $4, 'live') RETURNING id`,
    [f.o.A, name, a.id, f.ids.module]);
  await f.db.query("INSERT INTO drive_assignments (drive_id, org_id, student_id) VALUES ($1, $2, $3)", [d.id, f.o.A, f.ids.sA]);
  return d.id;
}

describe("drive completion when the interview ends", () => {
  it("interview-only drive: completing the interview completes the assignment", async () => {
    const iv = await interview(f.ids.drive);
    expect((await assignment(f.ids.drive)).status).toBe("assigned");
    await f.db.query("UPDATE b2b_interviews SET status = 'completed' WHERE id = $1", [iv]);
    const a = await assignment(f.ids.drive);
    expect(a.status).toBe("completed");
    expect(a.interview_id).toBe(iv);
    expect(a.completed_at).not.toBeNull();
  });

  it("drive with a test: the interview alone does not complete it", async () => {
    const drive = await driveWithTest("Test pending");
    const iv = await interview(drive);
    await f.db.query("UPDATE b2b_interviews SET status = 'completed' WHERE id = $1", [iv]);
    expect((await assignment(drive)).status).toBe("assigned");
  });

  it("drive with a submitted test: completing the interview completes it", async () => {
    const drive = await driveWithTest("Test done");
    const asmt = await f.one<{ assessment_id: string }>("SELECT assessment_id FROM drives WHERE id = $1", [drive]);
    await f.db.query(
      `INSERT INTO attempts (org_id, assessment_id, subject_user_id, student_id, context_type, context_id, status)
       VALUES ($1, $2, $3, $4, 'drive', $5, 'submitted')`, [f.o.A, asmt.assessment_id, f.u.stuA, f.ids.sA, drive]);
    const iv = await interview(drive);
    await f.db.query("UPDATE b2b_interviews SET status = 'abandoned' WHERE id = $1", [iv]);
    expect((await assignment(drive)).status).toBe("completed");
  });
});
