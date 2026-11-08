// b2b-retention — R5.5: deletes what the consent text says is deleted (migration 0023).
//   POST { action: "sweep", batches? }   x-cron-secret (daily cron) or a super admin (MFA-verified, via requireUser)
//   POST { action: "finalize_integrity" } same auth; every 10 min: scores ended proctoring sessions with no score (B35)
// 1. Evidence snapshots older than each org's retention_days: files removed through the Storage API (100 per call),
//    then the events' evidence links cleared. Repeats in batches so a backlog drains over a few runs.
// 2. Company interview transcripts once the role has been closed for the retention period.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { HttpError, handle, json, requireUser, serviceClient } from "../_shared/b2b-http.ts";
import { sweepRetention } from "./sweep.ts";
import { finalizeIntegrity } from "./finalize.ts";
import type { ScoreEvent } from "../_shared/contracts/proctor-rules.ts";

// Every event of a session, in chunks (PostgREST stops at 1000 rows without an error); same read as b2b-proctor.
const EVENT_CHUNK = 1000;
async function sessionEvents(admin: ReturnType<typeof serviceClient>, sessionId: string): Promise<ScoreEvent[]> {
  const out: ScoreEvent[] = [];
  for (let from = 0; ; from += EVENT_CHUNK) {
    const { data, error } = await admin.from("proctoring_events")
      .select("type, severity, confidence, started_at, ended_at").eq("session_id", sessionId)
      .order("started_at").order("id").range(from, from + EVENT_CHUNK - 1);
    if (error) throw error;
    const chunk = data ?? [];
    for (const e of chunk) out.push({ ...e, confidence: Number(e.confidence) } as ScoreEvent);
    if (chunk.length < EVENT_CHUNK) return out;
  }
}

serve(handle("B2B-RETENTION", async (req, body) => {
  if (body.action !== "sweep" && body.action !== "finalize_integrity") throw new HttpError(400, "BAD_REQUEST", "Unknown action");
  const admin = serviceClient();
  const cronSecret = Deno.env.get("B2B_CRON_SECRET");
  const viaCron = !!cronSecret && req.headers.get("x-cron-secret") === cronSecret;
  if (!viaCron) {
    const user = await requireUser(req);
    const { data: r } = await admin.from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle();
    if (!r) throw new HttpError(403, "FORBIDDEN", "Super-admin only.");
  }
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await admin.rpc(fn, args);
    if (error) throw new Error(`${fn}: ${error.message}`);
    return data;
  };
  if (body.action === "finalize_integrity") {
    const out = await finalizeIntegrity({ rpc, events: (id) => sessionEvents(admin, id) });
    console.log(`[B2B-RETENTION] finalize_integrity ${JSON.stringify(out)}`);
    return json(out);
  }
  const batches = Math.min(Math.max(Number(body.batches) || 5, 1), 20);
  const out = await sweepRetention({
    rpc,
    removeFiles: async (paths) => {
      const { error } = await admin.storage.from("b2b-evidence").remove(paths);
      if (error) throw new Error(`storage.remove: ${error.message}`);
    },
  }, batches);
  console.log(`[B2B-RETENTION] ${JSON.stringify(out)}`);
  return json(out);
}));
