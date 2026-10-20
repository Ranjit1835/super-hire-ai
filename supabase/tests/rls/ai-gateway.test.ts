// @vitest-environment node
// AI gateway storage: single-flight cache claims, quotas, cost logging with cached tokens.
import { describe, it, expect, beforeAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb, createUser, asUser, asService, expectRejected } from "../helpers/pgdb";

let db: PGlite;
let org = "";
type Row = Record<string, unknown>;
const svc = <T = Row>(sql: string, params: unknown[] = []) =>
  asService(db, async (tx) => (await tx.query<{ r: T }>(sql, params)).rows[0].r);
const key = (c: string) => c.repeat(64).slice(0, 64);
const claim = (k: string, stale = 90) =>
  svc<Row>("SELECT public.b2b_ai_cache_claim($1, 'jd.skills', 'v1', 'gemini-3.6-flash', $2, $3) AS r", [k, org, stale]);

beforeAll(async () => {
  db = await createTestDb();
  org = (await db.query<{ id: string }>("INSERT INTO organizations (name, slug, type) VALUES ('Acme', 'acme', 'company') RETURNING id")).rows[0].id;
});

describe("single-flight cache", () => {
  it("first caller claims, concurrent callers wait, everyone gets the filled result", async () => {
    const k = key("a");
    const first = await claim(k);
    expect(first.state).toBe("claimed");
    expect(await claim(k)).toEqual({ state: "wait" });
    expect(await svc("SELECT public.b2b_ai_cache_fill($1, $2, '{\"skills\":[\"sql\"]}', 3600) AS r", [k, first.token])).toBe(true);
    expect(await claim(k)).toEqual({ state: "hit", response: { skills: ["sql"] } });
    expect((await db.query<{ hits: number }>("SELECT hits FROM ai_cache WHERE key = $1", [k])).rows[0].hits).toBe(1);
  });

  it("a stale claim (worker died) can be taken over, and the old worker can't overwrite it", async () => {
    const k = key("b");
    const dead = await claim(k);
    await db.query("UPDATE ai_cache SET updated_at = now() - interval '5 minutes' WHERE key = $1", [k]);
    const fresh = await claim(k);
    expect(fresh.state).toBe("claimed");
    expect(await svc("SELECT public.b2b_ai_cache_fill($1, $2, '{\"x\":1}', NULL) AS r", [k, dead.token])).toBe(false);
    expect(await svc("SELECT public.b2b_ai_cache_fill($1, $2, '{\"x\":2}', NULL) AS r", [k, fresh.token])).toBe(true);
    expect(await claim(k)).toMatchObject({ state: "hit", response: { x: 2 } });
  });

  it("a failed computation releases the key; expired entries are recomputed", async () => {
    const k = key("c");
    const c1 = await claim(k);
    await svc("SELECT public.b2b_ai_cache_release($1, $2) AS r", [k, c1.token]);
    expect((await claim(k)).state).toBe("claimed");

    const k2 = key("d");
    const c2 = await claim(k2);
    await svc("SELECT public.b2b_ai_cache_fill($1, $2, '{}', 60) AS r", [k2, c2.token]);
    await db.query("UPDATE ai_cache SET expires_at = now() - interval '1 second' WHERE key = $1", [k2]);
    expect((await claim(k2)).state).toBe("claimed");
  });

  it("bumping a prompt version prunes the old entries", async () => {
    await db.query("INSERT INTO ai_cache (key, feature, prompt_version, model, status, response) VALUES ($1, 'q.gen', 'v1', 'm', 'ready', '{}'), ($2, 'q.gen', 'v2', 'm', 'ready', '{}')", [key("e"), key("f")]);
    expect(await svc("SELECT public.b2b_ai_cache_prune('q.gen', 'v2') AS r")).toBe(1);
    expect((await db.query("SELECT prompt_version FROM ai_cache WHERE feature = 'q.gen'")).rows).toEqual([{ prompt_version: "v2" }]);
  });

  it("nobody but the service role can call the cache functions", async () => {
    const admin = await createUser(db, { superAdmin: true });
    await asUser(db, admin, async (tx) => {
      expect(await expectRejected(tx, "SELECT public.b2b_ai_cache_claim($1, 'f', 'v', 'm', NULL, 90)", [key("z")])).toMatch(/permission denied/);
      expect(await expectRejected(tx, "SELECT public.b2b_take_quota($1, 'f', 1)", [org])).toMatch(/permission denied/);
    });
  });
});

