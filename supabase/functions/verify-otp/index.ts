import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function hashOtp(otp: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(otp + Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!.slice(0, 16));
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { email, password, otp } = await req.json();

    if (!email || typeof email !== "string") {
      return new Response(JSON.stringify({ error: "Invalid email" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!password || typeof password !== "string") {
      return new Response(JSON.stringify({ error: "Invalid password" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!otp || typeof otp !== "string" || !/^\d{6}$/.test(otp)) {
      return new Response(JSON.stringify({ error: "Invalid OTP format" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Look up user by email
    const { data: userList } = await adminClient.auth.admin.listUsers();
    const user = userList?.users?.find((u) => u.email === email);
    if (!user) {
      return new Response(JSON.stringify({ error: "Invalid credentials" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = user.id;

    // Get latest unused OTP for this user
    const { data: otpRecord } = await adminClient
      .from("otp_codes")
      .select("*")
      .eq("user_id", userId)
      .eq("used", false)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!otpRecord) {
      return new Response(JSON.stringify({ error: "No pending OTP. Please request a new one." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check lockout
    if (otpRecord.locked_until && new Date(otpRecord.locked_until) > new Date()) {
      const remainSec = Math.ceil((new Date(otpRecord.locked_until).getTime() - Date.now()) / 1000);
      return new Response(JSON.stringify({
        error: `Account temporarily locked. Try again in ${remainSec} seconds.`,
        locked: true,
      }), {
        status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check expiration
    if (new Date(otpRecord.expires_at) < new Date()) {
      await adminClient.from("otp_codes").update({ used: true }).eq("id", otpRecord.id);
      return new Response(JSON.stringify({ error: "OTP expired. Please request a new one." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify OTP hash
    const otpHash = await hashOtp(otp);
    if (otpHash !== otpRecord.otp_hash) {
      const newAttempts = (otpRecord.attempts || 0) + 1;
      const updateData: Record<string, unknown> = { attempts: newAttempts };

      if (newAttempts >= 3) {
        // Lock for 5 minutes
        updateData.locked_until = new Date(Date.now() + 5 * 60 * 1000).toISOString();
        updateData.used = true;
      }

      await adminClient.from("otp_codes").update(updateData).eq("id", otpRecord.id);

      const remaining = 3 - newAttempts;
      if (remaining <= 0) {
        return new Response(JSON.stringify({
          error: "Too many failed attempts. Account locked for 5 minutes.",
          locked: true,
        }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({
        error: `Incorrect OTP. ${remaining} attempt(s) remaining.`,
        attemptsRemaining: remaining,
      }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // OTP verified! Mark as used
    await adminClient.from("otp_codes").update({ used: true }).eq("id", otpRecord.id);

    // Now actually sign in the user
    const anonClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
    );

    const { data: signInData, error: signInError } = await anonClient.auth.signInWithPassword({
      email, password,
    });

    if (signInError || !signInData.session) {
      return new Response(JSON.stringify({ error: "Authentication failed after OTP verification" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Session management: enforce max 2 sessions
    const { data: activeSessions } = await adminClient
      .from("user_sessions")
      .select("*")
      .eq("user_id", userId)
      .eq("is_active", true)
      .order("created_at", { ascending: true });

    if (activeSessions && activeSessions.length >= 2) {
      // Invalidate oldest session(s)
      const toInvalidate = activeSessions.slice(0, activeSessions.length - 1); // Keep only newest, we'll add current
      for (const s of toInvalidate) {
        await adminClient.from("user_sessions").update({ is_active: false }).eq("id", s.id);
      }
    }

    // Record new session
    const deviceInfo = req.headers.get("user-agent")?.slice(0, 200) || "Unknown";
    await adminClient.from("user_sessions").insert({
      user_id: userId,
      session_token: signInData.session.access_token.slice(-16), // Store only last 16 chars for identification
      device_info: deviceInfo,
      is_active: true,
    });

    return new Response(JSON.stringify({
      success: true,
      session: signInData.session,
      user: signInData.user,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("verify-otp error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
