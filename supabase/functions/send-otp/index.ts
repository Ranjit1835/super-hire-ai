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

async function sendOtpEmail(toEmail: string, otp: string): Promise<boolean> {
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  if (!resendApiKey) {
    console.error("RESEND_API_KEY is not configured");
    return false;
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "HireResume <onboarding@resend.dev>",
        to: [toEmail],
        subject: "Your HireResume Login OTP",
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
            <h2 style="color: #1a1a2e; margin-bottom: 16px;">Your Verification Code</h2>
            <div style="background: #f4f4f8; border-radius: 12px; padding: 24px; text-align: center; margin: 24px 0;">
              <span style="font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #1a1a2e;">${otp}</span>
            </div>
            <p style="color: #555; font-size: 14px; line-height: 1.6;">
              This code is valid for <strong>5 minutes</strong>. Do not share it with anyone.
            </p>
            <p style="color: #999; font-size: 12px; margin-top: 24px;">
              If you did not request this login, please ignore this email.
            </p>
          </div>
        `,
      }),
    });

    if (!res.ok) {
      const errorBody = await res.text();
      console.error(`Resend API error [${res.status}]: ${errorBody}`);
      return false;
    }

    return true;
  } catch (err) {
    console.error("Failed to send OTP email:", err);
    return false;
  }
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

    // Send OTP via email
    const emailSent = await sendOtpEmail(email, otp);

    if (!emailSent) {
      // Mark OTP as used since we couldn't deliver it
      await adminClient
        .from("otp_codes")
        .update({ used: true })
        .eq("user_id", userId)
        .eq("otp_hash", otpHash);

      return new Response(JSON.stringify({
        error: "Unable to send OTP. Please try again.",
      }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // SECURITY: Never return OTP in response
    return new Response(JSON.stringify({
      success: true,
      email: email.replace(/(.{2}).*(@.*)/, "$1***$2"), // Masked email
      expiresAt,
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
