// @vitest-environment node
// Track E (startup portal): invites (dedupe, credits), candidate token linking + second-session refusal,
// consent, completion + idempotent credit charge, pipeline filters, decisions, reports, share links,
// browser-write guards, and cross-org / role isolation for every new function.
// Runs against the real migrations plus docs/b2b/tracks/e-startup.sql.
import { describe, it, expect, beforeAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createHash, randomUUID } from "node:crypto";
import { createTestDb, createUser, asUser, asService, expectRejected } from "../helpers/pgdb";

let db: PGlite;
const u: Record<string, string> = {};
const o: Record<string, string> = {};
const r: Record<string, string> = {};
type J = Record<string, unknown> & { ok?: boolean; reason?: string };

const one = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0];
const id = async (sql: string, params: unknown[] = []) => (await one<{ id: string }>(sql, params)).id;
const hash = (t: string) => createHash("sha256").update(t).digest("hex");

async function svc<T = J>(fn: string, args: unknown[], casts: string[]): Promise<T> {
  return asService(db, async (tx) => {
    const ph = args.map((_, i) => `$${i + 1}${casts[i] ? `::${casts[i]}` : ""}`).join(", ");
    const res = await tx.query<{ r: T }>(`SELECT public.${fn}(${ph}) AS r`, args);
    return res.rows[0].r;
  });
}
async function svcErr(fn: string, args: unknown[], casts: string[]): Promise<string> {
  try { await svc(fn, args, casts); } catch (e) { return (e as Error).message; }
  throw new Error(`${fn} should have been refused`);
}

const INVITE = ["uuid", "uuid", "jsonb", "text"];
const invite = (actor: string, role: string, people: Array<{ email: string; full_name: string; phone?: string }>, tokens: string[]) =>
  svc<J & { invited: Array<{ role_candidate_id: string; email: string; token_index: number }>; skipped: Array<{ email: string; reason: string }> }>(
    "b2b_invite_candidates", [actor, role, JSON.stringify(people.map((p, i) => ({ ...p, token_hash: hash(tokens[i]) }))), "invite"], INVITE);
const claim = (token: string, user: string) => svc<J & { steps: Record<string, string | null>; completed: boolean; just_completed: boolean }>(
  "b2b_claim_candidate_token", [hash(token), user], ["text", "uuid"]);
const state = (token: string, user: string) => svc<J & { steps: Record<string, string | null>; completed: boolean; just_completed: boolean; credits_charged: boolean }>(
  "b2b_candidate_state", [hash(token), user], ["text", "uuid"]);
const consentAll = (token: string, user: string, purposes: string[]) => svc<J>("b2b_candidate_consent",
  [hash(token), user, JSON.stringify(purposes.map((p) => ({ purpose: p, version: "e-v1", text: `I agree to ${p}` })))], ["text", "uuid", "jsonb"]);
const pipeline = (actor: string, role: string, filters: unknown = {}, sortBy = "match_score", dir = "desc") =>
  svc<J & { total: number; rows: Array<Record<string, unknown>>; counts: Record<string, number> }>(
    "b2b_role_pipeline", [actor, role, JSON.stringify(filters), 1, 50, sortBy, dir], ["uuid", "uuid", "jsonb", "int", "int", "text", "text"]);
const balance = async (org: string) => Number((await one<{ b: string }>("SELECT credits_balance AS b FROM organizations WHERE id = $1", [org])).b);
const anon = async () => {
  const x = randomUUID();
  await db.query("INSERT INTO auth.users (id, email, is_anonymous) VALUES ($1, NULL, true)", [x]);
  return x;
};
const matrix = { must_have: [{ skill: "Python", weight: 5 }], nice_to_have: [], seniority: "junior" };
const noInterview = { enabled: false, duration_min: 20, sections: ["intro"], difficulty: "medium", code_walkthrough: false };

