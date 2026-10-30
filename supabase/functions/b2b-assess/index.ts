// b2b-assess — question bank and test runner (contract: _shared/contracts/assess.ts; logic: ./handlers.ts).
// Runner actions accept anonymous sessions (candidates); the SQL functions check the subject owns the attempt.
// Cron: { action: "gradePending", limit } with the x-cron-secret header grades queued coding submissions.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { HttpError, b2bEnabled, corsHeaders, json, serviceClient } from "../_shared/b2b-http.ts";
import { serveContract, type Ctx } from "../_shared/contract-handler.ts";
import { assessContract } from "../_shared/contracts/assess.ts";
import { ai } from "../_shared/ai-gateway/index.ts";
import { judge0FromEnv } from "../_shared/judge0.ts";
import { AssessError, makeHandlers } from "./handlers.ts";

const db = serviceClient();
const handlers = makeHandlers({
  rpc: async (fn, args) => {
    const { data, error } = await db.rpc(fn, args);
    if (error) throw new Error(`${fn}: ${error.message}`);
    return data;
  },
  judge0: judge0FromEnv((k) => Deno.env.get(k), fetch),
  ai: (req) => ai(req, db),
});

/** Turn handler refusals into the HTTP errors the contract handler understands. */
function wrap<I, O>(fn: (input: I, actor: string) => Promise<O>) {
  return async (input: I, ctx: Ctx): Promise<O> => {
    try {
      return await fn(input, ctx.user.id);
    } catch (e) {
      if (e instanceof AssessError) throw new HttpError(e.status, e.code, e.message);
      throw e;
    }
  };
}

const RUNNER = new Set(["start", "state", "autosave", "run", "submitQuestion", "finish", "heartbeat", "advance"]);
const contract = serveContract("B2B-ASSESS", assessContract, {
  generateQuestions: wrap(handlers.generateQuestions),
  verifyQuestion: wrap(handlers.verifyQuestion),
  start: wrap(handlers.start),
  state: wrap(handlers.state),
  autosave: wrap(handlers.autosave),
  run: wrap(handlers.run),
  submitQuestion: wrap(handlers.submitQuestion),
  finish: wrap(handlers.finish),
  heartbeat: wrap(handlers.heartbeat),
  advance: wrap(handlers.advance),
}, { allowAnonymous: (a) => RUNNER.has(a) });

serve(async (req) => {
  const secret = Deno.env.get("B2B_CRON_SECRET");
  if (req.method === "POST" && secret && req.headers.get("x-cron-secret") === secret && b2bEnabled()) {
    const body = await req.clone().json().catch(() => ({})) as { action?: string; limit?: number };
    if (body.action === "gradePending") {
      try {
        const limit = Math.min(Math.max(Number(body.limit) || 10, 1), 50);
        return json(await handlers.gradePending(limit));
      } catch (e) {
        console.error("[B2B-ASSESS] gradePending:", (e as Error).message);
        return json({ error: "Grading sweep failed", code: "INTERNAL" }, 500);
      }
    }
  }
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  return contract(req);
});
