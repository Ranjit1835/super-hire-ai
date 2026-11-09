// ─── AI gateway core (pure; no Deno, no network) ─────────────────────────────
// Every B2B LLM call goes through gateway(): provider-agnostic routing per feature, exact-match cache
// with single-flight dedupe, quotas, output validation with one corrective retry, and a cost log.
// Storage and providers are injected (see ./index.ts for the Supabase + Gemini wiring), so this file
// is unit-tested in Node (supabase/tests/unit/ai-gateway.test.ts).

export type CacheScope = "org" | "global" | "none";

export interface FeatureConfig {
  provider: string;              // key into the providers map, e.g. "gemini"
  model: string;
  promptVersion: string;         // bump to invalidate cached answers for this feature
  cache: CacheScope;             // "org" for anything with personal data; "none" for live turns / evaluations
  ttlSeconds: number | null;     // null = no expiry
  maxTokens: number;
  temperature?: number;
  reasoningEffort?: "none" | "low" | "medium" | "high";
  timeoutMs: number;
  /** Counted against organizations.settings.quotas[quotaKey] per IST month; omit = not quota-limited. */
  quotaKey?: string;
}

export interface Message { role: "user" | "assistant"; content: string }

export interface ProviderRequest {
  model: string;
  system: string;
  messages: Message[];
  /** JSON Schema the provider must fill (tool / structured output). */
  schema: Record<string, unknown>;
  schemaName: string;
  maxTokens: number;
  temperature?: number;
  reasoningEffort?: FeatureConfig["reasoningEffort"];
  timeoutMs: number;
}

export interface ProviderResult {
  output: unknown;               // parsed JSON from the model
  inputTokens: number;
  cachedInputTokens: number;     // provider context-cache hits (billed at a discount)
  outputTokens: number;
}

export interface Provider { complete(req: ProviderRequest): Promise<ProviderResult> }

export type Claim =
  | { state: "hit"; response: unknown }
  | { state: "claimed"; token: string }
  | { state: "wait" };

export interface GatewayStore {
  claim(key: string, feature: string, promptVersion: string, model: string, orgId: string | null): Promise<Claim>;
  fill(key: string, token: string, response: unknown, ttlSeconds: number | null): Promise<void>;
  release(key: string, token: string): Promise<void>;
  takeQuota(orgId: string, quotaKey: string): Promise<{ ok: boolean; used?: number; limit?: number | null }>;
  logUsage(row: UsageRow): Promise<void>;
}

export interface UsageRow {
  orgId: string | null;
  userId: string | null;
  feature: string;
  model: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  latencyMs: number;
  cacheHit: boolean;
  interviewId?: string | null;
  purpose?: string | null;
}

/** zod's safeParse shape, so callers can pass `schema.safeParse` directly. */
export type Parse<T> = (raw: unknown) =>
  | { success: true; data: T }
  | { success: false; error: { issues: { path: (string | number)[]; message: string }[] } };

export interface GatewayRequest<T> {
  feature: string;
  orgId: string | null;
  userId?: string | null;
  system: string;
  messages: Message[];
  /** What makes two requests "the same" for caching (normally the user-supplied input, not the prompt). */
  cacheInput: unknown;
  jsonSchema: Record<string, unknown>;
  schemaName: string;
  parse: Parse<T>;
  interviewId?: string | null;
  purpose?: string | null;
}

export interface GatewayDeps {
  config: (feature: string) => FeatureConfig;
  providers: Record<string, Provider>;
  store: GatewayStore;
  sha256Hex: (s: string) => Promise<string>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** How long a waiter polls for another worker's result before computing itself. */
  waitBudgetMs?: number;
}

export type GatewayResult<T> =
  | { ok: true; data: T; cacheHit: boolean }
  | { ok: false; code: "QUOTA_EXCEEDED" | "INVALID_OUTPUT" | "PROVIDER_ERROR"; message: string };

export class GatewayError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

// ── Keys ──────────────────────────────────────────────────────────────────────
/** Stable JSON: sorted keys, trimmed strings with collapsed whitespace, no undefined. */
export function normalize(v: unknown): unknown {
  if (typeof v === "string") return v.replace(/\s+/g, " ").trim();
  if (Array.isArray(v)) return v.map(normalize);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      const val = (v as Record<string, unknown>)[k];
      if (val !== undefined) out[k] = normalize(val);
    }
    return out;
  }
  return v;
}

