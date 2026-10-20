// Deno wiring for the AI gateway: Supabase (service role) as the store, Gemini as the default provider.
//   import { ai } from "../_shared/ai-gateway/index.ts";
//   const r = await ai({ feature: "jd.skills_matrix", orgId, userId, system, messages, cacheInput: { jd },
//                        jsonSchema, schemaName: "skills_matrix", parse: SkillsMatrix.safeParse });
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { gateway, type GatewayRequest, type GatewayResult, type GatewayStore, type UsageRow } from "./core.ts";
import { makeConfig } from "./config.ts";
import { geminiProvider } from "./gemini.ts";
import { serviceClient } from "../b2b-http.ts";

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function supabaseStore(db: SupabaseClient): GatewayStore {
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await db.rpc(fn, args);
    if (error) throw new Error(`${fn}: ${error.message}`);
    return data;
  };
  return {
    claim: (key, feature, promptVersion, model, orgId) =>
      rpc("b2b_ai_cache_claim", { _key: key, _feature: feature, _prompt_version: promptVersion, _model: model, _org_id: orgId, _stale_after_s: 90 }),
    fill: async (key, token, response, ttl) => { await rpc("b2b_ai_cache_fill", { _key: key, _token: token, _response: response, _ttl_s: ttl }); },
    release: async (key, token) => { await rpc("b2b_ai_cache_release", { _key: key, _token: token }); },
    takeQuota: (orgId, quotaKey) => rpc("b2b_take_quota", { _org_id: orgId, _feature: quotaKey, _units: 1 }),
    logUsage: async (u: UsageRow) => {
      // Logging must never fail a user request.
      try {
        await rpc("b2b_log_ai_usage", {
          _org_id: u.orgId, _user_id: u.userId, _feature: u.feature, _model: u.model, _input: u.inputTokens,
          _cached_input: u.cachedInputTokens, _output: u.outputTokens, _latency: u.latencyMs, _cache_hit: u.cacheHit,
          _interview_id: u.interviewId ?? null, _purpose: u.purpose ?? null,
        });
      } catch (e) { console.error("[ai-gateway] usage log failed:", (e as Error).message); }
    },
  };
}

const config = makeConfig(Deno.env.get("B2B_AI_CONFIG"));
const providers = {
  gemini: geminiProvider(() => {
    const k = (Deno.env.get("GEMINI_API_KEY") || "").trim();
    if (!k) throw new Error("GEMINI_API_KEY not configured");
    return k;
  }),
};

export function ai<T>(req: GatewayRequest<T>, db: SupabaseClient = serviceClient()): Promise<GatewayResult<T>> {
  return gateway(req, { config, providers, store: supabaseStore(db), sha256Hex });
}
