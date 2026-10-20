// @vitest-environment node
// Track B — proctoring V1 write paths (supabase/migrations/20261021000007_b2b_v1_proctoring.sql) on the real migrations:
// subjects log only to their own live session, inserts are idempotent, Strict / Maximum policies act,
// review and the human decision are staff-only (hiring managers only for assigned roles), other orgs see nothing.
import { describe, it, expect, beforeAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { createTestDb, createUser, asUser, asService, expectRejected } from "../helpers/pgdb";
import { HARD_TYPES, PAUSE_TYPES } from "../../functions/_shared/contracts/proctor-rules";

let db: PGlite;
const u: Record<string, string> = {};
const o: Record<string, string> = {};
const r: Record<string, string> = {};
type J = Record<string, unknown>;

const id = async (sql: string, params: unknown[] = []) => (await db.query<{ id: string }>(sql, params)).rows[0].id;
/** Call a service-role function, as the b2b-proctor edge function does. */
const rpc = (fn: string, args: unknown[]) =>
  asService(db, async (tx) => (await tx.query<{ r: J }>(`SELECT public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")}) AS r`, args)).rows[0].r);

const CHECK = { browser: "Chrome", version: 130, chromium: true, mobile: false, camera: true, mic: true, screen: "monitor", displays: 1,
                bandwidth_kbps: 5000, cores: 4, memory_gb: 8, tier: "full" };
const consent = (purposes: string[]) => purposes.map((p) => ({ purpose: p, version: "proctor-v1", text: `I agree to ${p} for this test.` }));
const ALL = consent(["assessment", "proctoring_screen", "proctoring_camera", "proctoring_audio"]);
const ev = (type: string, extra: J = {}) => ({
  clientEventId: randomUUID(), type, severity: "medium", confidence: 1, startedAt: new Date().toISOString(), ...extra,
});
const start = (actor: string, attempt: string, consents = ALL, check: J = CHECK) =>
  rpc("b2b_proctor_start", [actor, attempt, null, "assessment", JSON.stringify(check), JSON.stringify(consents)]);
const log = (actor: string, session: string, events: J[]) =>
  rpc("b2b_proctor_log_events", [actor, session, JSON.stringify(events)]);

beforeAll(async () => {
  db = await createTestDb();
  for (const k of ["adminA", "trainerA", "studentA", "studentA2", "adminB", "recruiterC", "hmC", "hmC2", "candC", "candC2", "super"]) {
    u[k] = await createUser(db, { superAdmin: k === "super" });
  }
  const org = (slug: string, type: string) => id("INSERT INTO organizations (name, slug, type) VALUES ($1, $1, $2) RETURNING id", [slug, type]);
  o.A = await org("college-a", "college");
  o.B = await org("college-b", "college");
  o.C = await org("company-c", "company");
  const member = (org: string, user: string, role: string) =>
    db.query("INSERT INTO org_memberships (org_id, user_id, role) VALUES ($1, $2, $3)", [org, user, role]);
  await member(o.A, u.adminA, "org_admin"); await member(o.A, u.trainerA, "trainer");
  await member(o.A, u.studentA, "student"); await member(o.A, u.studentA2, "student");
  await member(o.B, u.adminB, "org_admin");
  await member(o.C, u.recruiterC, "recruiter"); await member(o.C, u.hmC, "hiring_manager"); await member(o.C, u.hmC2, "hiring_manager");

  r.sA = await id("INSERT INTO students (org_id, user_id, roll_no, full_name, email) VALUES ($1, $2, '21A01', 'Asha', 'asha@a.in') RETURNING id", [o.A, u.studentA]);
  r.sA2 = await id("INSERT INTO students (org_id, user_id, roll_no, full_name, email) VALUES ($1, $2, '21A02', 'Bala', 'bala@a.in') RETURNING id", [o.A, u.studentA2]);
  r.cC = await id("INSERT INTO candidates (org_id, email, full_name, user_id) VALUES ($1, 'c@x.in', 'Dev', $2) RETURNING id", [o.C, u.candC]);
  r.cC2 = await id("INSERT INTO candidates (org_id, email, full_name, user_id) VALUES ($1, 'c2@x.in', 'Esha', $2) RETURNING id", [o.C, u.candC2]);

  const assess = (org: string, policy: string, n = 3, pauseTimer = false) => id(
    "INSERT INTO assessments (org_id, title, duration_min, proctoring_policy, strict_max_violations, pause_timer_on_violation) VALUES ($1, 'Test', 60, $2, $3, $4) RETURNING id",
    [org, policy, n, pauseTimer]);
  r.asStd = await assess(o.A, "standard");
  r.asStrict = await assess(o.A, "strict", 2);
  r.asMax = await assess(o.C, "maximum", 3, true);
  r.asOff = await assess(o.A, "off");
  r.dStd = await id("INSERT INTO drives (org_id, name, assessment_id, proctoring_policy) VALUES ($1, 'Drive std', $2, 'standard') RETURNING id", [o.A, r.asStd]);
  r.dStrict = await id("INSERT INTO drives (org_id, name, assessment_id, proctoring_policy) VALUES ($1, 'Drive strict', $2, 'strict') RETURNING id", [o.A, r.asStrict]);
  r.jMax = await id("INSERT INTO job_roles (org_id, title, assessment_id, proctoring_policy, hiring_manager_ids) VALUES ($1, 'Backend', $2, 'maximum', ARRAY[$3]::uuid[]) RETURNING id", [o.C, r.asMax, u.hmC]);
  const attempt = (org: string, as: string, subject: string, extra: string, vals: unknown[]) => id(
    `INSERT INTO attempts (org_id, assessment_id, subject_user_id, status, ${extra}) VALUES ($1, $2, $3, 'in_progress', ${vals.map((_, i) => `$${i + 4}`).join(", ")}) RETURNING id`,
    [org, as, subject, ...vals]);
  r.atStd = await attempt(o.A, r.asStd, u.studentA, "student_id, context_type, context_id", [r.sA, "drive", r.dStd]);
  r.atStrict = await attempt(o.A, r.asStrict, u.studentA2, "student_id, context_type, context_id", [r.sA2, "drive", r.dStrict]);
  r.atMax = await attempt(o.C, r.asMax, u.candC, "candidate_id, context_type, context_id", [r.cC, "job_role", r.jMax]);
  r.atOff = await attempt(o.A, r.asOff, u.studentA, "student_id, context_type", [r.sA, "practice"]);
  r.atSubmitted = await attempt(o.A, r.asStd, u.studentA, "student_id, context_type", [r.sA, "practice"]);
  await db.query("UPDATE attempts SET status = 'submitted' WHERE id = $1", [r.atSubmitted]);
});

describe("start + consent", () => {
  it("rule lists in SQL match the shared TypeScript rules", async () => {
    const q = await db.query<{ h: string[]; p: string[] }>("SELECT public.b2b_proctor_hard_types() h, public.b2b_proctor_pause_types() p");
    expect([...q.rows[0].h].sort()).toEqual([...HARD_TYPES].sort());
    expect([...q.rows[0].p].sort()).toEqual([...PAUSE_TYPES].sort());
  });

  it("preflight tells the subject the effective policy, org and retention; nobody else gets it", async () => {
    const p = await rpc("b2b_proctor_preflight", [u.studentA, r.atStd, null]);
    expect(p).toMatchObject({ ok: true, policy: "standard", org_name: "college-a", retention_days: 90, snapshot_interval_s: 30 });
    expect(await rpc("b2b_proctor_preflight", [u.studentA2, r.atStd, null])).toMatchObject({ ok: false, reason: "NOT_FOUND" });
    expect(await rpc("b2b_proctor_preflight", [u.studentA, r.atSubmitted, null])).toMatchObject({ ok: false, reason: "CLOSED" });
    expect(await rpc("b2b_proctor_preflight", [u.candC, r.atMax, null])).toMatchObject({ ok: true, policy: "maximum" });
  });

  it("refuses to start without every consent purpose, a monitor share and a single display", async () => {
    expect(await start(u.studentA, r.atStd, consent(["assessment", "proctoring_screen"])))
      .toMatchObject({ ok: false, reason: "CONSENT_REQUIRED" });
    expect(await start(u.studentA, r.atStd, ALL, { ...CHECK, screen: "window" })).toMatchObject({ ok: false, reason: "SYSTEM_CHECK_FAILED" });
    expect(await start(u.studentA, r.atStd, ALL, { ...CHECK, displays: 2 })).toMatchObject({ ok: false, reason: "SYSTEM_CHECK_FAILED" });
    expect(await start(u.studentA, r.atStd, ALL, { ...CHECK, mobile: true })).toMatchObject({ ok: false, reason: "SYSTEM_CHECK_FAILED" });
    expect(await start(u.studentA, r.atOff)).toMatchObject({ ok: false, reason: "POLICY_OFF" });
    expect(await start(u.studentA2, r.atStd)).toMatchObject({ ok: false, reason: "NOT_FOUND" });
  });

  it("starts, stores consent with version + exact text, and resumes the same session after a reload", async () => {
    const s = await start(u.studentA, r.atStd);
    expect(s).toMatchObject({ ok: true, policy: "standard", status: "active", resumed: false });
    r.sessStd = s.session_id as string;
    const c = await db.query<{ purpose: string; consent_version: string; consent_text: string }>(
      "SELECT purpose, consent_version, consent_text FROM org_consents WHERE user_id = $1 AND org_id = $2 ORDER BY purpose", [u.studentA, o.A]);
    expect(c.rows.map((x) => x.purpose)).toEqual(["assessment", "proctoring_audio", "proctoring_camera", "proctoring_screen"]);
    expect(c.rows[0]).toMatchObject({ consent_version: "proctor-v1", consent_text: "I agree to assessment for this test." });
    const again = await start(u.studentA, r.atStd);
    expect(again).toMatchObject({ ok: true, session_id: r.sessStd, resumed: true });
  });

});

describe("events: own live session only, idempotent", () => {
  it("only the subject logs, only to a live session; replays are ignored", async () => {
    const batch = [ev("tab_hidden"), ev("copy_attempt", { severity: "low" })];
    expect(await log(u.studentA, r.sessStd, batch)).toMatchObject({ ok: true, accepted: 2, action: "warn" });
    expect(await log(u.studentA, r.sessStd, batch)).toMatchObject({ ok: true, accepted: 0, action: "none" });
    expect(await log(u.studentA2, r.sessStd, [ev("tab_hidden")])).toMatchObject({ ok: false, reason: "NOT_FOUND" });
    expect(await log(u.adminA, r.sessStd, [ev("tab_hidden")])).toMatchObject({ ok: false, reason: "NOT_FOUND" });
    const n = await db.query<{ n: number }>("SELECT count(*)::int n FROM proctoring_events WHERE session_id = $1", [r.sessStd]);
    expect(n.rows[0].n).toBe(2);
  });

  it("drops evidence paths outside the session folder and server-only lifecycle events", async () => {
    const good = `org/${o.A}/sessions/${r.sessStd}/screen-1.jpg`;
    const e1 = ev("window_blur", { evidencePath: good });
    const e2 = ev("window_blur", { evidencePath: `org/${o.B}/sessions/${r.sessStd}/x.jpg` });
    const e3 = ev("window_blur", { evidencePath: `org/${o.A}/sessions/${r.sessStd}/../../x.jpg` });
    const out = await log(u.studentA, r.sessStd, [e1, e2, e3, ev("auto_submitted"), ev("session_paused")]);
    expect(out.accepted).toBe(3);
    const rows = await db.query<{ client_event_id: string; evidence_path: string | null }>(
      "SELECT client_event_id, evidence_path FROM proctoring_events WHERE session_id = $1 AND type = 'window_blur'", [r.sessStd]);
    const byId = Object.fromEntries(rows.rows.map((x) => [x.client_event_id, x.evidence_path]));
    expect(byId[e1.clientEventId]).toBe(good);
    expect(byId[e2.clientEventId]).toBeNull();
    expect(byId[e3.clientEventId]).toBeNull();
  });

  it("standard policy never pauses or submits", async () => {
    const out = await log(u.studentA, r.sessStd, [ev("screen_share_stopped"), ev("fullscreen_exit"), ev("extra_display"), ev("camera_off")]);
    expect(out.action).toBe("warn");
  });

  it("subjects and anon can't write events or sessions directly", async () => {
    await asUser(db, u.studentA, async (tx) => {
      await expectRejected(tx, "INSERT INTO proctoring_events (session_id, org_id, type, severity, started_at) VALUES ($1, $2, 'tab_hidden', 'low', now())", [r.sessStd, o.A]);
      expect((await tx.query("SELECT * FROM proctoring_events")).rows).toHaveLength(0);
      await expectRejected(tx, "SELECT public.b2b_proctor_log_events($1, $2, '[]')", [u.studentA, r.sessStd]);
    });
    await asUser(db, null, async (tx) => {
      await expectRejected(tx, "SELECT public.b2b_proctor_start($1, $2, NULL, 'assessment', '{}', '[]')", [u.studentA, r.atStd]);
    });
  });
});

describe("strict and maximum policies", () => {
  it("strict: auto-submit after N hard violations (once), soft signals don't count", async () => {
    const s = await start(u.studentA2, r.atStrict);
    r.sessStrict = s.session_id as string;
    expect(await log(u.studentA2, r.sessStrict, [ev("looking_away"), ev("copy_attempt")])).toMatchObject({ violations: 0, action: "warn" });
    expect(await log(u.studentA2, r.sessStrict, [ev("tab_hidden")])).toMatchObject({ violations: 1, action: "warn" });
    expect(await log(u.studentA2, r.sessStrict, [ev("fullscreen_exit")])).toMatchObject({ violations: 2, action: "submit" });
    expect(await log(u.studentA2, r.sessStrict, [ev("window_blur")])).toMatchObject({ action: "submit" });
    const n = await db.query<{ n: number }>("SELECT count(*)::int n FROM proctoring_events WHERE session_id = $1 AND type = 'auto_submitted'", [r.sessStrict]);
    expect(n.rows[0].n).toBe(1);
  });

  it("maximum: hard violations pause until resumed; repeated pauses escalate; the attempt timer pauses", async () => {
    const s = await start(u.candC, r.atMax);
    r.sessMax = s.session_id as string;
    expect(s.policy).toBe("maximum");
    expect(await log(u.candC, r.sessMax, [ev("tab_hidden")])).toMatchObject({ action: "warn" });
    expect(await log(u.candC, r.sessMax, [ev("screen_share_stopped")])).toMatchObject({ action: "pause" });
    expect((await db.query<{ status: string }>("SELECT status FROM proctoring_sessions WHERE id = $1", [r.sessMax])).rows[0].status).toBe("paused");
    expect((await db.query<{ p: string | null }>("SELECT paused_at p FROM attempts WHERE id = $1", [r.atMax])).rows[0].p).not.toBeNull();
    // still paused while not fixed
    expect(await log(u.candC, r.sessMax, [ev("looking_away")])).toMatchObject({ action: "pause" });
    expect(await log(u.candC, r.sessMax, [ev("session_resumed", { severity: "info" })])).toMatchObject({ action: "resume" });
    expect((await db.query<{ p: string | null }>("SELECT paused_at p FROM attempts WHERE id = $1", [r.atMax])).rows[0].p).toBeNull();
    for (let i = 0; i < 2; i++) {
      expect(await log(u.candC, r.sessMax, [ev("fullscreen_exit")])).toMatchObject({ action: "pause" });
      expect(await log(u.candC, r.sessMax, [ev("session_resumed", { severity: "info" })])).toMatchObject({ action: "resume" });
    }
    const pauses = await db.query<{ severity: string }>(
      "SELECT severity FROM proctoring_events WHERE session_id = $1 AND type = 'session_paused' ORDER BY id", [r.sessMax]);
    expect(pauses.rows.map((x) => x.severity)).toEqual(["medium", "medium", "high"]);
    // a pause and a later resume in the same batch → resumed
    const t0 = Date.now();
    expect(await log(u.candC, r.sessMax, [
      ev("camera_off", { startedAt: new Date(t0).toISOString() }),
      ev("session_resumed", { severity: "info", startedAt: new Date(t0 + 2000).toISOString() }),
    ])).toMatchObject({ action: "warn" });
  });
});

describe("end + review", () => {
  it("end stores the score once; events after end are refused", async () => {
    const detail = { version: "integrity-v1", score: 72 };
    expect(await rpc("b2b_proctor_end", [u.studentA2, r.sessStd, 50, "medium", JSON.stringify(detail)])).toMatchObject({ ok: false });
    expect(await rpc("b2b_proctor_end", [u.studentA, r.sessStd, 72, "medium", JSON.stringify(detail)]))
      .toMatchObject({ ok: true, integrity_band: "medium" });
    expect(Number((await rpc("b2b_proctor_end", [u.studentA, r.sessStd, 10, "low", "{}"])).integrity_score)).toBe(72);
    expect(await log(u.studentA, r.sessStd, [ev("tab_hidden")])).toMatchObject({ ok: false, reason: "SESSION_ENDED" });
  });

  it("timeline: org staff of the context only; hiring managers only for assigned roles; other orgs never", async () => {
    expect(await rpc("b2b_proctor_timeline", [u.adminA, r.sessStd])).toMatchObject({ ok: true });
    expect(await rpc("b2b_proctor_timeline", [u.trainerA, r.sessStd])).toMatchObject({ ok: true });
    expect(await rpc("b2b_proctor_timeline", [u.super, r.sessStd])).toMatchObject({ ok: true });
    for (const who of [u.adminB, u.studentA, u.recruiterC]) {
      expect(await rpc("b2b_proctor_timeline", [who, r.sessStd])).toMatchObject({ ok: false });
    }
    const t = await rpc("b2b_proctor_timeline", [u.hmC, r.sessMax]);
    expect(t).toMatchObject({ ok: true });
    expect((t.session as J).subject_name).toBe("Dev");
    expect((t.events as J[]).length).toBeGreaterThan(5);
    expect(await rpc("b2b_proctor_timeline", [u.hmC2, r.sessMax])).toMatchObject({ ok: false });
    expect(await rpc("b2b_proctor_timeline", [u.recruiterC, r.sessMax])).toMatchObject({ ok: true });
    expect(await rpc("b2b_proctor_timeline", [u.candC, r.sessMax])).toMatchObject({ ok: false });
  });

  it("RLS reads match: other org staff and subjects read nothing", async () => {
    const seen = (user: string) => asUser(db, user, async (tx) =>
      (await tx.query("SELECT id FROM proctoring_events WHERE session_id = $1", [r.sessStd])).rows.length);
    expect(await seen(u.adminA)).toBeGreaterThan(0);
    expect(await seen(u.adminB)).toBe(0);
    expect(await seen(u.studentA)).toBe(0);
    const hm = (user: string) => asUser(db, user, async (tx) =>
      (await tx.query("SELECT id FROM proctoring_sessions WHERE id = $1", [r.sessMax])).rows.length);
    expect(await hm(u.hmC)).toBe(1);
    expect(await hm(u.hmC2)).toBe(0);
  });

  it("reviewing a flag and the final decision: authorised staff only, audited, separate from the AI score", async () => {
    const evId = (await db.query<{ id: number }>("SELECT id FROM proctoring_events WHERE session_id = $1 AND type = 'tab_hidden' LIMIT 1", [r.sessStd])).rows[0].id;
    expect(await rpc("b2b_proctor_review_event", [u.adminB, evId, "dismissed", "nope"])).toMatchObject({ ok: false });
    expect(await rpc("b2b_proctor_review_event", [u.studentA, evId, "dismissed", "nope"])).toMatchObject({ ok: false });
    expect(await rpc("b2b_proctor_review_event", [u.trainerA, evId, "dismissed", "Notification popup, checked snapshot"]))
      .toMatchObject({ ok: true });
    const e = await db.query<{ review_status: string; reviewed_by: string; review_note: string }>(
      "SELECT review_status, reviewed_by, review_note FROM proctoring_events WHERE id = $1", [evId]);
    expect(e.rows[0]).toMatchObject({ review_status: "dismissed", reviewed_by: u.trainerA, review_note: "Notification popup, checked snapshot" });

    expect(await rpc("b2b_proctor_decide", [u.adminB, r.sessStd, "no_concern", null])).toMatchObject({ ok: false });
    expect(await rpc("b2b_proctor_decide", [u.hmC2, r.sessMax, "no_concern", null])).toMatchObject({ ok: false });
    expect(await rpc("b2b_proctor_decide", [u.hmC, r.sessMax, "minor_concern", "Two screen-share drops, explained"])).toMatchObject({ ok: true });
    expect(await rpc("b2b_proctor_decide", [u.adminA, r.sessStd, "no_concern", ""])).toMatchObject({ ok: true });
    const t = await rpc("b2b_proctor_timeline", [u.adminA, r.sessStd]);
    expect((t.reviews as J[])[0]).toMatchObject({ decision: "no_concern", note: null });
    expect(Number((t.session as J).integrity_score)).toBe(72);
    const audit = await db.query<{ action: string; actor_id: string }>(
      "SELECT action, actor_id FROM audit_logs WHERE action IN ('proctor.review_event', 'proctor.start') ORDER BY id");
    expect(audit.rows.some((a) => a.action === "proctor.review_event" && a.actor_id === u.trainerA)).toBe(true);
    expect(audit.rows.some((a) => a.action === "proctor.start")).toBe(true);
  });
});