export function cacheKeyMaterial(feature: string, cfg: FeatureConfig, orgId: string | null, input: unknown): string {
  const scope = cfg.cache === "org" ? `org:${orgId ?? "none"}` : "global";
  return JSON.stringify([feature, cfg.promptVersion, cfg.provider, cfg.model, scope, normalize(input)]);
}

function issuesText(issues: { path: (string | number)[]; message: string }[]): string {
  return issues.slice(0, 12).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
}

// ── The gateway ──────────────────────────────────────────────────────────────
export async function gateway<T>(req: GatewayRequest<T>, deps: GatewayDeps): Promise<GatewayResult<T>> {
  const cfg = deps.config(req.feature);
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const provider = deps.providers[cfg.provider];
  if (!provider) throw new GatewayError("CONFIG", `No provider "${cfg.provider}" for feature ${req.feature}`);
  if (cfg.cache === "org" && !req.orgId) throw new GatewayError("CONFIG", `Feature ${req.feature} caches per org but no orgId was given`);

  const logBase = { orgId: req.orgId, userId: req.userId ?? null, feature: req.feature, model: cfg.model,
                    interviewId: req.interviewId ?? null, purpose: req.purpose ?? null };

  // 1. Cache lookup / single flight.
  let key: string | null = null;
  let token: string | null = null;
  if (cfg.cache !== "none") {
    key = await deps.sha256Hex(cacheKeyMaterial(req.feature, cfg, req.orgId, req.cacheInput));
    const scopeOrg = cfg.cache === "org" ? req.orgId : null;
    const deadline = now() + (deps.waitBudgetMs ?? 45_000);
    let delay = 250;
    for (;;) {
      const c = await deps.store.claim(key, req.feature, cfg.promptVersion, cfg.model, scopeOrg);
      if (c.state === "hit") {
        const parsed = req.parse(c.response);
        if (parsed.success) {
          await deps.store.logUsage({ ...logBase, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, latencyMs: 0, cacheHit: true });
          return { ok: true, data: parsed.data, cacheHit: true };
        }
        // A cached answer that no longer validates (schema changed without a version bump): recompute.
        break;
      }
      if (c.state === "claimed") { token = c.token; break; }
      if (now() >= deadline) break;          // the other worker is too slow: compute ourselves, uncached
      await sleep(delay);
      delay = Math.min(delay * 2, 2_000);
    }
  }

  // 2. Quota (only for real model calls; cache hits are free).
  if (cfg.quotaKey && req.orgId) {
    const q = await deps.store.takeQuota(req.orgId, cfg.quotaKey);
    if (!q.ok) {
      if (key && token) await deps.store.release(key, token);
      return { ok: false, code: "QUOTA_EXCEEDED", message: `Monthly limit reached for ${cfg.quotaKey} (${q.limit}).` };
    }
  }

  // 3. Model call + validation, with one corrective retry.
  const messages = [...req.messages];
  let lastProblem = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    const started = now();
    let result: ProviderResult;
    try {
      result = await provider.complete({
        model: cfg.model, system: req.system, messages, schema: req.jsonSchema, schemaName: req.schemaName,
        maxTokens: cfg.maxTokens, temperature: cfg.temperature, reasoningEffort: cfg.reasoningEffort, timeoutMs: cfg.timeoutMs,
      });
    } catch (e) {
      if (key && token) await deps.store.release(key, token);
      return { ok: false, code: "PROVIDER_ERROR", message: (e as Error).message };
    }
    await deps.store.logUsage({
      ...logBase, inputTokens: result.inputTokens, cachedInputTokens: result.cachedInputTokens,
      outputTokens: result.outputTokens, latencyMs: now() - started, cacheHit: false,
    });
    const parsed = req.parse(result.output);
    if (parsed.success) {
      if (key && token) await deps.store.fill(key, token, result.output, cfg.ttlSeconds);
      return { ok: true, data: parsed.data, cacheHit: false };
    }
    lastProblem = issuesText(parsed.error.issues);
    messages.push(
      { role: "assistant", content: JSON.stringify(result.output).slice(0, 8000) },
      { role: "user", content: `That output did not match the required schema: ${lastProblem}. Return corrected output only.` },
    );
  }
  if (key && token) await deps.store.release(key, token);
  return { ok: false, code: "INVALID_OUTPUT", message: lastProblem };
}