beforeAll(async () => {
  db = await createTestDb({ extraSql: ["docs/b2b/tracks/e-startup.sql"] });
  u.super = await createUser(db, { superAdmin: true });
  for (const k of ["adminA", "recA", "hmA", "hmA2", "adminB", "recB", "outsider"]) u[k] = await createUser(db);
  o.A = await id("INSERT INTO organizations (name, slug, type, credits_balance) VALUES ('Startup A', 'startup-a', 'company', 3) RETURNING id");
  o.B = await id("INSERT INTO organizations (name, slug, type, credits_balance) VALUES ('Startup B', 'startup-b', 'company', 10) RETURNING id");
  const member = (org: string, user: string, role: string) =>
    db.query("INSERT INTO org_memberships (org_id, user_id, role, email, full_name) VALUES ($1, $2, $3, $4, $5)",
      [org, user, role, `${role}-${user.slice(0, 4)}@x.in`, role]);
  await member(o.A, u.adminA, "org_admin");
  await member(o.A, u.recA, "recruiter");
  await member(o.A, u.hmA, "hiring_manager");
  await member(o.A, u.hmA2, "hiring_manager");
  await member(o.B, u.adminB, "org_admin");
  await member(o.B, u.recB, "recruiter");
  r.asmA = await id("INSERT INTO assessments (org_id, title, duration_min, status) VALUES ($1, 'Python test', 60, 'ready') RETURNING id", [o.A]);
  r.A = await id(`INSERT INTO job_roles (org_id, title, skills_matrix, assessment_id, interview_config, status, hiring_manager_ids, created_by)
                  VALUES ($1, 'Backend engineer', $2, $3, $4, 'open', ARRAY[$5]::uuid[], $6) RETURNING id`,
    [o.A, JSON.stringify(matrix), r.asmA, JSON.stringify(noInterview), u.hmA, u.recA]);
  r.A2 = await id(`INSERT INTO job_roles (org_id, title, skills_matrix, status) VALUES ($1, 'Frontend engineer', $2, 'open') RETURNING id`,
    [o.A, JSON.stringify(matrix)]);
  r.B = await id(`INSERT INTO job_roles (org_id, title, skills_matrix, status) VALUES ($1, 'Data engineer', $2, 'open') RETURNING id`,
    [o.B, JSON.stringify(matrix)]);
}, 180_000);

describe("role validation", () => {
  it("defaults to an AI interview config track C can read, and maximum proctoring", async () => {
    const row = await one<{ interview_config: Record<string, unknown>; proctoring_policy: string }>(
      "SELECT interview_config, proctoring_policy FROM job_roles WHERE id = $1", [r.A2]);
    expect(row.interview_config).toMatchObject({ enabled: true, duration_min: 20, difficulty: "medium", code_walkthrough: true });
    expect(row.proctoring_policy).toBe("maximum");
  });

  it("refuses bad interview config, bad matrix, non-HM assignees and incomplete open roles", async () => {
    await asUser(db, u.recA, async (tx) => {
      expect(await expectRejected(tx, "UPDATE job_roles SET interview_config = '{\"enabled\": true}' WHERE id = $1", [r.A2])).toMatch(/INVALID_INTERVIEW_CONFIG/);
      expect(await expectRejected(tx, "UPDATE job_roles SET skills_matrix = '{\"must_have\": []}' WHERE id = $1", [r.A2])).toMatch(/INVALID_SKILLS_MATRIX/);
      expect(await expectRejected(tx, "UPDATE job_roles SET hiring_manager_ids = ARRAY[$2]::uuid[] WHERE id = $1", [r.A2, u.recA])).toMatch(/NOT_A_HIRING_MANAGER/);
      expect(await expectRejected(tx, "INSERT INTO job_roles (org_id, title, status) VALUES ($1, 'Empty', 'open')", [o.A])).toMatch(/ROLE_INCOMPLETE/);
      // A hiring manager of the org is fine.
      await tx.query("UPDATE job_roles SET hiring_manager_ids = ARRAY[$2]::uuid[] WHERE id = $1", [r.A2, u.hmA2]);
    });
  });

  it("hiring managers can't create or edit roles; recruiters of another company can't see them", async () => {
    await asUser(db, u.hmA, async (tx) => {
      expect(await expectRejected(tx, "INSERT INTO job_roles (org_id, title) VALUES ($1, 'x')", [o.A])).toMatch(/row-level security/);
      const n = (await tx.query("UPDATE job_roles SET title = 'hm edit' WHERE id = $1", [r.A])).affectedRows;
      expect(n).toBe(0);
    });
    const seen = await asUser(db, u.recB, async (tx) => (await tx.query("SELECT id FROM job_roles WHERE org_id = $1", [o.A])).rows);
    expect(seen).toEqual([]);
  });
});

