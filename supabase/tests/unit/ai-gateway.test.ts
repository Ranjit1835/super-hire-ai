// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  gateway, cacheKeyMaterial, normalize, type Claim, type FeatureConfig, type GatewayStore, type Provider, type UsageRow,
} from "../../functions/_shared/ai-gateway/core";
import { FEATURES, makeConfig } from "../../functions/_shared/ai-gateway/config";

const Skills = z.object({ skills: z.array(z.string()).min(1) });
const sha = async (s: string) => createHash("sha256").update(s).digest("hex");

/** In-memory store with the same single-flight semantics as b2b_ai_cache_claim. */
function memStore() {
  const rows = new Map<string, { status: "pending" | "ready"; token?: string; response?: unknown }>();
  const usage: UsageRow[] = [];
  const quotas = new Map<string, number>();
  let tokenN = 0;
  const store: GatewayStore & { usage: UsageRow[]; rows: typeof rows; limits: Map<string, number> } = {
    usage, rows, limits: new Map(),
    async claim(key): Promise<Claim> {
      const r = rows.get(key);
      if (!r) { const token = `t${++tokenN}`; rows.set(key, { status: "pending", token }); return { state: "claimed", token }; }
      if (r.status === "ready") return { state: "hit", response: r.response };
      return { state: "wait" };
    },
    async fill(key, token, response) { const r = rows.get(key); if (r?.token === token) rows.set(key, { status: "ready", response }); },
    async release(key, token) { if (rows.get(key)?.token === token) rows.delete(key); },
    async takeQuota(orgId, q) {
      const k = `${orgId}:${q}`; const used = (quotas.get(k) ?? 0) + 1; const limit = store.limits.get(q);
      if (limit !== undefined && used > limit) return { ok: false, used: used - 1, limit };
      quotas.set(k, used); return { ok: true, used, limit: limit ?? null };
    },
    async logUsage(u) { usage.push(u); },
  };
  return store;
}

function fakeProvider(outputs: unknown[], delayMs = 0): Provider & { calls: number } {
  const p = {
    calls: 0,
    async complete() {
      const out = outputs[Math.min(p.calls, outputs.length - 1)];
      p.calls++;
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      if (out instanceof Error) throw out;
      return { output: out, inputTokens: 1000, cachedInputTokens: 400, outputTokens: 200 };
    },
  };
  return p;
}

const cfg = (over: Partial<FeatureConfig> = {}): FeatureConfig => ({
  provider: "fake", model: "m1", promptVersion: "v1", cache: "org", ttlSeconds: 60, maxTokens: 100, timeoutMs: 1000, ...over,
});

function run(store: ReturnType<typeof memStore>, provider: Provider, c: FeatureConfig, input: unknown = { jd: "Java dev" }, orgId: string | null = "org-1") {
  return gateway({
    feature: "jd.skills_matrix", orgId, userId: "u1", system: "Extract skills.", messages: [{ role: "user", content: "JD" }],
    cacheInput: input, jsonSchema: {}, schemaName: "skills", parse: Skills.safeParse,
  }, { config: () => c, providers: { fake: provider }, store, sha256Hex: sha, sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 5))) });
}

