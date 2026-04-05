import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const RATE_LIMIT_MAX = 10;

async function hashToken(token: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { email, password } = await req.json();

    if (!email || typeof email !== "string") {
      return new Response(JSON.stringify({ error: "Email is required.", code: "missing_email" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!password || typeof password !== "string") {
      return new Response(JSON.stringify({ error: "Password is required.", code: "missing_password" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // --- Rate limiting ---
    const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();
    const { count } = await admin
      .from("login_attempts")
      .select("*", { count: "exact", head: true })
      .eq("email", email.toLowerCase())
      .eq("success", false)
      .gte("attempted_at", windowStart);

    if ((count ?? 0) >= RATE_LIMIT_MAX) {
      const retryAfter = RATE_LIMIT_WINDOW_MS / 1000;
      return new Response(JSON.stringify({ blocked: true, retryAfter }), {
        status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --- Attempt sign in ---
    const anonClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!
    );

    const { data: signInData, error: signInError } = await anonClient.auth.signInWithPassword({ email, password });

    // Record attempt (success or failure)
    await admin.from("login_attempts").insert({
      email: email.toLowerCase(),
      success: !signInError,
    });

    if (signInError || !signInData?.session) {
      const code = signInError?.message?.includes("Invalid login credentials")
        ? "invalid_credentials"
        : signInError?.message?.includes("Email not confirmed")
        ? "email_not_confirmed"
        : "unknown";

      const message = code === "invalid_credentials"
        ? "Incorrect email or password."
        : code === "email_not_confirmed"
        ? "Please verify your email before signing in."
        : "Sign in failed. Please try again.";

      return new Response(JSON.stringify({ error: message, code }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const session = signInData.session;
    const userId = signInData.user.id;

    // --- Session enforcement: max 2 active sessions ---
    const { data: activeSessions } = await admin
      .from("user_sessions")
      .select("*")
      .eq("user_id", userId)
      .eq("is_active", true)
      .order("created_at", { ascending: true });

    if (activeSessions && activeSessions.length >= 2) {
      // Invalidate oldest sessions, keep only 1 slot free for the new one
      const toInvalidate = activeSessions.slice(0, activeSessions.length - 1);
      for (const s of toInvalidate) {
        await admin.from("user_sessions").update({ is_active: false }).eq("id", s.id);
      }
    }

    // Record new session
    const deviceInfo = req.headers.get("user-agent")?.slice(0, 200) ?? "Unknown";
    const tokenHash = await hashToken(session.access_token);
    await admin.from("user_sessions").insert({
      user_id: userId,
      session_token: tokenHash,
      device_info: deviceInfo,
      is_active: true,
    });

    console.log(`[AUTH-SIGNIN] user=${userId} login success`);

    return new Response(JSON.stringify({ session }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("auth-signin error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