describe("invites", () => {
  it("invites, dedupes within the list and per role, and validates rows", async () => {
    const res = await invite(u.recA, r.A, [
      { email: "Asha@x.in", full_name: "Asha" },
      { email: "asha@x.in", full_name: "Asha dup" },
      { email: "bad", full_name: "Bad" },
      { email: "bala@x.in", full_name: "Bala", phone: "98480" },
    ], ["tA1", "tA2", "tA3", "tA4"]);
    expect(res.ok).toBe(true);
    expect(res.invited.map((i) => [i.email, i.token_index])).toEqual([["asha@x.in", 1], ["bala@x.in", 4]]);
    expect(res.skipped).toEqual([{ email: "asha@x.in", reason: "duplicate_in_list" }, { email: "bad", reason: "invalid_email" }]);
    const again = await invite(u.adminA, r.A, [{ email: "asha@x.in", full_name: "Asha" }], ["tA5"]);
    expect(again.invited).toEqual([]);
    expect(again.skipped).toEqual([{ email: "asha@x.in", reason: "already_invited" }]);
    // Same person to another role reuses the candidate row.
    const other = await invite(u.recA, r.A2, [{ email: "asha@x.in", full_name: "Asha" }], ["tA2role"]);
    expect(other.invited).toHaveLength(1);
    expect(Number((await one<{ n: string }>("SELECT count(*) AS n FROM candidates WHERE org_id = $1 AND email = 'asha@x.in'", [o.A])).n)).toBe(1);
    // Only hashes are stored.
    const rc = await one<{ invite_token_hash: string }>("SELECT invite_token_hash FROM role_candidates WHERE id = $1", [res.invited[0].role_candidate_id]);
    expect(rc.invite_token_hash).toBe(hash("tA1"));
  });

  it("blocks new invites when credits can't cover them", async () => {
    // Balance 3, one credit per session: 4 new invites at once are refused.
    const res = await invite(u.recA, r.A, ["c1", "c2", "c3", "c4"].map((x) => ({ email: `${x}@x.in`, full_name: x })), ["k1", "k2", "k3", "k4"]);
    expect(res).toMatchObject({ ok: false, reason: "NO_CREDITS", needed: 4 });
  });

  it("only editors of the role's company may invite or re-issue", async () => {
    for (const actor of [u.hmA, u.recB, u.adminB, u.outsider]) {
      expect(await svcErr("b2b_invite_candidates", [actor, r.A, JSON.stringify([{ email: "z@x.in", full_name: "Z", token_hash: hash("z") }]), "invite"], INVITE)).toMatch(/FORBIDDEN/);
    }
    const rcId = (await one<{ id: string }>("SELECT rc.id FROM role_candidates rc JOIN candidates c ON c.id = rc.candidate_id WHERE c.email = 'bala@x.in'")).id;
    expect(await svcErr("b2b_reissue_candidate_invite", [u.recB, rcId, hash("x")], ["uuid", "uuid", "text"])).toMatch(/FORBIDDEN/);
  });

  it("refuses invites to a role that isn't open", async () => {
    await db.query("UPDATE job_roles SET status = 'closed' WHERE id = $1", [r.B]);
    const res = await invite(u.recB, r.B, [{ email: "q@x.in", full_name: "Q" }], ["q1"]);
    expect(res).toMatchObject({ ok: false, reason: "ROLE_NOT_OPEN" });
    await db.query("UPDATE job_roles SET status = 'open' WHERE id = $1", [r.B]);
  });
});

