import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const AI_MODEL = Deno.env.get("AI_MODEL") || "google/gemini-2.5-flash";

// ─── Deterministic Metrics Engine ───────────────────────────────────────────
const STRONG_VERBS = new Set([
  "spearheaded","architected","accelerated","delivered","orchestrated","engineered",
  "transformed","optimized","pioneered","launched","negotiated","streamlined",
  "redesigned","automated","consolidated","drove","increased","reduced","generated",
  "implemented","developed","established","led","built","scaled","improved","achieved",
  "exceeded","managed","directed","created","designed","executed","resolved","overhauled",
]);
const WEAK_VERBS = new Set([
  "helped","worked","responsible","assisted","participated","contributed","involved",
  "supported","handled","used","utilized","did","made","got","tried",
]);

function computeTextMetrics(text: string) {
  if (!text) return { quantCount: 0, strongVerbCount: 0, weakVerbCount: 0, keywordDensity: 0, sectionCount: 0 };
  const quantRegex = /\d+[\.,]?\d*\s*[%$€£]|\$\s*\d+[\.,]?\d*[KMBkmb]?|\d+[\.,]?\d*\s*(percent|million|billion|thousand|users|customers|teams|people|projects|years|months|revenue|growth|savings|reduction|improvement|increase|decrease)/gi;
  const quantCount = (text.match(quantRegex) || []).length;
  const metricNumbers = (text.match(/\b\d+[+x%]|\$[\d,.]+[KMBkmb]?/g) || []).length;
  
  const words = text.toLowerCase().split(/\s+/);
  let strongVerbCount = 0;
  let weakVerbCount = 0;
  for (const w of words) {
    const clean = w.replace(/[^a-z]/g, "");
    if (STRONG_VERBS.has(clean)) strongVerbCount++;
    if (WEAK_VERBS.has(clean)) weakVerbCount++;
  }

  const sectionHeaders = (text.match(/\b(experience|education|skills|summary|objective|projects|certifications|awards|publications|languages|interests|volunteer|professional)\b/gi) || []).length;

  return {
    quantCount: quantCount + metricNumbers,
    strongVerbCount,
    weakVerbCount,
    keywordDensity: words.length > 0 ? (strongVerbCount / words.length) * 100 : 0,
    sectionCount: sectionHeaders,
  };
}

function metricsImproved(current: ReturnType<typeof computeTextMetrics>, previous: ReturnType<typeof computeTextMetrics>): boolean {
  let improvements = 0;
  let declines = 0;
  if (current.quantCount > previous.quantCount) improvements++;
  else if (current.quantCount < previous.quantCount) declines++;
  if (current.strongVerbCount > previous.strongVerbCount) improvements++;
  else if (current.strongVerbCount < previous.strongVerbCount) declines++;
  if (current.weakVerbCount < previous.weakVerbCount) improvements++;
  else if (current.weakVerbCount > previous.weakVerbCount) declines++;
  if (current.sectionCount >= previous.sectionCount) improvements++;
  else declines++;
  return improvements >= declines;
}

// ─── Deterministic Scoring Formula ──────────────────────────────────────────
function computeDeterministicAtsScore(aiScores: Record<string, number>, textMetrics: ReturnType<typeof computeTextMetrics>): number {
  // Compute action verb score (0-100) from text metrics
  const totalVerbs = textMetrics.strongVerbCount + textMetrics.weakVerbCount;
  const actionVerbScore = totalVerbs > 0
    ? Math.round((textMetrics.strongVerbCount / totalVerbs) * 100)
    : 50; // neutral if no verbs detected

  const finalScore = Math.round(
    0.30 * (aiScores.keywordStrengthScore ?? 0) +
    0.25 * (aiScores.quantificationScore ?? 0) +
    0.20 * (aiScores.structureScore ?? 0) +
    0.15 * actionVerbScore +
    0.10 * (aiScores.recruiterScanScore ?? 0)
  );

  return Math.max(0, Math.min(100, finalScore));
}

