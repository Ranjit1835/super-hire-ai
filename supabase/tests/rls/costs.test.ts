// @vitest-environment node
import { describe, it, expect, beforeAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { createTestDb, createUser, asUser, asService, expectRejected } from "../helpers/pgdb";
import { initState } from "../../functions/_shared/interview-engine";
import type { ModuleSpec } from "../../functions/_shared/module-spec";

let db: PGlite;
const u: Record<string, string> = {};
let org = "", demoOrg = "", mod = "", iv = "";
const spec: ModuleSpec = { name: "SQL", type: "skill", topics: ["Joins", "Indexes"], pass_threshold: 6, max_turns: 5, max_minutes: 10 };
type R = Record<string, unknown>;
async function one<T = R>(sql: string, params: unknown[] = []): Promise<T> {
  return (await db.query<T>(sql, params)).rows[0];
}
const usage = (model: string, input: number, output: number, extra: R = {}) => ({ model, input_tokens: input, output_tokens: output, latency_ms: 1200, attempts: 1, ...extra });

beforeAll(async () => {
  db = await createTestDb();
  u.super = await createUser(db, { superAdmin: true });
  for (const k of ["student", "admin"]) u[k] = await createUser(db);
  org = (await one<{ id: string }>("INSERT INTO organizations (name, slug, type) VALUES ('Cost College', 'cost-college', 'college') RETURNING id")).id;
  demoOrg = (await one<{ id: string }>("INSERT INTO organizations (name, slug, type, is_demo) VALUES ('Demo College', 'demo-cost', 'college', true) RETURNING id")).id;
  await db.query("UPDATE plans SET price_inr_per_student = 300 WHERE id = 'pilot'");
  await db.query("INSERT INTO org_memberships (org_id, user_id, role) VALUES ($1, $2, 'student'), ($1, $3, 'org_admin')", [org, u.student, u.admin]);
  mod = (await one<{ id: string }>("INSERT INTO interview_modules (org_id, spec) VALUES ($1, $2) RETURNING id", [org, JSON.stringify(spec)])).id;
  const s = await asService(db, async (tx) => (await tx.query<{ r: { interview_id: string } }>(
    "SELECT public.b2b_start_interview($1, $2, 1, $3, 'p', '{}'::jsonb) AS r", [u.student, mod, JSON.stringify(initState(mod, spec))])).rows[0].r);
  iv = s.interview_id;
});

describe("pricing lookup", () => {
  it("prefers an exact model, then the longest matching pattern, then the default", async () => {
    await db.query("INSERT INTO b2b_pricing (provider_key, input_inr_per_million, output_inr_per_million) VALUES ('gemini-%', 20, 150), ('gemini-9-pro', 100, 800)");
    const price = async (k: string) => asService(db, async (tx) =>
      (await tx.query<{ input_inr_per_million: string }>("SELECT (public.b2b_price_for($1)).input_inr_per_million", [k])).rows[0].input_inr_per_million);
    expect(Number(await price("gemini-9-pro"))).toBe(100);
    expect(Number(await price("gemini-3.6-flash"))).toBe(20);
    expect(Number(await price("some-other-model"))).toBe(25.2);
  });
});

describe("logging inside the write paths", () => {
  it("opening logs its model call and spoken characters once, even if retried", async () => {
    const meta = JSON.stringify({ llm: [usage("gemini-3.6-flash", 1000, 200)] });
    for (let i = 0; i < 2; i++) {
      await asService(db, (tx) => tx.query("SELECT public.b2b_record_opening($1, 'Tell me about joins.', $2, $3)", [iv, meta, JSON.stringify(initState(mod, spec))]));
    }
    const rows = (await db.query<R>("SELECT kind, purpose, provider_key, input_tokens, output_tokens, tts_chars, cost_inr FROM b2b_usage_log WHERE interview_id = $1 ORDER BY kind", [iv])).rows;
    expect(rows).toEqual([
      { kind: "llm", purpose: "opening", provider_key: "gemini-3.6-flash", input_tokens: 1000, output_tokens: 200, tts_chars: 0, cost_inr: "0.050000" }, // 1000×20/1e6 + 200×150/1e6
      { kind: "tts", purpose: "question", provider_key: "tts:browser", input_tokens: 0, output_tokens: 0, tts_chars: 20, cost_inr: "0.000000" },
    ]);
  });

  it("each answer logs STT seconds, every model call (incl. regenerate) and the next question's characters; retries don't double count", async () => {
    const ct = randomUUID();
    const call = () => asService(db, (tx) => tx.query(
      "SELECT public.b2b_record_turn($1, $2, 0, $3, 'answer', $4, 'Joins', 'beginner', 'What is an index?', $5, $6, NULL)",
      [iv, u.student, ct, JSON.stringify({ input_mode: "voice", speech_ms: 42500 }),
        JSON.stringify({ llm: [usage("gemini-3.6-flash", 2000, 300), usage("gemini-3.6-flash", 500, 50)] }),
        JSON.stringify({ ...initState(mod, spec), turn_count: 1 })]));
    await call();
    await call(); // network retry with the same clientTurnId
    const rows = (await db.query<R>("SELECT kind, stt_seconds, tts_chars FROM b2b_usage_log WHERE interview_id = $1 AND purpose <> 'opening' AND NOT (kind = 'tts' AND tts_chars = 20) ORDER BY kind, stt_seconds", [iv])).rows;
    expect(rows).toEqual([
      { kind: "llm", stt_seconds: "0.00", tts_chars: 0 },
      { kind: "llm", stt_seconds: "0.00", tts_chars: 0 },
      { kind: "stt", stt_seconds: "42.50", tts_chars: 0 },
      { kind: "tts", stt_seconds: "0.00", tts_chars: 17 },
    ]);
  });

  it("typed answers log no speech time", async () => {
    await asService(db, (tx) => tx.query(
      "SELECT public.b2b_record_turn($1, $2, 1, $3, 'typed', $4, 'Indexes', 'beginner', NULL, '{}'::jsonb, $5, 'max_turns')",
      [iv, u.student, randomUUID(), JSON.stringify({ input_mode: "text", speech_ms: 9999 }), JSON.stringify({ ...initState(mod, spec), turn_count: 2 })]));
    expect(await one("SELECT count(*)::int AS n FROM b2b_usage_log WHERE interview_id = $1 AND kind = 'stt'", [iv])).toEqual({ n: 1 });
  });

  it("evaluation logs every attempt's tokens, including failed ones", async () => {
    const ev = (await one<{ id: string }>("INSERT INTO b2b_evaluations (interview_id, org_id, user_id, module_id, evaluator_version) VALUES ($1, $2, $3, $4, 'v') RETURNING id", [iv, org, u.student, mod])).id;
    await asService(db, (tx) => tx.query("SELECT public.b2b_save_evaluation($1, 'failed', 'm', NULL, NULL, NULL, NULL, NULL, 1, $2, 'bad json')",
      [ev, JSON.stringify([usage("gemini-3.6-flash", 6000, 2000, { purpose: "evaluation" })])]));
    await asService(db, (tx) => tx.query("SELECT public.b2b_save_evaluation($1, 'completed', 'm', '{}'::jsonb, '{}'::jsonb, 6, 'developing', 'g', 1, $2, NULL)",
      [ev, JSON.stringify([usage("gemini-3.6-flash", 6000, 1800, { purpose: "evaluation" })])]));
    expect(await one("SELECT count(*)::int AS n, sum(output_tokens)::int AS out FROM b2b_usage_log WHERE interview_id = $1 AND purpose = 'evaluation'", [iv]))
      .toEqual({ n: 2, out: 3800 });
  });
});

describe("super-admin reports", () => {
  it("aggregate cost per org per month, excluding demo orgs by default", async () => {
    await asService(db, (tx) => tx.query("SELECT public.b2b_log_usage($1, NULL, 'llm', 'turn', 'gemini-3.6-flash', 1000000, 0, 0, 0, NULL)", [demoOrg]));
    await asUser(db, u.super, async (tx) => {
      const rows = (await tx.query<R>("SELECT * FROM public.super_cost_by_org_month()")).rows;
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ org_id: org, interviews: 1, llm_calls: 5, input_tokens: 15500 });
      expect(Number(rows[0].cost_inr)).toBeGreaterThan(0);
      expect(Number(rows[0].cost_per_interview)).toBe(Number(rows[0].cost_inr));
      expect((await tx.query("SELECT * FROM public.super_cost_by_org_month(true)")).rows).toHaveLength(2);
    });
  });

  it("compares cost with plan revenue (students × price)", async () => {
    await asUser(db, u.super, async (tx) => {
      const r = (await tx.query<R>("SELECT * FROM public.super_cost_vs_revenue() WHERE org_id = $1", [org])).rows[0];
      expect(r).toMatchObject({ plan_id: "pilot", students: 1, revenue_inr: "300.00", interviews: 1 });
      expect(Number(r.margin_inr)).toBeCloseTo(300 - Number(r.cost_inr), 2);
      expect(Number(r.cost_share)).toBeCloseTo(Number(r.cost_inr) / 300, 3);
    });
  });

  it("re-prices logged events after the rates are corrected (super-admin only)", async () => {
    const before = await one<{ c: string }>("SELECT sum(cost_inr) AS c FROM b2b_usage_log WHERE org_id = $1 AND kind = 'llm'", [org]);
    await db.query("INSERT INTO b2b_pricing (provider_key, input_inr_per_million, output_inr_per_million) VALUES ('gemini-3.6-flash', 40, 300)");
    await asUser(db, u.admin, async (tx) => {
      expect(await expectRejected(tx, "SELECT public.super_recompute_costs()")).toMatch(/FORBIDDEN/);
    });
    await asUser(db, u.super, async (tx) => {
      const n = (await tx.query<{ n: number }>("SELECT public.super_recompute_costs() AS n")).rows[0].n;
      expect(n).toBeGreaterThan(0);
    }, { commit: true });
    const after = await one<{ c: string; tokens_in: number; tokens_out: number }>(
      "SELECT sum(cost_inr) AS c, sum(input_tokens)::int AS tokens_in, sum(output_tokens)::int AS tokens_out FROM b2b_usage_log WHERE org_id = $1 AND kind = 'llm'", [org]);
    expect(Number(after.c)).toBeCloseTo((after.tokens_in * 40 + after.tokens_out * 300) / 1e6, 5);
    expect(Number(after.c)).toBeGreaterThan(Number(before.c));
  });

  it("costs and pricing are invisible to institutions and students", async () => {
    for (const who of [u.admin, u.student]) {
      await asUser(db, who, async (tx) => {
        expect((await tx.query("SELECT * FROM b2b_usage_log")).rows).toEqual([]);
        expect((await tx.query("SELECT * FROM b2b_pricing")).rows).toEqual([]);
        expect(await expectRejected(tx, "SELECT * FROM public.super_cost_by_org_month()")).toMatch(/FORBIDDEN/);
        expect(await expectRejected(tx, "SELECT public.b2b_log_usage($1, NULL, 'llm', 'x', 'm', 1, 1, 0, 0, NULL)", [org])).toMatch(/permission denied/);
      });
    }
  });
});
