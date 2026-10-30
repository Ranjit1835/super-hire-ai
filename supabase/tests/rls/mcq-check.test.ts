// @vitest-environment node
// R2.3 independent MCQ check (migration 0033): verified only by an agreeing check or an audited override.
import { describe, it, expect, beforeAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb, createUser, asUser, asService, expectRejected } from "../helpers/pgdb";

let db: PGlite;
const u: Record<string, string> = {};
let org = "";
const id = async (sql: string, p: unknown[] = []) => (await db.query<{ id: string }>(sql, p)).rows[0].id;
const one = async <T>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows[0];
const svc = async <T = Record<string, unknown>>(sql: string, p: unknown[]) =>
  asService(db, async (tx) => (await tx.query<{ r: T }>(`SELECT ${sql} AS r`, p)).rows[0].r);
const mcq = (title: string, extra: Record<string, unknown> = {}) => ({ org_id: org, type: "mcq", title, difficulty: "easy",
  statement: "A train covers 120 km in 2 hours. What is its speed?", options: [{ id: "a", text: "60 km/h" }, { id: "b", text: "40 km/h" }],
  answer: ["a"], status: "verified", ...extra });
const save = (q: Record<string, unknown>) => asUser(db, u.tpo, async (tx) =>
  (await tx.query<{ r: { ok: boolean; status: string; question_id: string } }>("SELECT public.b2b_save_question($1) AS r", [JSON.stringify(q)])).rows[0].r, { commit: true });
const version = async (q: string) => (await one<{ version: number }>("SELECT version FROM questions WHERE id = $1", [q])).version;
const check = async (q: string, c: Record<string, unknown>, v?: number) =>
  svc("public.b2b_record_mcq_check($1, $2, $3, $4)", [u.tpo, q, v ?? await version(q), JSON.stringify(c)]);
const verify = async (q: string) => svc<{ ok: boolean; status: string }>("public.b2b_record_verification($1, $2, $3, NULL)", [u.tpo, q, await version(q)]);
const status = async (q: string) => (await one<{ status: string }>("SELECT status FROM questions WHERE id = $1", [q])).status;

beforeAll(async () => {
  db = await createTestDb();
  u.tpo = await createUser(db);
  u.outsider = await createUser(db);
  org = await id("INSERT INTO organizations (name, slug, type) VALUES ('Check College', 'check-college', 'college') RETURNING id");
  await db.query("INSERT INTO org_memberships (org_id, user_id, role) VALUES ($1, $2, 'org_admin')", [org, u.tpo]);
});

describe("independent MCQ check (R2.3)", () => {
  it("saving can't mark an MCQ verified; an agreeing, confident check can", async () => {
    const r = await save(mcq("Train speed one"));
    expect(r.status).toBe("draft");
    expect(await verify(r.question_id)).toMatchObject({ status: "draft" });                       // no check yet
    await check(r.question_id, { answer: ["a"], agrees: true, ambiguous: false, confidence: 0.95, model: "test" });
    expect(await verify(r.question_id)).toMatchObject({ status: "verified" });
    expect(await save({ ...mcq("Train speed one"), id: r.question_id, points: 5 })).toMatchObject({ status: "verified" });  // content unchanged
  });

  it("a disagreeing, unsure or ambiguous check keeps it a draft", async () => {
    for (const [title, c] of [
      ["Train speed two", { answer: ["b"], agrees: false, ambiguous: false, confidence: 0.9 }],
      ["Train speed three", { answer: ["a"], agrees: true, ambiguous: true, confidence: 0.9 }],
      ["Train speed four", { answer: ["a"], agrees: true, ambiguous: false, confidence: 0.5 }],
    ] as const) {
      const r = await save(mcq(title));
      await check(r.question_id, c);
      expect(await verify(r.question_id)).toMatchObject({ status: "draft" });
    }
  });

  it("a check for an older version doesn't count; editing a verified MCQ sends it back to draft", async () => {
    const r = await save(mcq("Train speed five"));
    const v = await version(r.question_id);
    await check(r.question_id, { answer: ["a"], agrees: true, ambiguous: false, confidence: 0.99 });
    await verify(r.question_id);
    expect(await status(r.question_id)).toBe("verified");
    expect(await save({ ...mcq("Train speed five"), id: r.question_id, answer: ["b"] })).toMatchObject({ status: "draft" });
    expect(await version(r.question_id)).toBe(v + 1);
    expect(await svc("public.b2b_record_verification($1, $2, $3, NULL)", [u.tpo, r.question_id, v + 1])).toMatchObject({ status: "draft" });
    expect(await check(r.question_id, { answer: ["a"], agrees: true }, v)).toMatchObject({ ok: false, reason: "CHANGED" });
  });

  it("an editor can override with a reason, and it's audited", async () => {
    const r = await save(mcq("Train speed six"));
    await asUser(db, u.tpo, async (tx) => {
      const v = (await tx.query<{ v: number }>("SELECT version AS v FROM questions WHERE id = $1", [r.question_id])).rows[0].v;
      expect((await tx.query<{ r: unknown }>("SELECT public.b2b_override_mcq_check($1, $2, 'trust me') AS r", [r.question_id, v])).rows[0].r)
        .toMatchObject({ ok: false, reason: "NOT_CHECKED" });
    });
    await check(r.question_id, { answer: ["b"], agrees: false, ambiguous: false, confidence: 0.9, note: "60 km/h assumes constant speed" });
    const v = await version(r.question_id);
    await asUser(db, u.tpo, async (tx) => {
      expect((await tx.query<{ r: unknown }>("SELECT public.b2b_override_mcq_check($1, $2, 'ok') AS r", [r.question_id, v])).rows[0].r)
        .toMatchObject({ ok: false, reason: "NOTE_REQUIRED" });
      expect((await tx.query<{ r: unknown }>("SELECT public.b2b_override_mcq_check($1, $2, 'Speed = distance / time; the key is right.') AS r",
        [r.question_id, v])).rows[0].r).toMatchObject({ ok: true, status: "verified" });
    }, { commit: true });
    expect(await status(r.question_id)).toBe("verified");
    const audit = await one<{ n: number }>("SELECT count(*)::int AS n FROM audit_logs WHERE action = 'question.mcq_override' AND target_id = $1", [r.question_id]);
    expect(audit.n).toBe(1);
  });

  it("the browser can't set verified, write the check, or override another org's question", async () => {
    const r = await save(mcq("Train speed seven"));
    await asUser(db, u.tpo, async (tx) => {
      expect(await expectRejected(tx, "UPDATE questions SET status = 'verified' WHERE id = $1", [r.question_id])).toMatch(/CHECK_REQUIRED/);
      expect(await expectRejected(tx, `UPDATE questions SET mcq_check = '{"agrees":true,"answer":["a"],"confidence":1,"version":1}' WHERE id = $1`, [r.question_id])).toMatch(/CHECK_REQUIRED/);
      expect(await expectRejected(tx, "SELECT public.b2b_record_mcq_check($1, $2, 1, '{}')", [u.tpo, r.question_id])).toMatch(/permission denied/);
    });
    await asUser(db, u.outsider, async (tx) => {
      expect(await expectRejected(tx, "SELECT public.b2b_override_mcq_check($1, 1, 'a long enough reason')", [r.question_id])).toMatch(/FORBIDDEN/);
    });
  });
});
