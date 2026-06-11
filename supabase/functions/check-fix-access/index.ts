import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
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

    const url = new URL(req.url);
    const resumeAnalysisId = url.searchParams.get("resumeAnalysisId");
    if (!resumeAnalysisId) throw new Error("resumeAnalysisId required");

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Check plan type and early bird
    const { data: profile } = await admin
      .from("profiles")
      .select("early_bird_active, early_bird_expiry_date, plan_type, plan_expiry_date")
      .eq("user_id", user.id)
      .single();

    // UNLIMITED plan bypasses all limits
    if (profile?.plan_type === "UNLIMITED" && profile.plan_expiry_date && new Date(profile.plan_expiry_date) > new Date()) {
      return new Response(JSON.stringify({ canAccess: true, reason: "UNLIMITED_PLAN" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (profile?.early_bird_active && profile.early_bird_expiry_date && new Date(profile.early_bird_expiry_date) > new Date()) {
      return new Response(JSON.stringify({ canAccess: true, reason: "EARLY_BIRD_ACCESS" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check resume-level unlock
    const { data: resume } = await admin
      .from("resume_analyses")
      .select("is_paid_fix_unlocked")
      .eq("id", resumeAnalysisId)
      .eq("user_id", user.id)
      .single();

    if (resume?.is_paid_fix_unlocked) {
      return new Response(JSON.stringify({ canAccess: true, reason: "ONE_TIME_FIX" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ canAccess: false, reason: "PAYMENT_REQUIRED" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