describe("candidate token flow", () => {
  let ses1: string;
  let rcAsha: string;

  it("resolves links: valid, invalid, expired", async () => {
    const ok = await svc<J & { status: string; candidate: { email: string } }>("b2b_resolve_candidate_token", [hash("tA1")], ["text"]);
    expect(ok).toMatchObject({ status: "valid", has_coding: true, has_interview: false, role: { title: "Backend engineer" } });
    rcAsha = String(ok.role_candidate_id);
    expect((await svc<J>("b2b_resolve_candidate_token", [hash("nope")], ["text"])).status).toBe("invalid");
    await db.query("UPDATE role_candidates SET invite_expires_at = now() - interval '1 minute' WHERE invite_token_hash = $1", [hash("tA4")]);
    expect((await svc<J>("b2b_resolve_candidate_token", [hash("tA4")], ["text"])).status).toBe("expired");
    expect((await claim("tA4", await anon())).reason).toBe("EXPIRED");
  });

  it("links the first anonymous session and refuses a second one and real accounts", async () => {
    expect((await claim("tA1", u.outsider)).reason).toBe("NOT_ANONYMOUS");
    ses1 = await anon();
    const first = await claim("tA1", ses1);
    expect(first).toMatchObject({ ok: true, steps: { consent: "todo", coding: "todo", interview: null, done: "todo" } });
    expect((await claim("tA1", ses1)).ok).toBe(true);                        // same session again: fine
    expect((await claim("tA1", await anon())).reason).toBe("OTHER_DEVICE");   // a different browser: refused
    expect(await svcErr("b2b_candidate_state", [hash("tA1"), await anon()], ["text", "uuid"])).toMatch(/FORBIDDEN/);
    const cand = await one<{ user_id: string }>("SELECT user_id FROM candidates WHERE email = 'asha@x.in' AND org_id = $1", [o.A]);
    expect(cand.user_id).toBe(ses1);
  });

  it("a re-issued link moves the work to the new session and kills the old link", async () => {
    // Work under the first session.
    const att = await id(`INSERT INTO attempts (org_id, assessment_id, subject_user_id, candidate_id, context_type, context_id, status, started_at, deadline_at)
      SELECT $1, $2, $3, rc.candidate_id, 'job_role', $4, 'in_progress', now(), now() + interval '1 hour' FROM role_candidates rc WHERE rc.id = $5 RETURNING id`,
      [o.A, r.asmA, ses1, r.A, rcAsha]);
    const re = await svc<J>("b2b_reissue_candidate_invite", [u.recA, rcAsha, hash("tA1-new")], ["uuid", "uuid", "text"]);
    expect(re).toMatchObject({ ok: true, email: "asha@x.in" });
    expect((await svc<J>("b2b_resolve_candidate_token", [hash("tA1")], ["text"])).status).toBe("invalid");
    const ses2 = await anon();
    const st = await claim("tA1-new", ses2);
    expect(st).toMatchObject({ ok: true, attempt_id: att, steps: { coding: "in_progress" }, stage: "in_progress" });
    expect((await one<{ subject_user_id: string }>("SELECT subject_user_id FROM attempts WHERE id = $1", [att])).subject_user_id).toBe(ses2);
    ses1 = ses2;
  });

  it("consent: itemised, every required purpose needed, stored with exact text", async () => {
    const partial = await consentAll("tA1-new", ses1, ["account"]);
    expect(partial).toMatchObject({ ok: false, reason: "CONSENT_REQUIRED" });
    expect(partial.missing).toEqual(["assessment", "proctoring_screen", "proctoring_camera", "proctoring_audio"]);
    const ok = await consentAll("tA1-new", ses1, ["account", "assessment", "proctoring_screen", "proctoring_camera", "proctoring_audio"]);
    expect(ok).toMatchObject({ ok: true, steps: { consent: "done" } });
    const c = await one<{ consent_text: string; consent_version: string }>(
      "SELECT consent_text, consent_version FROM org_consents WHERE user_id = $1 AND purpose = 'proctoring_camera'", [ses1]);
    expect(c).toEqual({ consent_text: "I agree to proctoring_camera", consent_version: "e-v1" });
    expect((await svc<J>("b2b_candidate_system_checked", [hash("tA1-new"), ses1], ["text", "uuid"])).steps).toMatchObject({ system_check: "done" });
  });

  it("completion charges one session's credits exactly once, then claims one notice", async () => {
    const before = await balance(o.A);
    await db.query("UPDATE attempts SET status = 'submitted', submitted_at = now(), score = 8, max_score = 10 WHERE candidate_id = (SELECT candidate_id FROM role_candidates WHERE id = $1)", [rcAsha]);
    const done = await state("tA1-new", ses1);
    expect(done).toMatchObject({ completed: true, just_completed: true, credits_charged: true, stage: "completed", steps: { coding: "done", done: "done" } });
    const again = await state("tA1-new", ses1);
    expect(again).toMatchObject({ completed: true, just_completed: false });
    await pipeline(u.recA, r.A);   // staff refresh doesn't charge again either
    expect(await balance(o.A)).toBe(before - 1);
    const ledger = await one<{ n: number }>("SELECT count(*) AS n FROM org_credit_ledger WHERE ref_type = 'role_candidate' AND ref_id = $1", [rcAsha]);
    expect(Number(ledger.n)).toBe(1);

    const notices = await svc<Array<{ role_candidate_id: string; recipients: string[]; candidate_name: string }>>("b2b_claim_completion_notices", [r.A], ["uuid"]);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ role_candidate_id: rcAsha, candidate_name: "Asha" });
    expect(notices[0].recipients.length).toBeGreaterThan(0);
    expect(await svc<unknown[]>("b2b_claim_completion_notices", [r.A], ["uuid"])).toEqual([]);
  });

  it("completion with too few credits is recorded, charged later once credits arrive", async () => {
    // Bala (role A) — balance set to 0 first.
    const tok = "bala-new";
    const rcBala = (await one<{ id: string }>("SELECT rc.id FROM role_candidates rc JOIN candidates c ON c.id = rc.candidate_id WHERE c.email = 'bala@x.in' AND rc.job_role_id = $1", [r.A])).id;
    await svc("b2b_reissue_candidate_invite", [u.recA, rcBala, hash(tok)], ["uuid", "uuid", "text"]);
    const s = await anon();
    await claim(tok, s);
    await consentAll(tok, s, ["account", "assessment", "proctoring_screen", "proctoring_camera", "proctoring_audio"]);
    await db.query(`INSERT INTO attempts (org_id, assessment_id, subject_user_id, candidate_id, context_type, context_id, status, started_at, deadline_at, submitted_at)
      SELECT $1, $2, $3, rc.candidate_id, 'job_role', $4, 'submitted', now(), now(), now() FROM role_candidates rc WHERE rc.id = $5`, [o.A, r.asmA, s, r.A, rcBala]);
    const saved = await balance(o.A);
    await db.query("UPDATE organizations SET credits_balance = 0 WHERE id = $1", [o.A]);
    expect(await state(tok, s)).toMatchObject({ completed: true, credits_charged: false });
    await db.query("UPDATE organizations SET credits_balance = $2 WHERE id = $1", [o.A, saved]);
    expect(await state(tok, s)).toMatchObject({ completed: true, credits_charged: true });
    expect(await balance(o.A)).toBe(saved - 1);
  });
});

