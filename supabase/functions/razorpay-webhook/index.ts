import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { fulfilPayment } from "../_shared/fulfil-payment.ts";

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

    // Razorpay signs webhooks with the secret set on the webhook, not the API key secret.
    const webhookSecret = Deno.env.get("RAZORPAY_WEBHOOK_SECRET");
    if (!webhookSecret) throw new Error("Webhook secret not configured");

    const expectedSig = await hmacSHA256(webhookSecret, body);
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

      if (!payment || (payment.status === "SUCCESS" && payment.fulfilled_at)) {
        return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
      }

      await admin.from("payments").update({
        status: "SUCCESS",
        razorpay_payment_id: rpPaymentId,
      }).eq("id", payment.id);

      await fulfilPayment(admin, payment);

      console.log(`[WEBHOOK PAYMENT] user=${payment.user_id} type=${payment.payment_type} amount=${payment.amount}`);
    }

    if (eventType === "payment.failed") {
      const rpOrderId = event.payload?.payment?.entity?.order_id;
      if (rpOrderId) {
        // A customer can fail once and pay on retry, and webhooks can arrive out of order.
        await admin.from("payments").update({ status: "FAILED" })
          .eq("razorpay_order_id", rpOrderId)
          .eq("status", "INITIATED");
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
