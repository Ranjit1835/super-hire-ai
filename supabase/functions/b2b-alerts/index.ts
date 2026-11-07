// b2b-alerts — R1.9: daily email digest of organisations that need attention (low credits, plan expiring or
// expired, seats nearly full). POST { action: "digest" } with x-cron-secret (daily cron) or as an MFA-verified super
// admin. Recipient: the B2B_ALERT_EMAIL secret (no email without it; the admin page shows the same list).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { HttpError, appBaseUrl, handle, json, requireUser, serviceClient } from "../_shared/b2b-http.ts";
import { sendMail } from "../_shared/mailer.ts";
import { runDigest, type OrgAlert } from "./digest.ts";

serve(handle("B2B-ALERTS", async (req, body) => {
  if (body.action !== "digest") throw new HttpError(400, "BAD_REQUEST", "Unknown action");
  const admin = serviceClient();
  const cronSecret = Deno.env.get("B2B_CRON_SECRET");
  if (!(cronSecret && req.headers.get("x-cron-secret") === cronSecret)) {
    const user = await requireUser(req);
    const { data: r } = await admin.from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle();
    if (!r) throw new HttpError(403, "FORBIDDEN", "Super-admin only.");
  }
  const out = await runDigest({
    alerts: async () => {
      const { data, error } = await admin.rpc("b2b_org_alerts");
      if (error) throw new Error(`b2b_org_alerts: ${error.message}`);
      return (data ?? []) as OrgAlert[];
    },
    send: sendMail,
    to: (Deno.env.get("B2B_ALERT_EMAIL") ?? "").trim() || null,
    adminUrl: `${appBaseUrl()}/admin/orgs`,
  });
  console.log(`[B2B-ALERTS] ${JSON.stringify(out)}`);
  return json(out);
}));
