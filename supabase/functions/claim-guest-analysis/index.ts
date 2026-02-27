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

    const { guestToken } = await req.json();
    if (!guestToken || typeof guestToken !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(guestToken)) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Fetch guest analysis
    const { data: guest, error: fetchErr } = await admin
      .from("guest_analyses")
      .select("*")
      .eq("session_token", guestToken)
      .is("claimed_by", null)
      .maybeSingle();

    if (fetchErr) throw fetchErr;
    if (!guest) {
      return new Response(JSON.stringify({ error: "Analysis not found, already claimed, or expired" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check expiry
    if (new Date(guest.expires_at) < new Date()) {
      return new Response(JSON.stringify({ error: "Analysis expired. Please upload again." }), {
        status: 410, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check if user already has this analysis (by content hash)
    const { data: existing } = await supabase
      .from("resume_analyses")
      .select("id")
      .eq("user_id", user.id)
      .eq("content_hash", guest.content_hash)
      .maybeSingle();

    if (existing) {
      // Mark guest as claimed and return existing
      await admin.from("guest_analyses").update({ claimed_by: user.id }).eq("id", guest.id);
      return new Response(JSON.stringify({ id: existing.id }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Copy to resume_analyses
    const { data: inserted, error: insertErr } = await supabase
      .from("resume_analyses")
      .insert({
        user_id: user.id,
        file_name: guest.file_name,
        content_hash: guest.content_hash,
        resume_text: guest.resume_text,
        ats_score: guest.ats_score,
        recruiter_scan_score: guest.recruiter_scan_score,
        keyword_strength_score: guest.keyword_strength_score,
        quantification_score: guest.quantification_score,
        structure_score: guest.structure_score,
        interview_probability: guest.interview_probability,
        market_competitiveness: guest.market_competitiveness,
        analysis_result: guest.analysis_result,
        resume_type: guest.resume_type,
      })
      .select("id")
      .single();

    if (insertErr) throw insertErr;

    // Mark guest as claimed
    await admin.from("guest_analyses").update({ claimed_by: user.id }).eq("id", guest.id);

    console.log(`[CLAIM] user=${user.id} guest_token=${guestToken} new_id=${inserted.id}`);

    return new Response(JSON.stringify({ id: inserted.id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("claim-guest-analysis error:", err);
    return new Response(JSON.stringify({ error: err.message || "Internal error" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