describe("ai gateway", () => {
  it("calls the provider once, then serves duplicates from the cache (logged as cache hits)", async () => {
    const store = memStore(); const p = fakeProvider([{ skills: ["java"] }]);
    expect(await run(store, p, cfg())).toEqual({ ok: true, data: { skills: ["java"] }, cacheHit: false });
    expect(await run(store, p, cfg(), { jd: "  Java   dev " })).toEqual({ ok: true, data: { skills: ["java"] }, cacheHit: true });
    expect(p.calls).toBe(1);
    expect(store.usage.map((u) => [u.cacheHit, u.cachedInputTokens])).toEqual([[false, 400], [true, 0]]);
  });

  it("single flight: concurrent identical requests make one model call", async () => {
    const store = memStore(); const p = fakeProvider([{ skills: ["sql"] }], 30);
    const results = await Promise.all(Array.from({ length: 20 }, () => run(store, p, cfg())));
    expect(p.calls).toBe(1);
    expect(results.every((r) => r.ok && r.data.skills[0] === "sql")).toBe(true);
    expect(results.filter((r) => r.ok && r.cacheHit)).toHaveLength(19);
  });

  it("caches per org for personal data, globally for shared content, and never for 'none'", async () => {
    const store = memStore(); const p = fakeProvider([{ skills: ["a"] }]);
    await run(store, p, cfg(), { jd: "x" }, "org-1");
    await run(store, p, cfg(), { jd: "x" }, "org-2");
    expect(p.calls).toBe(2);
    const g = cfg({ cache: "global" });
    await run(store, p, g, { q: 1 }, "org-1"); await run(store, p, g, { q: 1 }, "org-2");
    expect(p.calls).toBe(3);
    const none = cfg({ cache: "none" });
    await run(store, p, none, { t: 1 }); await run(store, p, none, { t: 1 });
    expect(p.calls).toBe(5);
  });

  it("a new prompt version or model is a different cache key", () => {
    const a = cacheKeyMaterial("f", cfg(), "o", { x: 1 });
    expect(cacheKeyMaterial("f", cfg({ promptVersion: "v2" }), "o", { x: 1 })).not.toBe(a);
    expect(cacheKeyMaterial("f", cfg({ model: "m2" }), "o", { x: 1 })).not.toBe(a);
    expect(normalize({ b: " a  b ", a: [1, { d: 1, c: undefined }] })).toEqual({ a: [1, { d: 1 }], b: "a b" });
  });

  it("retries once with the validation errors, then fails without caching", async () => {
    const store = memStore();
    const fixed = fakeProvider([{ skills: [] }, { skills: ["go"] }]);
    expect(await run(store, fixed, cfg())).toMatchObject({ ok: true, data: { skills: ["go"] } });
    expect(fixed.calls).toBe(2);

    const store2 = memStore(); const bad = fakeProvider([{ nope: 1 }, { nope: 2 }]);
    expect(await run(store2, bad, cfg())).toMatchObject({ ok: false, code: "INVALID_OUTPUT" });
    expect(store2.rows.size).toBe(0);       // claim released: the next caller computes
  });

  it("provider errors release the claim; quotas stop real calls but not cache hits", async () => {
    const store = memStore();
    expect(await run(store, fakeProvider([new Error("503")]), cfg())).toMatchObject({ ok: false, code: "PROVIDER_ERROR" });
    expect(store.rows.size).toBe(0);

    const q = cfg({ quotaKey: "jd.skills_matrix" });
    const store2 = memStore(); store2.limits.set("jd.skills_matrix", 1);
    const p = fakeProvider([{ skills: ["k"] }]);
    expect(await run(store2, p, q, { jd: 1 })).toMatchObject({ ok: true });
    expect(await run(store2, p, q, { jd: 2 })).toMatchObject({ ok: false, code: "QUOTA_EXCEEDED" });
    expect(await run(store2, p, q, { jd: 1 })).toMatchObject({ ok: true, cacheHit: true });
  });

  it("feature config: live interview turns and evaluations are never cached; overrides apply per feature", () => {
    expect(FEATURES["interview.turn"].cache).toBe("none");
    expect(FEATURES["interview.evaluate"].cache).toBe("none");
    for (const [name, f] of Object.entries(FEATURES)) {
      if (name.startsWith("resume.") || name.startsWith("jd.")) expect(f.cache, name).toBe("org");
    }
    const c = makeConfig(JSON.stringify({ "jd.skills_matrix": { provider: "other", model: "x-1" } }));
    expect(c("jd.skills_matrix")).toMatchObject({ provider: "other", model: "x-1", cache: "org" });
    expect(c("question.generate").provider).toBe("gemini");
    expect(() => c("nope")).toThrow(/Unknown AI feature/);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(makeConfig("{bad json")("jd.skills_matrix").provider).toBe("gemini");
    errSpy.mockRestore();
  });
});
