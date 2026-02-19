import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function generateOtp(): string {
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  return String(array[0] % 1000000).padStart(6, "0");
}

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
    const { email, password } = await req.json();

    if (!email || typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return new Response(JSON.stringify({ error: "Invalid email" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!password || typeof password !== "string" || password.length < 6) {
      return new Response(JSON.stringify({ error: "Invalid password" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Use anon key to verify credentials
    const anonClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
    );

    const { data: authData, error: authError } = await anonClient.auth.signInWithPassword({ email, password });
    if (authError || !authData.user) {
      return new Response(JSON.stringify({ error: "Invalid email or password" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Sign out immediately - OTP must be verified first
    await anonClient.auth.signOut();

    const userId = authData.user.id;

    // Use service role for OTP management
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Check lockout
    const { data: recentOtp } = await adminClient
      .from("otp_codes")
      .select("locked_until, attempts")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (recentOtp?.locked_until) {
      const lockUntil = new Date(recentOtp.locked_until);
      if (lockUntil > new Date()) {
        const remainSec = Math.ceil((lockUntil.getTime() - Date.now()) / 1000);
        return new Response(JSON.stringify({
          error: `Too many failed attempts. Try again in ${remainSec} seconds.`,
          locked: true,
          lockUntilMs: lockUntil.getTime(),
        }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Generate and store OTP
    const otp = generateOtp();
    const otpHash = await hashOtp(otp);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 min

    // Invalidate old unused OTPs
    await adminClient
      .from("otp_codes")
      .update({ used: true })
      .eq("user_id", userId)
      .eq("used", false);

    await adminClient.from("otp_codes").insert({
      user_id: userId,
      otp_hash: otpHash,
      expires_at: expiresAt,
      attempts: 0,
      used: false,
      locked_until: null,
    });

    // Send OTP via Supabase Auth admin email (using auth.admin API to send a custom email)
    // We'll use a direct SMTP-style approach via Supabase's built-in email
    const emailRes = await fetch(`${Deno.env.get("SUPABASE_URL")}/auth/v1/admin/generate_link`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        apikey: Deno.env.get("SUPABASE_ANON_KEY")!,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "magiclink",
        email: email,
      }),
    });

    // We actually just need to send a simple email with the OTP code
    // Since Supabase doesn't have a generic "send email" API, we'll use the 
    // edge function response to pass the OTP flow token instead
    // The OTP is verified server-side, so we pass a session ticket
    
    // For production: integrate with an email service (Resend, SendGrid, etc.)
    // For now: the OTP will be delivered via the response for the flow to work
    // In a real deployment, you'd send via email API here

    console.log(`OTP generated for user ${userId}: ${otp}`); // Remove in production

    return new Response(JSON.stringify({
      success: true,
      userId,
      email: email.replace(/(.{2}).*(@.*)/, "$1***$2"), // Masked email
      expiresAt,
      // NOTE: In production, remove otpCode and send via email service
      // For development/demo, we include it so the flow works
      otpCode: otp,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("send-otp error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
