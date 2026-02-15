import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { resumeText, analysisResult } = await req.json();
    if (!resumeText) throw new Error("Missing resume text");

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("AI API key not configured");

    const systemPrompt = `You are a professional resume writer and ATS optimization expert. Given a resume and its analysis, generate an improved version of the resume content.

RULES:
- Optimize for ATS compatibility
- Use strong action verbs with quantified achievements
- Keep content professional and impactful
- Extract and improve the actual content from the original resume
- Do NOT fabricate experience or qualifications
- Improve bullet points to be achievement-focused with metrics
- Rewrite the summary to be compelling and keyword-rich`;

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: `Original Resume:\n${resumeText}\n\nAnalysis Feedback:\n${JSON.stringify(analysisResult, null, 2)}\n\nGenerate an improved version.`,
          },
        ],
        tools: [{
          type: "function",
          function: {
            name: "submit_fixed_resume",
            description: "Submit the improved resume content",
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
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "submit_fixed_resume" } },
        temperature: 0.3,
      }),
    });

    if (!aiResponse.ok) {
      if (aiResponse.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiResponse.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted" }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error("AI fix generation failed");
    }

    const aiData = await aiResponse.json();
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.arguments) throw new Error("No structured output");

    const fixedContent = JSON.parse(toolCall.function.arguments);

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