const SYSTEM_PROMPT = `You are a Senior Technical Recruiter with 10+ years of hiring experience combined with an ATS Evaluation Engine. You must perform multi-layer internal reasoning before producing scores.

ANALYSIS LAYERS (perform internally before scoring):

LAYER 1 – STRUCTURAL PARSING: Detect standard sections (Contact, Summary, Experience, Education, Skills). Penalize non-standard headers, evaluate ordering, detect dense text blocks, check for proper reverse-chronological ordering.

LAYER 2 – KEYWORD INTELLIGENCE: Extract top 25 technical keywords from the resume, compute keyword density per section, detect missing domain-critical keywords for the candidate's apparent field, score relevance against typical job descriptions in their domain.

LAYER 3 – QUANTIFICATION ANALYSIS: Count all metrics (percentages, dollar amounts, numbers, team sizes, timeframes). Compute quantification density (metrics per bullet). Penalize generic action verbs (helped, worked, responsible for). Reward high-impact verbs (spearheaded, architected, accelerated, delivered).

LAYER 4 – RECRUITER PSYCHOLOGY: Simulate a real 6-second recruiter scan. Is the value proposition immediately clear? Is seniority level obvious within 3 seconds? Is specialization clear? Is there visible differentiation from other candidates? Would a recruiter keep reading or move to the next resume?

LAYER 5 – ATS SIMULATION: Simulate parsing through major ATS systems (Taleo, Greenhouse, Lever, Workday). Check section detection probability, skill extraction accuracy, keyword matching behavior, and overall parsing clarity. Flag any elements that would cause parsing failures.

SCORING STABILIZATION RULES:
- If the resume contains standard sections (Contact, Experience, Education, Skills), at least 3 quantified achievements, and a clear technical stack, the ATS score MUST NOT fall below 60 unless there are major structural errors (missing sections, tables/graphics that break ATS, non-standard file elements).
- Scoring must be consistent, realistic, and fair. Do not grade harshly for minor issues.
- A well-structured resume with some optimization gaps should score 65-79, not below 50.
- Reserve scores below 50 only for resumes with serious structural problems.

RESPONSE STYLE – HIGH IMPACT MODE:
- Be CONCISE and IMPACTFUL. Sound like a real senior recruiter giving blunt, actionable feedback.
- criticalIssues: Limit to TOP 3-5 most damaging issues only. Each must reference specific resume content.
- warnings: Limit to 2-3 strategic improvements. No filler.
- optimizationOpportunities: Limit to 2-3 high-value enhancements.
- advancedRefinements: Limit to 1-2 polish items. Only for already-good resumes.
- Tone: Direct recruiter voice. Example: "As a recruiter, I cannot identify your core specialization in the first 3 lines. This kills your 6-second scan."
- NO motivational filler. NO generic advice. Every sentence must be specific and actionable.
- Each issue must clearly state: what's wrong, why it hurts interview probability, and exactly how to fix it.

PERFORMANCE LEVEL MAPPING (use for performanceLevelTag field):
- 0-49: "High Risk – Immediate Fix Required"
- 50-64: "Needs Strategic Improvement"  
- 65-79: "Competitive but Optimizable"
- 80+: "Strong & Market Ready"

CRITICAL OUTPUT RULES:
- Do NOT provide generic resume advice. Every issue MUST reference specific content from the actual resume.
- Every problem statement must explain exactly WHY it hurts the candidate (recruiter impact or ATS impact).
- Every fix recommendation must be specific and actionable with an example when possible.
- Scores must reflect genuine multi-layer analysis, not default values.
- The contextStatement must be a single sentence describing the candidate's position relative to competitors in their field.`;

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

    // Service role client for global cache (bypasses RLS)
    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw new Error("Unauthorized");

    const body = await req.json();
    const resumeText = body.resumeText;
    const fileName = body.fileName;
    const contentHash = body.contentHash;
    const previousAnalysisId = body.previousAnalysisId;

    // ─── Input Validation ────────────────────────────────────────────
    if (!resumeText || typeof resumeText !== "string") throw new Error("Invalid resume text");
    if (resumeText.length < 50) throw new Error("Resume text too short");
    if (resumeText.length > 50000) throw new Error("Resume text exceeds maximum size");
    if (!fileName || typeof fileName !== "string") throw new Error("Invalid file name");
    if (fileName.length > 255) throw new Error("File name too long");
    if (!/^[\w\s.\-()]+\.pdf$/i.test(fileName)) throw new Error("Invalid file name format");
    if (!contentHash || typeof contentHash !== "string") throw new Error("Invalid content hash");
    if (!/^[a-f0-9]{64}$/.test(contentHash)) throw new Error("Invalid content hash format");
    if (previousAnalysisId !== undefined && previousAnalysisId !== null) {
      if (typeof previousAnalysisId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(previousAnalysisId)) {
        throw new Error("Invalid previous analysis ID format");
      }
    }

    // ─── Step 1: Check user-specific cache ───────────────────────────
    const { data: cached } = await supabase
      .from("resume_analyses")
      .select("id")
      .eq("user_id", user.id)
      .eq("content_hash", contentHash)
      .maybeSingle();

    if (cached) {
      // Return silently — no cached flag
      return new Response(JSON.stringify({ id: cached.id }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ─── Step 2: Check global score cache ────────────────────────────
    const { data: globalCached } = await serviceClient
      .from("resume_score_cache")
      .select("*")
      .eq("content_hash", contentHash)
      .maybeSingle();

    if (globalCached) {
      // Insert user-specific record with canonical scores
      const { data: inserted, error: insertError } = await supabase
        .from("resume_analyses")
        .insert({
          user_id: user.id,
          file_name: fileName,
          content_hash: contentHash,
          resume_text: resumeText,
          ats_score: globalCached.ats_score,
          recruiter_scan_score: globalCached.recruiter_scan_score,
          keyword_strength_score: globalCached.keyword_strength_score,
          quantification_score: globalCached.quantification_score,
          structure_score: globalCached.structure_score,
          interview_probability: globalCached.interview_probability,
          market_competitiveness: globalCached.market_competitiveness,
          analysis_result: globalCached.analysis_result,
        })
        .select("id")
        .single();

      if (insertError) throw insertError;

      return new Response(JSON.stringify({ id: inserted.id }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ─── Step 3: No cache — run AI analysis ──────────────────────────

    // Fetch previous analysis for score regression prevention
    let previousScores: Record<string, number> | null = null;
    let previousResumeText: string | null = null;
    if (previousAnalysisId) {
      const { data: prev } = await supabase
        .from("resume_analyses")
        .select("ats_score, recruiter_scan_score, keyword_strength_score, quantification_score, structure_score, interview_probability, resume_text")
        .eq("id", previousAnalysisId)
        .eq("user_id", user.id)
        .maybeSingle();
      if (prev) {
        previousScores = {
          atsScore: prev.ats_score ?? 0,
          recruiterScanScore: prev.recruiter_scan_score ?? 0,
          keywordStrengthScore: prev.keyword_strength_score ?? 0,
          quantificationScore: prev.quantification_score ?? 0,
          structureScore: prev.structure_score ?? 0,
          interviewProbability: prev.interview_probability ?? 0,
        };
        previousResumeText = prev.resume_text;
      }
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("AI API key not configured");

    let userMessage = `Analyze this resume thoroughly using all 5 layers:\n\n${resumeText}`;
    if (previousScores) {
      userMessage += `\n\nIMPORTANT CONTEXT: This is a RE-ANALYSIS of a previously fixed/improved resume. The previous version scored: ATS=${previousScores.atsScore}, RecruiterScan=${previousScores.recruiterScanScore}, Keywords=${previousScores.keywordStrengthScore}, Quantification=${previousScores.quantificationScore}, Structure=${previousScores.structureScore}. If the resume has measurably improved (more metrics, better verbs, better structure, more keywords), scores MUST NOT decrease — they should logically increase. Only reduce scores if specific measurable components have genuinely degraded.`;
    }

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userMessage },
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
                performanceLevelTag: { type: "string", description: "One of: High Risk – Immediate Fix Required, Needs Strategic Improvement, Competitive but Optimizable, Strong & Market Ready" },
                contextStatement: { type: "string", description: "One sentence describing candidate's position relative to competitors in their field" },
                rewrittenSummary: { type: "string" },
                rewrittenStrongBullets: { type: "array", items: { type: "string" }, description: "Top 3-5 improved bullet points demonstrating impact-first structure" },
                missingHighImpactKeywords: { type: "array", items: { type: "string" } },
                keywordEnrichmentSuggestions: { type: "array", items: { type: "string" }, description: "Specific phrases to weave into the resume for better keyword matching" },
                recruiterPsychologyInsight: { type: "string" },
                finalVerdict: { type: "string" },
              },
              required: [
                "atsScore", "recruiterScanScore", "keywordStrengthScore", "quantificationScore",
                "structureScore", "interviewProbability", "marketCompetitivenessLevel",
                "performanceLevelTag", "contextStatement",
                "criticalIssues", "warnings", "optimizationOpportunities", "advancedRefinements",
                "rewrittenSummary", "rewrittenStrongBullets", "missingHighImpactKeywords",
                "keywordEnrichmentSuggestions", "recruiterPsychologyInsight", "finalVerdict"
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
    
    if (aiData.usage) {
      console.log("Token usage:", JSON.stringify(aiData.usage));
    }

    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.arguments) throw new Error("AI did not return structured output");

    let analysisResult;
    try {
      analysisResult = JSON.parse(toolCall.function.arguments);
    } catch {
      throw new Error("Invalid AI response format");
    }

    if (typeof analysisResult.atsScore !== "number") throw new Error("Invalid analysis result");

    // ─── Response Truncation (Impact Mode enforcement) ───────────────
    if (analysisResult.criticalIssues?.length > 5) analysisResult.criticalIssues = analysisResult.criticalIssues.slice(0, 5);
    if (analysisResult.warnings?.length > 3) analysisResult.warnings = analysisResult.warnings.slice(0, 3);
    if (analysisResult.optimizationOpportunities?.length > 3) analysisResult.optimizationOpportunities = analysisResult.optimizationOpportunities.slice(0, 3);
    if (analysisResult.advancedRefinements?.length > 2) analysisResult.advancedRefinements = analysisResult.advancedRefinements.slice(0, 2);

    // ─── Deterministic ATS Score ─────────────────────────────────────
    const textMetrics = computeTextMetrics(resumeText);
    analysisResult.atsScore = computeDeterministicAtsScore(analysisResult, textMetrics);

    // ─── Score Regression Prevention ─────────────────────────────────
    if (previousScores && previousResumeText) {
      const currentMetrics = computeTextMetrics(resumeText);
      const previousMetrics = computeTextMetrics(previousResumeText);
      const improved = metricsImproved(currentMetrics, previousMetrics);

      console.log("Metrics comparison:", JSON.stringify({ currentMetrics, previousMetrics, improved }));

      const scoreKeys = ["atsScore", "recruiterScanScore", "keywordStrengthScore", "quantificationScore", "structureScore", "interviewProbability"] as const;
      
      if (improved) {
        for (const key of scoreKeys) {
          const prev = previousScores[key];
          const curr = analysisResult[key];
          if (typeof prev === "number" && typeof curr === "number" && curr < prev) {
            analysisResult[key] = Math.max(curr, prev);
          }
        }
      } else {
        for (const key of scoreKeys) {
          const prev = previousScores[key];
          const curr = analysisResult[key];
          if (typeof prev === "number" && typeof curr === "number" && curr < prev - 2) {
            analysisResult[key] = Math.max(curr, prev - 2);
          }
        }
      }
    } else if (previousScores) {
      const scoreKeys = ["atsScore", "recruiterScanScore", "keywordStrengthScore", "quantificationScore", "structureScore", "interviewProbability"] as const;
      for (const key of scoreKeys) {
        const prev = previousScores[key];
        const curr = analysisResult[key];
        if (typeof prev === "number" && typeof curr === "number" && curr < prev - 2) {
          analysisResult[key] = Math.max(curr, prev - 2);
        }
      }
    }

    // ─── Step 4: Store in global score cache ─────────────────────────
    await serviceClient
      .from("resume_score_cache")
      .upsert({
        content_hash: contentHash,
        ats_score: analysisResult.atsScore,
        recruiter_scan_score: analysisResult.recruiterScanScore,
        keyword_strength_score: analysisResult.keywordStrengthScore,
        quantification_score: analysisResult.quantificationScore,
        structure_score: analysisResult.structureScore,
        interview_probability: analysisResult.interviewProbability,
        market_competitiveness: analysisResult.marketCompetitivenessLevel,
        analysis_result: analysisResult,
      });

    // ─── Step 5: Store user-specific record ──────────────────────────
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
