import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { aiToolCall, isRateLimit } from "../_shared/ai.ts";
import { NO_INVENTED_METRICS_RULE } from "../_shared/resume-honesty.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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

    const body = await req.json();
    const resumeText = body.resumeText;
    const analysisResult = body.analysisResult;

    // ─── Input Validation ────────────────────────────────────────────
    if (!resumeText || typeof resumeText !== "string") throw new Error("Invalid resume text");
    if (resumeText.length < 50) throw new Error("Resume text too short");
    if (resumeText.length > 50000) throw new Error("Resume text exceeds maximum size");
    if (!analysisResult || typeof analysisResult !== "object" || Array.isArray(analysisResult)) throw new Error("Invalid analysis result");
    // Validate expected fields in analysisResult
    if (analysisResult.criticalIssues !== undefined && !Array.isArray(analysisResult.criticalIssues)) throw new Error("Invalid analysis result structure");
    if (analysisResult.warnings !== undefined && !Array.isArray(analysisResult.warnings)) throw new Error("Invalid analysis result structure");
    // Cap analysisResult size to prevent abuse
    const analysisJson = JSON.stringify(analysisResult);
    if (analysisJson.length > 100000) throw new Error("Analysis result too large");

    const systemPrompt = `You are an elite professional resume writer and ATS optimization specialist. Given a resume and its detailed analysis, generate a measurably improved version.

IMPROVEMENT REQUIREMENTS:
1. QUANTIFICATION: Make impact measurable. Keep every real number from the resume and bring it to the front of the bullet. Where a bullet has no number, add a [placeholder] naming what the candidate should measure — never a made-up figure.
2. ACTION VERBS: Replace weak verbs (helped, worked, responsible for, managed) with high-impact verbs (spearheaded, architected, accelerated, delivered, orchestrated, engineered).
3. KEYWORD ENRICHMENT: Naturally weave in the missing high-impact keywords identified in the analysis. Ensure domain-critical terms appear in context.
4. SECTION CLARITY: Ensure each section is clearly delineated, properly ordered, and ATS-parseable.
5. SUMMARY: Rewrite to be a compelling 3-4 sentence value proposition that immediately communicates seniority, specialization, and measurable impact.

RULES:
- Do NOT fabricate experience, companies, or qualifications
- Improve existing content — don't invent new roles or achievements
- Every bullet should follow: Strong Verb + What You Did + Result — using the candidate's real result, or a [placeholder] when the resume doesn't state one
- The improved version must logically produce better scores when re-analyzed
- Keep professional tone — no buzzwords without substance
${NO_INVENTED_METRICS_RULE}`;

    let fixedContent: any;
    try {
      fixedContent = await aiToolCall({
        system: systemPrompt,
        messages: [{
          role: "user",
          content: `Original Resume:\n${resumeText}\n\nAnalysis Feedback:\n${JSON.stringify(analysisResult, null, 2)}\n\nGenerate an improved version.`,
        }],
        toolName: "submit_fixed_resume",
        toolDescription: "Submit the improved resume content",
        temperature: 0.3,
        parameters: {
          type: "object",
          properties: {
            name: { type: "string" },
            email: { type: "string" },
            phone: { type: "string" },
            summary: { type: "string" },
            experience: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  company: { type: "string" },
                  duration: { type: "string" },
                  bullets: { type: "array", items: { type: "string" } },
                },
                required: ["title", "company", "duration", "bullets"],
              },
            },
            education: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  degree: { type: "string" },
                  school: { type: "string" },
                  year: { type: "string" },
                },
                required: ["degree", "school", "year"],
              },
            },
            skills: { type: "array", items: { type: "string" } },
          },
          required: ["name", "email", "summary", "experience", "education", "skills"],
        },
      });
    } catch (e) {
      if (isRateLimit(e)) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      console.error("fix-resume AI call failed:", e);
      throw new Error("AI fix generation failed");
    }

    return new Response(JSON.stringify({ fixedContent }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("fix-resume error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
