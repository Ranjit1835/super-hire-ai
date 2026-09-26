import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { aiToolCall, isRateLimit } from "../_shared/ai.ts";
import { NO_INVENTED_METRICS_RULE } from "../_shared/resume-honesty.ts";

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

    const { content } = await req.json();
    if (!content) throw new Error("Missing resume content");

    const systemPrompt = `You are a professional resume writer and ATS optimization expert. You will receive resume content as JSON and must return improved content in the EXACT same JSON structure.

Rules:
- Improve the summary to be concise, impactful, and keyword-rich
- Rewrite project descriptions with strong action verbs and quantifiable results
- Rewrite experience responsibilities with STAR method, action verbs, and metrics
- Keep all original information but enhance the language
- Do NOT add fake information or make up metrics
- Suggest quantification where possible with a placeholder, not a guess (e.g., "managed team" → "Led a team of [N] engineers")
- Make content ATS-friendly with relevant industry keywords
- Return ONLY valid JSON, no markdown or extra text
${NO_INVENTED_METRICS_RULE}`;

    const inputSchema = {
      type: "object",
      properties: {
        basicInfo: {
          type: "object",
          properties: {
            fullName: { type: "string" },
            email: { type: "string" },
            phone: { type: "string" },
            linkedin: { type: "string" },
            github: { type: "string" },
          },
          required: ["fullName", "email", "phone", "linkedin", "github"],
        },
        summary: { type: "string" },
        skills: { type: "array", items: { type: "string" } },
        education: {
          type: "array",
          items: {
            type: "object",
            properties: { degree: { type: "string" }, college: { type: "string" }, year: { type: "string" } },
            required: ["degree", "college", "year"],
          },
        },
        projects: {
          type: "array",
          items: {
            type: "object",
            properties: { name: { type: "string" }, description: { type: "string" }, techStack: { type: "string" } },
            required: ["name", "description", "techStack"],
          },
        },
        experience: {
          type: "array",
          items: {
            type: "object",
            properties: { company: { type: "string" }, role: { type: "string" }, duration: { type: "string" }, responsibilities: { type: "string" } },
            required: ["company", "role", "duration", "responsibilities"],
          },
        },
        certifications: {
          type: "array",
          items: {
            type: "object",
            properties: { name: { type: "string" }, issuer: { type: "string" }, year: { type: "string" } },
            required: ["name", "issuer", "year"],
          },
        },
      },
      required: ["basicInfo", "summary", "skills", "education", "projects", "experience", "certifications"],
    };

    let enhanced: any;
    try {
      enhanced = await aiToolCall({
        system: systemPrompt,
        messages: [
          { role: "user", content: `Enhance this resume content and return the improved version as JSON with the exact same structure:\n\n${JSON.stringify(content)}` },
        ],
        toolName: "return_enhanced_resume",
        toolDescription: "Return the AI-enhanced resume content",
        parameters: inputSchema,
      });
    } catch (e) {
      if (isRateLimit(e)) {
        return new Response(JSON.stringify({ error: "AI service is busy. Please try again in a moment." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      console.error("enhance-resume AI call failed:", e);
      throw new Error("AI enhancement failed");
    }

    return new Response(JSON.stringify({ enhanced }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("enhance-resume error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
