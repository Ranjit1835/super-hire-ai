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
    const signature = req.headers.get("X-Razorpay-Signature");
    const body = await req.text();

    if (!signature) throw new Error("Missing webhook signature");

    const expectedSig = await hmacSHA256(Deno.env.get("RAZORPAY_KEY_SECRET")!, body);
    if (expectedSig !== signature) throw new Error("Invalid webhook signature");

    const event = JSON.parse(body);
    const eventType = event.event;

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    if (eventType === "payment.captured") {
      const rpPaymentId = event.payload?.payment?.entity?.id;
      const rpOrderId = event.payload?.payment?.entity?.order_id;
      if (!rpOrderId) throw new Error("No order_id in webhook");

      const { data: payment } = await admin
        .from("payments")
        .select("*")
        .eq("razorpay_order_id", rpOrderId)
        .single();

      if (!payment || payment.status === "SUCCESS") {
        return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
      }

      await admin.from("payments").update({
        status: "SUCCESS",
        razorpay_payment_id: rpPaymentId,
      }).eq("id", payment.id);

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
        }).eq("user_id", payment.user_id);
      }

      const { data: profile } = await admin
        .from("profiles")
        .select("total_payments, first_time_fix_used, first_time_early_bird_used")
        .eq("user_id", payment.user_id)
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
      await admin.from("profiles").update(profileUpdate).eq("user_id", payment.user_id);

      console.log(`[WEBHOOK PAYMENT] user=${payment.user_id} type=${payment.payment_type} amount=${payment.amount}`);
    }

    if (eventType === "payment.failed") {
      const rpOrderId = event.payload?.payment?.entity?.order_id;
      if (rpOrderId) {
        await admin.from("payments").update({ status: "FAILED" }).eq("razorpay_order_id", rpOrderId);
      }
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
