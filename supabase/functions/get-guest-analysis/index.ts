import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { token } = await req.json();
    if (!token || typeof token !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(token)) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data, error } = await admin
      .from("guest_analyses")
      .select("*")
      .eq("session_token", token)
      .is("claimed_by", null)
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return new Response(JSON.stringify({ error: "Analysis not found or expired" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check expiry
    if (new Date(data.expires_at) < new Date()) {
      return new Response(JSON.stringify({ error: "Analysis expired. Please upload again." }), {
        status: 410, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Return TRUNCATED data — scores + performance tag only, no detailed issues/recommendations
    const result = data.analysis_result as any;
    const truncatedResult = {
      atsScore: result?.atsScore ?? data.ats_score,
      recruiterScanScore: result?.recruiterScanScore ?? data.recruiter_scan_score,
      keywordStrengthScore: result?.keywordStrengthScore ?? data.keyword_strength_score,
      quantificationScore: result?.quantificationScore ?? data.quantification_score,
      structureScore: result?.structureScore ?? data.structure_score,
      interviewProbability: result?.interviewProbability ?? data.interview_probability,
      marketCompetitivenessLevel: result?.marketCompetitivenessLevel ?? data.market_competitiveness,
      performanceLevelTag: result?.performanceLevelTag,
      contextStatement: result?.contextStatement,
      resumeType: result?.resumeType ?? data.resume_type,
      // Counts only — no actual content
      criticalIssuesCount: result?.criticalIssues?.length ?? 0,
      warningsCount: result?.warnings?.length ?? 0,
      optimizationsCount: result?.optimizationOpportunities?.length ?? 0,
    };

    return new Response(JSON.stringify({
      token: data.session_token,
      fileName: data.file_name,
      createdAt: data.created_at,
      result: truncatedResult,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("get-guest-analysis error:", err);
    return new Response(JSON.stringify({ error: err.message || "Internal error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
