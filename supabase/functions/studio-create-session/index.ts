import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing authorization");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const {
      data: { user },
      error: authErr,
    } = await supabase.auth.getUser();
    if (authErr || !user) throw new Error("Unauthorized");

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { action, resumeId, passType, razorpayOrderId, razorpayPaymentId, razorpaySignature } = await req.json();

    // Action: create-free — create a free session (3 messages max)
    if (action === "create-free") {
      if (!resumeId) throw new Error("resumeId is required");

      // Check if active free session already exists
      const { data: existing } = await admin
        .from("studio_sessions")
        .select("id, messages_used, expires_at")
        .eq("user_id", user.id)
        .eq("resume_id", resumeId)
        .eq("pass_type", "free")
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existing) {
        return new Response(
          JSON.stringify({ session: existing }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Create free session — expires in 24 hours but limited to 3 messages
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      const { data: session, error: insertErr } = await admin
        .from("studio_sessions")
        .insert({
          user_id: user.id,
          resume_id: resumeId,
          pass_type: "free",
          expires_at: expiresAt,
          messages_used: 0,
        })
        .select("id, pass_type, expires_at, messages_used")
        .single();

      if (insertErr) throw insertErr;

      console.log(`[STUDIO SESSION] Free session created: user=${user.id} resume=${resumeId} session=${session.id}`);
      return new Response(
        JSON.stringify({ session }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Action: create-paid — verify payment + create paid session
    if (action === "create-paid") {
      if (!resumeId || !passType || !razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
        throw new Error("Missing required payment fields");
      }

      if (!["single", "weekly", "yearly"].includes(passType)) {
        throw new Error("Invalid passType");
      }

      // Verify Razorpay signature
      const RAZORPAY_KEY_SECRET = Deno.env.get("RAZORPAY_KEY_SECRET")!;
      const expectedSig = await hmacSHA256(
        RAZORPAY_KEY_SECRET,
        `${razorpayOrderId}|${razorpayPaymentId}`
      );

      if (expectedSig !== razorpaySignature) {
        throw new Error("Payment signature verification failed");
      }

      // Update payment record to SUCCESS
      const { data: payment } = await admin
        .from("payments")
        .update({
          razorpay_payment_id: razorpayPaymentId,
          razorpay_signature: razorpaySignature,
          status: "SUCCESS",
          updated_at: new Date().toISOString(),
        })
        .eq("razorpay_order_id", razorpayOrderId)
        .eq("user_id", user.id)
        .select("id")
        .single();

      if (!payment) {
        console.error(`[STUDIO SESSION] Payment record not found for order ${razorpayOrderId}`);
      }

      // Calculate expiry
      const now = Date.now();
      let expiresAt: string;
      if (passType === "single") {
        expiresAt = new Date(now + 24 * 60 * 60 * 1000).toISOString();
      } else if (passType === "weekly") {
        expiresAt = new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString();
      } else {
        expiresAt = new Date(now + 365 * 24 * 60 * 60 * 1000).toISOString();
      }

      const { data: session, error: sessionErr } = await admin
        .from("studio_sessions")
        .insert({
          user_id: user.id,
          resume_id: resumeId,
          pass_type: passType,
          expires_at: expiresAt,
          messages_used: 0,
          razorpay_payment_id: razorpayPaymentId,
        })
        .select("id, pass_type, expires_at, messages_used")
        .single();

      if (sessionErr) throw sessionErr;

      console.log(`[STUDIO SESSION] Paid session created: user=${user.id} pass=${passType} expires=${expiresAt}`);
      return new Response(
        JSON.stringify({ session }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Action: check — check if user has an active session for a resume
    if (action === "check") {
      if (!resumeId) throw new Error("resumeId is required");

      const { data: activeSession } = await admin
        .from("studio_sessions")
        .select("id, pass_type, expires_at, messages_used")
        .eq("user_id", user.id)
        .eq("resume_id", resumeId)
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      // Also check for yearly pass on any resume (it's account-wide)
      let yearlySession = null;
      if (!activeSession || activeSession.pass_type === "free") {
        const { data: yearly } = await admin
          .from("studio_sessions")
          .select("id, pass_type, expires_at, messages_used, resume_id")
          .eq("user_id", user.id)
          .eq("pass_type", "yearly")
          .gt("expires_at", new Date().toISOString())
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        yearlySession = yearly;
      }

      const bestSession = (activeSession?.pass_type !== "free" ? activeSession : null) || yearlySession || activeSession;

      return new Response(
        JSON.stringify({ session: bestSession }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    throw new Error("Invalid action. Use: create-free, create-paid, check");
  } catch (err: any) {
    console.error("[STUDIO SESSION] Error:", err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function hmacSHA256(key: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
