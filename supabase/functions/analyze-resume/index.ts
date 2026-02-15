import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `You are a Senior Technical Recruiter with 10+ years of hiring experience combined with an ATS Evaluation Engine. You must perform multi-layer internal reasoning before producing scores.

ANALYSIS LAYERS (perform internally before scoring):

LAYER 1 – STRUCTURAL PARSING: Detect standard sections, penalize non-standard headers, evaluate ordering, detect dense blocks.

LAYER 2 – KEYWORD INTELLIGENCE: Extract top 25 technical keywords, compute density, detect missing domain keywords, score relevance.

LAYER 3 – QUANTIFICATION ANALYSIS: Count metrics (%, $, numbers), compute density, penalize generic verbs, reward impact verbs.

LAYER 4 – RECRUITER PSYCHOLOGY: Simulate 6-second scan. Is value proposition clear? Seniority obvious? Specialization clear? Differentiation visible?

LAYER 5 – ATS SIMULATION: Section detection probability, skill extraction probability, keyword matching behavior, parsing clarity.

CRITICAL RULES:
- Do NOT provide generic resume advice
- Every issue must be specific, measurable, and tied to the actual resume content
- Scores must reflect genuine analysis, not default values
- Be brutally honest but constructive`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) throw new Error("No authorization header");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw new Error("Unauthorized");

    const { resumeText, fileName, contentHash } = await req.json();
    if (!resumeText || !fileName || !contentHash) throw new Error("Missing required fields");

    // Check cache
    const { data: cached } = await supabase
      .from("resume_analyses")
      .select("id")
      .eq("user_id", user.id)
      .eq("content_hash", contentHash)
      .maybeSingle();

    if (cached) {
      return new Response(JSON.stringify({ id: cached.id, cached: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("AI API key not configured");

    // Call AI with tool calling for structured output
    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `Analyze this resume thoroughly using all 5 layers:\n\n${resumeText}` },
        ],
        tools: [{
          type: "function",
          function: {
            name: "submit_analysis",
            description: "Submit the complete resume analysis results",
            parameters: {
              type: "object",
              properties: {
                atsScore: { type: "number", description: "ATS compatibility score 0-100" },
                recruiterScanScore: { type: "number", description: "Recruiter 6-second scan score 0-100" },
                keywordStrengthScore: { type: "number", description: "Keyword relevance and density score 0-100" },
                quantificationScore: { type: "number", description: "Metrics and quantification score 0-100" },
                structureScore: { type: "number", description: "Resume structure and formatting score 0-100" },
                interviewProbability: { type: "number", description: "Probability of getting interview 0-100" },
                marketCompetitivenessLevel: { type: "string", enum: ["Below Average", "Competitive", "Strong", "Elite"] },
                criticalIssues: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      issue: { type: "string" },
                      impactLevel: { type: "string", enum: ["HIGH", "MEDIUM", "LOW"] },
                      whyItMatters: { type: "string" },
                      fixRecommendation: { type: "string" },
                    },
                    required: ["issue", "impactLevel", "whyItMatters", "fixRecommendation"],
                  },
                },
                warnings: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      issue: { type: "string" },
                      impactLevel: { type: "string", enum: ["HIGH", "MEDIUM", "LOW"] },
                      whyItMatters: { type: "string" },
                      fixRecommendation: { type: "string" },
                    },
                    required: ["issue", "impactLevel", "whyItMatters", "fixRecommendation"],
                  },
                },
                optimizationOpportunities: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      issue: { type: "string" },
                      impactLevel: { type: "string", enum: ["HIGH", "MEDIUM", "LOW"] },
                      whyItMatters: { type: "string" },
                      fixRecommendation: { type: "string" },
                    },
                    required: ["issue", "impactLevel", "whyItMatters", "fixRecommendation"],
                  },
                },
                advancedRefinements: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      issue: { type: "string" },
                      impactLevel: { type: "string", enum: ["HIGH", "MEDIUM", "LOW"] },
                      whyItMatters: { type: "string" },
                      fixRecommendation: { type: "string" },
                    },
                    required: ["issue", "impactLevel", "whyItMatters", "fixRecommendation"],
                  },
                },
                rewrittenSummary: { type: "string" },
                rewrittenStrongBullets: { type: "array", items: { type: "string" } },
                missingHighImpactKeywords: { type: "array", items: { type: "string" } },
                recruiterPsychologyInsight: { type: "string" },
                finalVerdict: { type: "string" },
              },
              required: [
                "atsScore", "recruiterScanScore", "keywordStrengthScore", "quantificationScore",
                "structureScore", "interviewProbability", "marketCompetitivenessLevel",
                "criticalIssues", "warnings", "optimizationOpportunities", "advancedRefinements",
                "rewrittenSummary", "rewrittenStrongBullets", "missingHighImpactKeywords",
                "recruiterPsychologyInsight", "finalVerdict"
              ],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "submit_analysis" } },
        temperature: 0.2,
      }),
    });

    if (!aiResponse.ok) {
      const status = aiResponse.status;
      if (status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again later." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please add credits." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const text = await aiResponse.text();
      console.error("AI error:", status, text);
      throw new Error("AI analysis failed");
    }

    const aiData = await aiResponse.json();
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.arguments) throw new Error("AI did not return structured output");

    let analysisResult;
    try {
      analysisResult = JSON.parse(toolCall.function.arguments);
    } catch {
      throw new Error("Invalid AI response format");
    }

    // Validate required fields
    if (typeof analysisResult.atsScore !== "number") throw new Error("Invalid analysis result");

    // Store in database (only cache successful, validated responses)
    const { data: inserted, error: insertError } = await supabase
      .from("resume_analyses")
      .insert({
        user_id: user.id,
        file_name: fileName,
        content_hash: contentHash,
        resume_text: resumeText,
        ats_score: analysisResult.atsScore,
        recruiter_scan_score: analysisResult.recruiterScanScore,
        keyword_strength_score: analysisResult.keywordStrengthScore,
        quantification_score: analysisResult.quantificationScore,
        structure_score: analysisResult.structureScore,
        interview_probability: analysisResult.interviewProbability,
        market_competitiveness: analysisResult.marketCompetitivenessLevel,
        analysis_result: analysisResult,
      })
      .select("id")
      .single();

    if (insertError) throw insertError;

    return new Response(JSON.stringify({ id: inserted.id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("analyze-resume error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
