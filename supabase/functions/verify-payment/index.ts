import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function hmacSHA256(key: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing authorization");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) throw new Error("Unauthorized");

    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = await req.json();
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      throw new Error("Missing payment verification fields");
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Fetch payment record
    const { data: payment } = await admin
      .from("payments")
      .select("*")
      .eq("razorpay_order_id", razorpay_order_id)
      .single();

    if (!payment) throw new Error("Payment not found");
    if (payment.user_id !== user.id) throw new Error("Payment does not belong to user");

    // Idempotent: already verified
    if (payment.status === "SUCCESS") {
      return new Response(JSON.stringify({ success: true, alreadyVerified: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify signature
    const expectedSig = await hmacSHA256(
      Deno.env.get("RAZORPAY_KEY_SECRET")!,
      `${razorpay_order_id}|${razorpay_payment_id}`
    );

    if (expectedSig !== razorpay_signature) {
      await admin.from("payments").update({
        status: "FAILED",
        razorpay_payment_id,
        razorpay_signature,
      }).eq("id", payment.id);
      throw new Error("Signature verification failed");
    }

    // Mark SUCCESS
    await admin.from("payments").update({
      status: "SUCCESS",
      razorpay_payment_id,
      razorpay_signature,
    }).eq("id", payment.id);

    // Unlock logic
    if (payment.payment_type === "ONE_TIME_FIX" && payment.resume_analysis_id) {
      await admin.from("resume_analyses").update({
        is_paid_fix_unlocked: true,
        paid_fix_unlocked_at: new Date().toISOString(),
      }).eq("id", payment.resume_analysis_id);
    }

    if (payment.payment_type === "EARLY_BIRD_ACCESS") {
      const expiryDate = new Date();
      expiryDate.setDate(expiryDate.getDate() + 365);
      await admin.from("profiles").update({
        early_bird_active: true,
        early_bird_expiry_date: expiryDate.toISOString(),
      }).eq("user_id", user.id);
    }

    // Increment total_payments and update first-time discount flags
    const { data: profile } = await admin
      .from("profiles")
      .select("total_payments, first_time_fix_used, first_time_early_bird_used")
      .eq("user_id", user.id)
      .single();

    const profileUpdate: Record<string, unknown> = {
      total_payments: (profile?.total_payments || 0) + 1,
    };
    if (payment.payment_type === "ONE_TIME_FIX" && !profile?.first_time_fix_used) {
      profileUpdate.first_time_fix_used = true;
    }
    if (payment.payment_type === "EARLY_BIRD_ACCESS" && !profile?.first_time_early_bird_used) {
      profileUpdate.first_time_early_bird_used = true;
    }
    await admin.from("profiles").update(profileUpdate).eq("user_id", user.id);

    console.log(`[PAYMENT VERIFIED] user=${user.id} type=${payment.payment_type} amount=${payment.amount} orderId=${razorpay_order_id}`);

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