describe("pipeline, decisions, reports", () => {
  it("filters, sorts and counts server-side", async () => {
    const all = await pipeline(u.recA, r.A);
    expect(all.total).toBe(2);
    expect(all.counts).toMatchObject({ completed: 2 });
    const rcs = all.rows.map((x) => String(x.id));
    await svc("b2b_store_matches", [u.recA, JSON.stringify([
      { role_candidate_id: rcs[0], score: 82, recommendation: "strong", detail: {} },
      { role_candidate_id: rcs[1], score: 40, recommendation: "not_yet", detail: {} },
    ])], ["uuid", "jsonb"]);
    const hi = await pipeline(u.recA, r.A, { scoreMin: 50 });
    expect(hi.rows.map((x) => x.match_score)).toEqual([82]);
    const asc = await pipeline(u.recA, r.A, {}, "match_score", "asc");
    expect(asc.rows.map((x) => x.match_score)).toEqual([40, 82]);
    expect((await pipeline(u.recA, r.A, { search: "bala" })).rows.map((x) => x.full_name)).toEqual(["Bala"]);
    expect((await pipeline(u.recA, r.A, { stages: ["hired"] })).total).toBe(0);
    expect((await pipeline(u.recA, r.A, { integrityBands: ["low"] })).total).toBe(0);
  });

  it("hiring managers: assigned roles only, may decide; others refused", async () => {
    expect((await pipeline(u.hmA, r.A)).access).toBe("viewer");
    expect(await svcErr("b2b_role_pipeline", [u.hmA2, r.A, "{}", 1, 50, null, null], ["uuid", "uuid", "jsonb", "int", "int", "text", "text"])).toMatch(/FORBIDDEN/);
    expect(await svcErr("b2b_role_pipeline", [u.adminB, r.A, "{}", 1, 50, null, null], ["uuid", "uuid", "jsonb", "int", "int", "text", "text"])).toMatch(/FORBIDDEN/);
    const ids = (await pipeline(u.recA, r.A)).rows.map((x) => String(x.id));
    const d = await svc<J>("b2b_decide", [u.hmA, `{${ids.join(",")}}`, "advance", "Strong Python"], ["uuid", "uuid[]", "text", "text"]);
    expect(d).toMatchObject({ ok: true, updated: 2 });
    expect((await pipeline(u.recA, r.A)).counts).toMatchObject({ shortlisted: 2 });
    await svc("b2b_decide", [u.recA, `{${ids[1]}}`, "hold", null], ["uuid", "uuid[]", "text", "text"]);
    expect((await pipeline(u.recA, r.A, { stages: ["completed"] })).total).toBe(1);
    expect(await svcErr("b2b_decide", [u.hmA2, `{${ids[0]}}`, "hire", null], ["uuid", "uuid[]", "text", "text"])).toMatch(/FORBIDDEN/);
    expect(await svcErr("b2b_decide", [u.recB, `{${ids[0]}}`, "hire", null], ["uuid", "uuid[]", "text", "text"])).toMatch(/FORBIDDEN/);
  });

  it("report: staff see contacts, comments and decision history; outsiders refused", async () => {
    const rcId = String((await pipeline(u.recA, r.A, { search: "asha" })).rows[0].id);
    await asUser(db, u.hmA, (tx) => tx.query(
      "INSERT INTO role_candidate_comments (org_id, role_candidate_id, author_id, body) VALUES ($1, $2, $3, 'Good explanation')", [o.A, rcId, u.hmA]), { commit: true });
    const rep = await svc<J & { access: string; report: Record<string, unknown> }>("b2b_candidate_report", [u.hmA, rcId], ["uuid", "uuid"]);
    expect(rep.access).toBe("viewer");
    expect(rep.report).toMatchObject({ candidate: { full_name: "Asha", email: "asha@x.in" }, attempt: { status: "submitted" }, interview: null });
    expect((rep.report.comments as unknown[]).length).toBe(1);
    expect(rep.report.decisions).toEqual(expect.arrayContaining([expect.objectContaining({ decision: "advance", note: "Strong Python" })]));
    for (const actor of [u.hmA2, u.adminB, u.outsider]) {
      expect(await svcErr("b2b_candidate_report", [actor, rcId], ["uuid", "uuid"])).toMatch(/FORBIDDEN/);
    }
    expect(await svcErr("b2b_store_matches", [u.recB, JSON.stringify([{ role_candidate_id: rcId, score: 1 }])], ["uuid", "jsonb"])).toMatch(/FORBIDDEN/);
    expect(await svcErr("b2b_match_inputs", [u.recB, r.A], ["uuid", "uuid"])).toMatch(/FORBIDDEN/);
  });
});

