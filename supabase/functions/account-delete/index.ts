// account-delete — DPDP right to erasure for B2C accounts (owner decisions 2026-11-09).
// POST with the user's JWT and { confirm: "DELETE" }. In order: privacy_delete_account (keeps payment records in the
// restricted store, clears tables keyed by the user without a foreign key, refuses college/company members and super
// admins), then the user's resume files, then the auth user, whose ON DELETE CASCADE removes everything else.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const REFUSED: Record<string, string> = {
  B2B_MEMBER: "Your college or company manages this account. Ask them, or email privacy@hiresume.in, to delete your data.",
  SUPER_ADMIN: "HiResume staff accounts can't be deleted from the app.",
};

/** Every object under <userId>/ in the resumes bucket (uploads are stored per user folder). */
async function removeResumeFiles(admin: ReturnType<typeof createClient>, userId: string) {
  const bucket = admin.storage.from("resumes");
  const folders = [userId];
  while (folders.length) {
    const dir = folders.pop()!;
    for (;;) {
      const { data, error } = await bucket.list(dir, { limit: 1000 });
      if (error) throw error;
      const files = (data ?? []).filter((o) => o.id !== null);
      for (const sub of (data ?? []).filter((o) => o.id === null)) folders.push(`${dir}/${sub.name}`);
      if (!files.length) break;
      const { error: r } = await bucket.remove(files.map((f) => `${dir}/${f.name}`));
      if (r) throw r;
      if (files.length < 1000) break;
    }
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Sign in first." }, 401);
    const asUser = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await asUser.auth.getUser();
    if (authErr || !user || user.is_anonymous) return json({ error: "Sign in first." }, 401);

    const body = await req.json().catch(() => ({}));
    if ((body as { confirm?: string }).confirm !== "DELETE") return json({ error: "Type DELETE to confirm." }, 400);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data, error } = await admin.rpc("privacy_delete_account", { _actor: user.id });
    if (error) throw error;
    const r = data as { ok: boolean; reason?: string };
    if (!r.ok) return json({ error: REFUSED[r.reason ?? ""] ?? "This account can't be deleted here.", code: r.reason }, 409);

    await removeResumeFiles(admin, user.id);
    const { error: delErr } = await admin.auth.admin.deleteUser(user.id);
    if (delErr) throw delErr;
    console.log(JSON.stringify({ event: "account_deleted", user_id: user.id, at: new Date().toISOString() }));
    return json({ ok: true });
  } catch (e) {
    console.error("account-delete error:", e);
    return json({ error: "Couldn't delete the account. Please try again, or email privacy@hiresume.in." }, 500);
  }
});