describe("quotas", () => {
  it("count per org and feature per IST month, and stop at the limit", async () => {
    await db.query(`UPDATE organizations SET settings = '{"quotas": {"jd.skills": 2}}' WHERE id = $1`, [org]);
    const take = () => svc<Row>("SELECT public.b2b_take_quota($1, 'jd.skills', 1) AS r", [org]);
    expect(await take()).toMatchObject({ ok: true, used: 1, limit: 2 });
    expect(await take()).toMatchObject({ ok: true, used: 2 });
    expect(await take()).toMatchObject({ ok: false, reason: "QUOTA_EXCEEDED", used: 2, limit: 2 });
    expect(await svc("SELECT public.b2b_take_quota($1, 'other.feature', 5) AS r", [org])).toMatchObject({ ok: true, used: 5, limit: null });
  });

  it("a request bigger than the whole limit is refused without leaving usage behind", async () => {
    await db.query(`UPDATE organizations SET settings = '{"quotas": {"big": 3}}' WHERE id = $1`, [org]);
    expect(await svc("SELECT public.b2b_take_quota($1, 'big', 5) AS r", [org])).toMatchObject({ ok: false });
    expect(await svc("SELECT public.b2b_take_quota($1, 'big', 3) AS r", [org])).toMatchObject({ ok: true, used: 3 });
  });
});

describe("cost log", () => {
  it("bills cached input at a tenth of the input rate, and cache hits at zero", async () => {
    await db.query("INSERT INTO b2b_pricing (provider_key, input_inr_per_million, output_inr_per_million) VALUES ('test-model', 100, 400)");
    // 1M input of which 400k cached: 600k × 100 + 400k × 10 + 100k out × 400 → 60 + 4 + 40 = ₹104
    const cost = await svc<string>(
      "SELECT public.b2b_log_ai_usage($1, NULL, 'jd.skills', 'test-model', 1000000, 400000, 100000, 1200, false) AS r", [org]);
    expect(Number(cost)).toBeCloseTo(104, 4);
    expect(Number(await svc<string>(
      "SELECT public.b2b_log_ai_usage($1, NULL, 'jd.skills', 'test-model', 1000000, 0, 100000, 5, true) AS r", [org]))).toBe(0);
    const rows = (await db.query("SELECT feature, cache_hit, input_tokens, cached_input_tokens FROM b2b_usage_log WHERE provider_key = 'test-model' ORDER BY created_at, cache_hit")).rows;
    expect(rows).toEqual([
      { feature: "jd.skills", cache_hit: false, input_tokens: 1000000, cached_input_tokens: 400000 },
      { feature: "jd.skills", cache_hit: true, input_tokens: 0, cached_input_tokens: 0 },
    ]);
  });

  it("the super-admin usage report shows cost, cache hits and credits per org; others are refused", async () => {
    const sa = await createUser(db, { superAdmin: true });
    const rows = await asUser(db, sa, async (tx) => (await tx.query<Row>("SELECT org_name, ai_calls_month, cache_hits_month, cache_hit_rate_month FROM public.super_org_usage()")).rows);
    expect(rows).toEqual([{ org_name: "Acme", ai_calls_month: 2, cache_hits_month: 1, cache_hit_rate_month: "0.500" }]);
    const nobody = await createUser(db);
    await asUser(db, nobody, async (tx) => {
      expect(await expectRejected(tx, "SELECT * FROM public.super_org_usage()")).toMatch(/FORBIDDEN/);
    });
  });
});