describe("share links", () => {
  let rcId: string;
  it("create (editors only), view (no contacts/comments), revoke, expire", async () => {
    rcId = String((await pipeline(u.recA, r.A, { search: "asha" })).rows[0].id);
    const CASTS = ["uuid", "uuid", "text", "int"];
    expect(await svcErr("b2b_create_share_link", [u.hmA, rcId, hash("s0"), 7], CASTS)).toMatch(/FORBIDDEN/);
    expect(await svcErr("b2b_create_share_link", [u.recB, rcId, hash("s0"), 7], CASTS)).toMatch(/FORBIDDEN/);
    expect((await svc<J>("b2b_create_share_link", [u.recA, rcId, hash("s0"), 31], CASTS)).reason).toBe("BAD_EXPIRY");
    const s = await svc<J>("b2b_create_share_link", [u.recA, rcId, hash("s1"), 7], CASTS);
    expect(s.ok).toBe(true);
    const view = await svc<J & { report: Record<string, unknown> }>("b2b_view_share", [hash("s1")], ["text"]);
    expect(view.status).toBe("ok");
    expect(view.report).toMatchObject({ candidate: { full_name: "Asha", email: null, phone: null }, comments: [], decisions: [] });
    expect((await one<{ view_count: number }>("SELECT view_count FROM share_links WHERE id = $1", [s.share_id])).view_count).toBe(1);
    expect((await one<{ n: string }>("SELECT count(*) AS n FROM audit_logs WHERE action = 'share_links.insert' AND actor_id = $1", [u.recA])).n).toBe(1);

    expect(await svcErr("b2b_revoke_share_link", [u.adminB, s.share_id], ["uuid", "uuid"])).toMatch(/FORBIDDEN/);
    await svc("b2b_revoke_share_link", [u.adminA, s.share_id], ["uuid", "uuid"]);
    expect((await svc<J>("b2b_view_share", [hash("s1")], ["text"])).status).toBe("revoked");

    const s2 = await svc<J>("b2b_create_share_link", [u.recA, rcId, hash("s2"), 1], CASTS);
    await db.query("UPDATE share_links SET created_at = now() - interval '3 days', expires_at = now() - interval '1 day' WHERE id = $1", [s2.share_id]);
    expect((await svc<J>("b2b_view_share", [hash("s2")], ["text"])).status).toBe("expired");
    expect((await svc<J>("b2b_view_share", [hash("nope")], ["text"])).status).toBe("invalid");
  });

  it("browser can revoke but not extend or un-revoke a link", async () => {
    const s = await svc<J>("b2b_create_share_link", [u.recA, rcId, hash("s3"), 5], ["uuid", "uuid", "text", "int"]);
    await asUser(db, u.recA, async (tx) => {
      expect(await expectRejected(tx, "UPDATE share_links SET expires_at = expires_at + interval '20 days' WHERE id = $1", [s.share_id])).toMatch(/only be revoked/);
      await tx.query("UPDATE share_links SET revoked_at = now() WHERE id = $1", [s.share_id]);
      expect(await expectRejected(tx, "UPDATE share_links SET revoked_at = NULL WHERE id = $1", [s.share_id])).toMatch(/only be revoked/);
    });
  });
});

