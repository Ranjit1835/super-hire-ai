// b2b-retention — R5.5: deletes what the consent text says is deleted (migration 0023).
//   POST { action: "sweep", batches? }   x-cron-secret (daily cron) or a super admin (MFA-verified, via requireUser)
// 1. Evidence snapshots older than each org's retention_days: files removed through the Storage API (100 per call),
//    then the events' evidence links cleared. Repeats in batches so a backlog drains over a few runs.
// 2. Company interview transcripts once the role has been closed for the retention period.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { HttpError, handle, json, requireUser, serviceClient } from "../_shared/b2b-http.ts";
import { sweepRetention } from "./sweep.ts";

serve(handle("B2B-RETENTION", async (req, body) => {
  if (body.action !== "sweep") throw new HttpError(400, "BAD_REQUEST", "Unknown action");
  const admin = serviceClient();
  const cronSecret = Deno.env.get("B2B_CRON_SECRET");
  const viaCron = !!cronSecret && req.headers.get("x-cron-secret") === cronSecret;
  if (!viaCron) {
    const user = await requireUser(req);
    const { data: r } = await admin.from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle();
    if (!r) throw new HttpError(403, "FORBIDDEN", "Super-admin only.");
  }
  const batches = Math.min(Math.max(Number(body.batches) || 5, 1), 20);
  const out = await sweepRetention({
    rpc: async (fn, args) => {
      const { data, error } = await admin.rpc(fn, args);
      if (error) throw new Error(`${fn}: ${error.message}`);
      return data;
    },
    removeFiles: async (paths) => {
      const { error } = await admin.storage.from("b2b-evidence").remove(paths);
      if (error) throw new Error(`storage.remove: ${error.message}`);
    },
  }, batches);
  console.log(`[B2B-RETENTION] ${JSON.stringify(out)}`);
  return json(out);
}));
