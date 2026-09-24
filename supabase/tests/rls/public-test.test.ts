// @vitest-environment node
import { describe, it, expect, beforeAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createHash, randomUUID } from "node:crypto";
import { createTestDb, createUser, asUser, asService, expectRejected } from "../helpers/pgdb";
import { initState } from "../../functions/_shared/interview-engine";
import type { ModuleSpec } from "../../functions/_shared/module-spec";

let db: PGlite;
const u: Record<string, string> = {};
let org = "", otherOrg = "", mod = "", privateMod = "";
const spec: ModuleSpec = { name: "Java Readiness", type: "skill", topics: ["OOP", "Collections"], pass_threshold: 6, max_turns: 12, max_minutes: 15 };
type R = Record<string, unknown>;
const h = (s: string) => createHash("sha256").update(s).digest("hex");
async function one<T = R>(sql: string, params: unknown[] = []): Promise<T> {
  return (await db.query<T>(sql, params)).rows[0];
}

let n = 0;
async function startTest(over: Partial<{ user: string; slug: string; module: string; phone: string; email: string; ip: string | null; consent: string }> = {}) {
  n++;
  const user = over.user ?? await createUser(db);
  const phone = over.phone ?? `+9198765${String(10000 + n).slice(-5)}`;
  const email = over.email ?? `visitor${n}@gmail.com`;
  return asService(db, async (tx) => (await tx.query<{ r: R }>(
    "SELECT public.b2b_start_public_test($1, $2, $3, 1, $4, 'p', 'Ravi Kumar', $5, $6, 'Java Full Stack', $7, $8, $9, 'v1', $10, '{}'::jsonb) AS r",
    [user, over.slug ?? "java-academy", over.module ?? mod, JSON.stringify(initState(over.module ?? mod, spec)), phone, email,
      h(phone), h(email), over.ip === undefined ? h(`10.0.0.${n}`) : over.ip, over.consent ?? "I agree to be contacted."])).rows[0].r);
}

beforeAll(async () => {
  db = await createTestDb();
  for (const k of ["admin", "trainer", "student", "otherAdmin"]) u[k] = await createUser(db);
  org = (await one<{ id: string }>(
    "INSERT INTO organizations (name, slug, type, public_test_enabled, public_test_monthly_cap, public_test_cta_label, public_test_cta_url) VALUES ('Java Academy', 'java-academy', 'coaching_institute', true, 8, 'Enquire now', 'https://wa.me/919876543210') RETURNING id")).id;
  otherOrg = (await one<{ id: string }>("INSERT INTO organizations (name, slug, type) VALUES ('Other Institute', 'other-institute', 'coaching_institute') RETURNING id")).id;
  await db.query("INSERT INTO org_memberships (org_id, user_id, role) VALUES ($1, $2, 'org_admin'), ($1, $3, 'trainer'), ($1, $4, 'student'), ($5, $6, 'org_admin')",
    [org, u.admin, u.trainer, u.student, otherOrg, u.otherAdmin]);
  mod = (await one<{ id: string }>("INSERT INTO interview_modules (org_id, spec, public_test) VALUES ($1, $2, true) RETURNING id", [org, JSON.stringify(spec)])).id;
  privateMod = (await one<{ id: string }>("INSERT INTO interview_modules (org_id, spec) VALUES ($1, $2) RETURNING id", [org, JSON.stringify({ ...spec, name: "Internal only" })])).id;
});

describe("public_test_info", () => {
  it("is callable anonymously and lists only public modules, shortened", async () => {
    await asUser(db, null, async (tx) => {
      const info = (await tx.query<{ i: R }>("SELECT public.public_test_info('Java-Academy') AS i")).rows[0].i;
      expect(info).toMatchObject({
        available: true,
        org: { name: "Java Academy", cta_label: "Enquire now", cta_url: "https://wa.me/919876543210" },
        modules: [{ id: mod, name: "Java Readiness", minutes: 10, questions: 6 }],
      });
      expect(JSON.stringify(info)).not.toContain("Internal only");
      expect((await tx.query<{ i: R | null }>("SELECT public.public_test_info('other-institute') AS i")).rows[0].i).toBeNull(); // not enabled
    });
  });
});