describe("browser-write guards and isolation", () => {
  it("staff can't touch tokens, credits, scores or session links directly", async () => {
    const rcId = (await one<{ id: string }>("SELECT id FROM role_candidates WHERE job_role_id = $1 LIMIT 1", [r.A])).id;
    await asUser(db, u.recA, async (tx) => {
      expect(await expectRejected(tx, "UPDATE role_candidates SET credits_charged = false WHERE id = $1", [rcId])).toMatch(/only the stage/);
      expect(await expectRejected(tx, "UPDATE role_candidates SET match_score = 99 WHERE id = $1", [rcId])).toMatch(/only the stage/);
      expect(await expectRejected(tx, "UPDATE candidates SET user_id = $2 WHERE org_id = $1", [o.A, u.recA])).toMatch(/invite link only/);
      expect((await tx.query("UPDATE role_candidates SET stage = 'rejected' WHERE id = $1", [rcId])).affectedRows).toBe(1);
    });
  });

  it("company B sees nothing of company A (tables and functions)", async () => {
    await asUser(db, u.adminB, async (tx) => {
      for (const t of ["role_candidates", "candidates", "role_candidate_decisions", "share_links", "role_candidate_comments"]) {
        expect((await tx.query(`SELECT 1 FROM ${t} WHERE org_id = $1`, [o.A])).rows, t).toEqual([]);
      }
    });
    // Unassigned hiring managers see none of the role's rows either.
    await asUser(db, u.hmA2, async (tx) => {
      expect((await tx.query("SELECT 1 FROM role_candidates WHERE job_role_id = $1", [r.A])).rows).toEqual([]);
      expect((await tx.query("SELECT 1 FROM role_candidate_decisions WHERE org_id = $1", [o.A])).rows).toEqual([]);
    });
  });

  it("new functions are not callable from the browser", async () => {
    await asUser(db, u.adminA, async (tx) => {
      expect(await expectRejected(tx, "SELECT public.b2b_view_share('x')")).toMatch(/permission denied/);
      expect(await expectRejected(tx, "SELECT public.b2b_role_pipeline($1, $2, '{}', 1, 50, NULL, NULL)", [u.adminA, r.A])).toMatch(/permission denied/);
      expect(await expectRejected(tx, "SELECT public._b2b_rc_sync($1)", [r.A])).toMatch(/permission denied/);
    });
    await asUser(db, null, async (tx) => {
      expect(await expectRejected(tx, "SELECT public.b2b_resolve_candidate_token('x')")).toMatch(/permission denied/);
    });
  });
});
