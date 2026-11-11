// account-password — first sign-in password change for staff accounts made at invite time (_shared/staff-account.ts).
// POST with the user's JWT and { password }. Sets the new password and clears app_metadata.must_change_password in one
// admin update, so the flag can't be cleared without actually changing the password (users can't edit app_metadata).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { passwordProblems } from "../_shared/staff-account.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

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
    const password = typeof (body as { password?: unknown }).password === "string" ? (body as { password: string }).password : "";
    const problems = passwordProblems(password);
    if (problems.length) return json({ error: `Password needs: ${problems.join(", ")}.`, code: "WEAK_PASSWORD" }, 400);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { error } = await admin.auth.admin.updateUserById(user.id, {
      password,
      app_metadata: { ...(user.app_metadata ?? {}), must_change_password: false },
    });
    if (error) {
      const same = /different from the old|same.*password/i.test(error.message);
      return json({ error: same ? "Choose a password different from the temporary one." : "Couldn't save the password. Please try again." },
        same ? 400 : 500);
    }
    console.log(JSON.stringify({ event: "password_set_first_sign_in", user_id: user.id }));
    return json({ ok: true });
  } catch (e) {
    console.error("account-password error:", e);
    return json({ error: "Couldn't save the password. Please try again." }, 500);
  }
});
