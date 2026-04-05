import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

    const { paymentType, resumeAnalysisId, resumeBuilderId } = await req.json();

    if (!["ONE_TIME_FIX", "EARLY_BIRD_ACCESS", "RESUME_BUILDER", "MOCK_INTERVIEW",
          "RESUME_FIX", "RESUME_BUILD", "AI_INTERVIEW", "COMBO_PLAN", "UNLIMITED_PLAN"].includes(paymentType)) {
      throw new Error("Invalid paymentType");
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Idempotency checks
    if (paymentType === "ONE_TIME_FIX") {
      if (!resumeAnalysisId) throw new Error("resumeAnalysisId required for ONE_TIME_FIX");
      const { data: resume } = await admin
        .from("resume_analyses")
        .select("id, user_id, is_paid_fix_unlocked")
        .eq("id", resumeAnalysisId)
        .single();
      if (!resume || resume.user_id !== user.id) throw new Error("Resume not found");
      if (resume.is_paid_fix_unlocked) {
        return new Response(JSON.stringify({ alreadyUnlocked: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    if (paymentType === "EARLY_BIRD_ACCESS") {
      const { data: profile } = await admin
        .from("profiles")
        .select("early_bird_active, early_bird_expiry_date")
        .eq("user_id", user.id)
        .single();
      if (profile?.early_bird_active && profile.early_bird_expiry_date && new Date(profile.early_bird_expiry_date) > new Date()) {
        return new Response(JSON.stringify({ alreadyUnlocked: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    if (paymentType === "RESUME_BUILDER") {
      if (!resumeBuilderId) throw new Error("resumeBuilderId required for RESUME_BUILDER");
      // Check early bird access first — resume builder is free for early bird users
      const { data: ebProfile } = await admin
        .from("profiles")
        .select("early_bird_active, early_bird_expiry_date")
        .eq("user_id", user.id)
        .single();
      if (ebProfile?.early_bird_active && ebProfile.early_bird_expiry_date && new Date(ebProfile.early_bird_expiry_date) > new Date()) {
        // Auto-unlock for early bird
        await admin.from("resume_builders").update({ is_paid: true, paid_at: new Date().toISOString() }).eq("id", resumeBuilderId);
        return new Response(JSON.stringify({ alreadyUnlocked: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: rb } = await admin
        .from("resume_builders")
        .select("id, user_id, is_paid")
        .eq("id", resumeBuilderId)
        .single();
      if (!rb || rb.user_id !== user.id) throw new Error("Resume build not found");
      if (rb.is_paid) {
        return new Response(JSON.stringify({ alreadyUnlocked: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Idempotency checks for new plan types
    if (paymentType === "RESUME_FIX") {
      if (!resumeAnalysisId) throw new Error("resumeAnalysisId required for RESUME_FIX");
      const { data: resume } = await admin.from("resume_analyses").select("id, user_id, is_paid_fix_unlocked").eq("id", resumeAnalysisId).single();
      if (!resume || resume.user_id !== user.id) throw new Error("Resume not found");
      if (resume.is_paid_fix_unlocked) return new Response(JSON.stringify({ alreadyUnlocked: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (paymentType === "RESUME_BUILD") {
      if (!resumeBuilderId) throw new Error("resumeBuilderId required for RESUME_BUILD");
      const { data: planProfile } = await admin.from("profiles").select("plan_type, plan_expiry_date, early_bird_active, early_bird_expiry_date").eq("user_id", user.id).single();
      const hasActivePlan = (planProfile?.plan_type === "UNLIMITED" || planProfile?.early_bird_active) && planProfile?.plan_expiry_date && new Date(planProfile.plan_expiry_date) > new Date();
      if (hasActivePlan) {
        await admin.from("resume_builders").update({ is_paid: true, paid_at: new Date().toISOString() }).eq("id", resumeBuilderId);
        return new Response(JSON.stringify({ alreadyUnlocked: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const { data: rb } = await admin.from("resume_builders").select("id, user_id, is_paid").eq("id", resumeBuilderId).single();
      if (!rb || rb.user_id !== user.id) throw new Error("Resume build not found");
      if (rb.is_paid) return new Response(JSON.stringify({ alreadyUnlocked: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (paymentType === "UNLIMITED_PLAN") {
      const { data: planProfile } = await admin.from("profiles").select("plan_type, plan_expiry_date, early_bird_active, early_bird_expiry_date").eq("user_id", user.id).single();
      const isActive = (planProfile?.plan_type === "UNLIMITED" || planProfile?.early_bird_active) && planProfile?.plan_expiry_date && new Date(planProfile.plan_expiry_date) > new Date();
      if (isActive) return new Response(JSON.stringify({ alreadyUnlocked: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (paymentType === "COMBO_PLAN") {
      const { data: planProfile } = await admin.from("profiles").select("plan_type, plan_expiry_date").eq("user_id", user.id).single();
      if (planProfile?.plan_type === "COMBO" || planProfile?.plan_type === "UNLIMITED") {
        return new Response(JSON.stringify({ alreadyUnlocked: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // --- Student discount logic ---
    const baseAmountMap: Record<string, number> = {
      ONE_TIME_FIX: 29900, RESUME_FIX: 29900,
      EARLY_BIRD_ACCESS: 149900, UNLIMITED_PLAN: 199900,
      MOCK_INTERVIEW: 59900, AI_INTERVIEW: 59900,
      RESUME_BUILDER: 39900, RESUME_BUILD: 39900,
      COMBO_PLAN: 89900,
    };
    let baseAmount = baseAmountMap[paymentType] ?? 29900;
    let amount = baseAmount;
    let discountApplied = false;
    let isStudent = false;

    // Check resume type for student detection
    if (resumeAnalysisId) {
      const { data: resumeData } = await admin
        .from("resume_analyses")
        .select("resume_type")
        .eq("id", resumeAnalysisId)
        .single();
      if (resumeData?.resume_type === "STUDENT") {
        isStudent = true;
      }
    }

    // If no resumeAnalysisId (EARLY_BIRD), check user's latest analysis
    if (!resumeAnalysisId && paymentType === "EARLY_BIRD_ACCESS") {
      const { data: latestResume } = await admin
        .from("resume_analyses")
        .select("resume_type")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latestResume?.resume_type === "STUDENT") {
        isStudent = true;
      }
    }

    if (isStudent) {
      const { data: profile } = await admin
        .from("profiles")
        .select("first_time_fix_used, first_time_early_bird_used")
        .eq("user_id", user.id)
        .single();

      if ((paymentType === "ONE_TIME_FIX" || paymentType === "RESUME_FIX") && profile && !profile.first_time_fix_used) {
        amount = 14900; // ₹149 (50% off)
        discountApplied = true;
      }
      if ((paymentType === "EARLY_BIRD_ACCESS" || paymentType === "UNLIMITED_PLAN") && profile && !profile.first_time_early_bird_used) {
        amount = 149900; // ₹1,499 (student pricing for unlimited)
        discountApplied = true;
      }
    }

    console.log(`[PAYMENT AUDIT] user=${user.id} type=${paymentType} baseAmount=${baseAmount} finalAmount=${amount} isStudent=${isStudent} discountApplied=${discountApplied}`);

    const RAZORPAY_KEY_ID = Deno.env.get("RAZORPAY_KEY_ID")!;
    const RAZORPAY_KEY_SECRET = Deno.env.get("RAZORPAY_KEY_SECRET")!;

    // Create Razorpay order
    const rpRes = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Basic " + btoa(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`),
      },
      body: JSON.stringify({
        amount,
        currency: "INR",
        receipt: crypto.randomUUID(),
        payment_capture: 1,
      }),
    });

    if (!rpRes.ok) {
      const errText = await rpRes.text();
      throw new Error(`Razorpay order failed: ${errText}`);
    }
    const rpOrder = await rpRes.json();

    // Save payment record
    const { data: payment, error: insertErr } = await admin.from("payments").insert({
      user_id: user.id,
      resume_analysis_id: resumeAnalysisId || null,
      resume_builder_id: resumeBuilderId || null,
      payment_type: paymentType,
      amount,
      currency: "INR",
      razorpay_order_id: rpOrder.id,
      status: "INITIATED",
    }).select("id").single();

    if (insertErr) throw insertErr;

    return new Response(JSON.stringify({
      orderId: rpOrder.id,
      keyId: RAZORPAY_KEY_ID,
      amount,
      currency: "INR",
      paymentId: payment.id,
      discountApplied,
      isStudent,
      originalAmount: baseAmount,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
