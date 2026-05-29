import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const AI_MODEL = "claude-haiku-4-5-20251001";

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
1. QUANTIFICATION: Add or enhance metrics in every bullet point. Convert vague statements into measurable achievements (percentages, dollar amounts, team sizes, timeframes).
2. ACTION VERBS: Replace weak verbs (helped, worked, responsible for, managed) with high-impact verbs (spearheaded, architected, accelerated, delivered, orchestrated, engineered).
3. KEYWORD ENRICHMENT: Naturally weave in the missing high-impact keywords identified in the analysis. Ensure domain-critical terms appear in context.
4. SECTION CLARITY: Ensure each section is clearly delineated, properly ordered, and ATS-parseable.
5. SUMMARY: Rewrite to be a compelling 3-4 sentence value proposition that immediately communicates seniority, specialization, and measurable impact.

RULES:
- Do NOT fabricate experience, companies, or qualifications
- Improve existing content — don't invent new roles or achievements
- Every bullet must follow the format: [Strong Verb] + [What You Did] + [Measurable Result]
- The improved version must logically produce better scores when re-analyzed
- Keep professional tone — no buzzwords without substance`;

    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) throw new Error("Anthropic API key not configured");

    const aiResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: AI_MODEL,
        max_tokens: 4096,
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: `Original Resume:\n${resumeText}\n\nAnalysis Feedback:\n${JSON.stringify(analysisResult, null, 2)}\n\nGenerate an improved version.`,
          },
        ],
        tools: [{
          name: "submit_fixed_resume",
          description: "Submit the improved resume content",
          input_schema: {
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
        }],
        tool_choice: { type: "tool", name: "submit_fixed_resume" },
        temperature: 0.3,
      }),
    });

    if (!aiResponse.ok) {
      if (aiResponse.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errText = await aiResponse.text();
      console.error("AI error:", aiResponse.status, errText);
      throw new Error("AI fix generation failed");
    }

    const aiData = await aiResponse.json();
    if (aiData.usage) console.log("Token usage:", JSON.stringify(aiData.usage));

    const toolUse = aiData.content?.find((c: any) => c.type === "tool_use");
    if (!toolUse?.input) throw new Error("No structured output");

    const fixedContent = typeof toolUse.input === "string" ? JSON.parse(toolUse.input) : toolUse.input;

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
