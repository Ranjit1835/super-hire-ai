import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const { action, referral_code, user_id } = await req.json();

  // GET referral info (code + stats) for a logged-in user
  if (action === "get_referral_info") {
    const { data: profile } = await supabase
      .from("profiles")
      .select("referral_code, referral_credits")
      .eq("user_id", user_id)
      .single();

    const { count: referral_count } = await supabase
      .from("referrals")
      .select("id", { count: "exact", head: true })
      .eq("referrer_id", profile?.id ?? "");

    const { count: successful_count } = await supabase
      .from("referrals")
      .select("id", { count: "exact", head: true })
      .eq("referrer_id", profile?.id ?? "")
      .eq("credit_awarded", true);

    return new Response(JSON.stringify({
      referral_code: profile?.referral_code,
      referral_credits: profile?.referral_credits ?? 0,
      referral_count: referral_count ?? 0,
      successful_count: successful_count ?? 0,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  // APPLY referral code at signup (called when referred user signs up)
  if (action === "apply_referral") {
    // Look up referrer by code
    const { data: referrerProfile } = await supabase
      .from("profiles")
      .select("id, user_id")
      .eq("referral_code", referral_code.toUpperCase())
      .single();

    if (!referrerProfile) {
      return new Response(JSON.stringify({ error: "Invalid referral code" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Get referred user's profile
    const { data: referredProfile } = await supabase
      .from("profiles")
      .select("id")
      .eq("user_id", user_id)
      .single();

    if (!referredProfile) {
      return new Response(JSON.stringify({ error: "User profile not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Cannot refer yourself
    if (referrerProfile.user_id === user_id) {
      return new Response(JSON.stringify({ error: "Cannot use your own referral code" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Insert referral record (upsert — one referral per user)
    const { error } = await supabase
      .from("referrals")
      .upsert({
        referrer_id: referrerProfile.id,
        referred_user_id: referredProfile.id,
      }, { onConflict: "referred_user_id" });

    // Update referred user's profile with referred_by
    await supabase
      .from("profiles")
      .update({ referred_by: referrerProfile.id })
      .eq("user_id", user_id);

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  // REDEEM credit: use 1 referral credit for a free resume fix
  if (action === "redeem_credit") {
    const { data: profile } = await supabase
      .from("profiles")
      .select("id, referral_credits")
      .eq("user_id", user_id)
      .single();

    if (!profile || profile.referral_credits < 1) {
      return new Response(JSON.stringify({ error: "No credits available" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Deduct credit and mark fix as unlocked (reuse fix_unlocked logic)
    const { error: deductError } = await supabase
      .from("profiles")
      .update({ referral_credits: profile.referral_credits - 1 })
      .eq("id", profile.id);

    if (deductError) {
      return new Response(JSON.stringify({ error: deductError.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    return new Response(JSON.stringify({ success: true, credits_remaining: profile.referral_credits - 1 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  return new Response(JSON.stringify({ error: "Unknown action" }), {
    status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
});