describe("b2b_start_public_test", () => {
  it("creates a lead and a short public-test interview without using student credits", async () => {
    const r = await startTest();
    expect(r).toMatchObject({ ok: true });
    const iv = await one<R>("SELECT kind, lead_id, module_spec->>'max_turns' AS turns, module_spec->>'max_minutes' AS mins FROM b2b_interviews WHERE id = $1", [r.interview_id]);
    expect(iv).toEqual({ kind: "public_test", lead_id: r.lead_id, turns: "6", mins: "10" });
    const lead = await one<R>("SELECT full_name, target_course, status, interview_id, consent_text FROM org_leads WHERE id = $1", [r.lead_id]);
    expect(lead).toMatchObject({ full_name: "Ravi Kumar", target_course: "Java Full Stack", status: "new", interview_id: r.interview_id, consent_text: "I agree to be contacted." });
    expect(await one("SELECT count(*)::int AS n FROM org_student_usage")).toEqual({ n: 0 });
  });

  it("refuses private modules, disabled orgs, and missing consent", async () => {
    expect(await startTest({ module: privateMod })).toMatchObject({ ok: false, reason: "MODULE_UNAVAILABLE" });
    expect(await startTest({ slug: "other-institute" })).toMatchObject({ ok: false, reason: "NOT_AVAILABLE" });
    expect(await startTest({ consent: "" })).toMatchObject({ ok: false, reason: "CONSENT_REQUIRED" });
  });

  it("limits the same phone or email to 2 tests per 30 days", async () => {
    const phone = "+919000000001";
    expect(await startTest({ phone })).toMatchObject({ ok: true });
    expect(await startTest({ phone })).toMatchObject({ ok: true });
    expect(await startTest({ phone })).toMatchObject({ ok: false, reason: "ALREADY_TAKEN" });
    const email = "same@gmail.com";
    await startTest({ email });
    await startTest({ email });
    expect(await startTest({ email })).toMatchObject({ ok: false, reason: "ALREADY_TAKEN" });
  });

  it("limits one IP to 5 tests per org per day", async () => {
    await db.query("UPDATE organizations SET public_test_monthly_cap = 1000 WHERE id = $1", [org]);
    const ip = h("203.0.113.9");
    for (let i = 0; i < 5; i++) expect(await startTest({ ip })).toMatchObject({ ok: true });
    expect(await startTest({ ip })).toMatchObject({ ok: false, reason: "RATE_LIMITED" });
  });

  it("enforces the monthly cap and reports it as unavailable publicly", async () => {
    const used = (await one<{ n: number }>("SELECT count(*)::int AS n FROM b2b_interviews WHERE org_id = $1 AND kind = 'public_test'", [org])).n;
    await db.query("UPDATE organizations SET public_test_monthly_cap = $2 WHERE id = $1", [org, used]);
    expect(await startTest()).toMatchObject({ ok: false, reason: "MONTHLY_CAP" });
    await asUser(db, null, async (tx) => {
      expect((await tx.query<{ i: R }>("SELECT public.public_test_info('java-academy') AS i")).rows[0].i).toMatchObject({ available: false });
    });
    await db.query("UPDATE organizations SET public_test_monthly_cap = 1000 WHERE id = $1", [org]);
  });

  it("an AI failure at start doesn't count against the visitor or the monthly cap", async () => {
    const phone = "+919111111111";
    const first = await startTest({ phone });
    await startTest({ phone });
    await asService(db, (tx) => tx.query("SELECT public.b2b_public_test_failed_start($1)", [first.interview_id]));
    expect(await one("SELECT status FROM b2b_interviews WHERE id = $1", [first.interview_id])).toEqual({ status: "cancelled" });
    expect(await startTest({ phone })).toMatchObject({ ok: true }); // the failed one no longer counts
    const usage = await asUser(db, u.admin, async (tx) => (await tx.query<{ u: { used_this_month: number } }>("SELECT public.org_public_test_usage($1) AS u", [org])).rows[0].u);
    const counted = (await one<{ n: number }>("SELECT count(*)::int AS n FROM b2b_interviews WHERE org_id = $1 AND kind = 'public_test' AND status <> 'cancelled'", [org])).n;
    expect(Number(usage.used_this_month)).toBe(counted);
  });

  it("one test at a time per visitor session", async () => {
    const visitor = await createUser(db);
    expect(await startTest({ user: visitor })).toMatchObject({ ok: true });
    expect(await startTest({ user: visitor })).toMatchObject({ ok: false, reason: "IN_PROGRESS" });
  });

  it("is service-role only", async () => {
    await asUser(db, u.admin, async (tx) => {
      expect(await expectRejected(tx, "SELECT public.b2b_start_public_test($1, 'java-academy', $2, 1, '{}'::jsonb, 'p', 'a b', '+919000000009', 'x@y.in', null, 'a', 'b', 'c', 'v', 't', '{}'::jsonb)", [u.admin, mod]))
        .toMatch(/permission denied/);
    });
  });
});

describe("leads", () => {
  it("staff see their org's leads; results sync from the evaluation; only status is editable", async () => {
    const r = await startTest();
    await db.query(
      `INSERT INTO b2b_evaluations (interview_id, org_id, user_id, module_id, evaluator_version, status, overall_score, readiness_level, primary_gap, completed_at)
       SELECT id, org_id, user_id, module_id, 'v', 'completed', 5.5, 'developing', 'Collections depth', now() FROM b2b_interviews WHERE id = $1`, [r.interview_id]);
    expect(await one("SELECT overall_score, readiness_level, primary_gap FROM org_leads WHERE id = $1", [r.lead_id]))
      .toEqual({ overall_score: "5.5", readiness_level: "developing", primary_gap: "Collections depth" });

    await asUser(db, u.trainer, async (tx) => {
      expect((await tx.query("SELECT * FROM org_leads WHERE id = $1", [r.lead_id])).rows).toHaveLength(1);
      expect((await tx.query("UPDATE org_leads SET status = 'contacted' WHERE id = $1", [r.lead_id])).affectedRows ?? 0).toBe(0);
    });
    await asUser(db, u.admin, async (tx) => {
      expect((await tx.query("UPDATE org_leads SET status = 'contacted' WHERE id = $1", [r.lead_id])).affectedRows).toBe(1);
      expect(await expectRejected(tx, "UPDATE org_leads SET phone = '+919999999999' WHERE id = $1", [r.lead_id])).toMatch(/Only a lead's status/);
      expect(await expectRejected(tx, "UPDATE org_leads SET overall_score = 9 WHERE id = $1", [r.lead_id])).toMatch(/Only a lead's status/);
    });
    for (const who of [u.student, u.otherAdmin, null]) {
      await asUser(db, who, async (tx) => expect((await tx.query("SELECT * FROM org_leads")).rows).toEqual([]));
    }
  });

  it("public tests never appear in the student dashboard", async () => {
    await asUser(db, u.admin, async (tx) => {
      const rows = (await tx.query("SELECT * FROM public.org_dashboard_evaluations($1)", [org])).rows;
      expect(rows).toEqual([]);
    });
  });

  it("org admins manage settings via RPC but can't change the cap; usage is visible to staff", async () => {
    await asUser(db, u.admin, async (tx) => {
      await tx.query("SELECT public.org_update_public_test_settings($1, true, 'Talk to us', 'tel:+919876543210')", [org]);
      expect((await tx.query("UPDATE organizations SET public_test_monthly_cap = 99999 WHERE id = $1", [org])).affectedRows ?? 0).toBe(0);
    }, { commit: true });
    expect(await one("SELECT public_test_cta_label, public_test_cta_url FROM organizations WHERE id = $1", [org]))
      .toEqual({ public_test_cta_label: "Talk to us", public_test_cta_url: "tel:+919876543210" });
    await asUser(db, u.otherAdmin, async (tx) => {
      expect(await expectRejected(tx, "SELECT public.org_update_public_test_settings($1, false, null, null)", [org])).toMatch(/FORBIDDEN/);
    });
    await asUser(db, u.trainer, async (tx) => {
      const usage = (await tx.query<{ u: R }>("SELECT public.org_public_test_usage($1) AS u", [org])).rows[0].u;
      expect(usage).toMatchObject({ enabled: true, monthly_cap: 1000, slug: "java-academy" });
      expect(Number(usage.used_this_month)).toBeGreaterThan(5);
    });
  });

  it("rejects unsafe CTA links", async () => {
    await expect(db.query("UPDATE organizations SET public_test_cta_url = 'javascript:alert(1)' WHERE id = $1", [org])).rejects.toThrow(/check/);
  });
});

void randomUUID;
