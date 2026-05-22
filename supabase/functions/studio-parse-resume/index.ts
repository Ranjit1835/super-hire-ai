import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing authorization");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const {
      data: { user },
      error: authErr,
    } = await supabase.auth.getUser();
    if (authErr || !user) throw new Error("Unauthorized");

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { resumeText, title } = await req.json();
    if (!resumeText || typeof resumeText !== "string" || resumeText.length < 50) {
      throw new Error("Resume text is too short or missing");
    }

    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) throw new Error("Anthropic API key not configured");

    // Use Claude Sonnet for high-quality parsing
    const parseResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6-20250514",
        max_tokens: 4096,
        messages: [
          {
            role: "user",
            content: `Parse the following resume text into a structured JSON object. Extract ALL information accurately. Do not fabricate any details — if a field is not found, use an empty string or empty array.

Return ONLY valid JSON matching this exact schema:
{
  "personal_info": {
    "name": "string",
    "email": "string",
    "phone": "string",
    "location": "string",
    "linkedin": "string",
    "github": "string",
    "portfolio": "string"
  },
  "summary": "string (professional summary or objective)",
  "experience": [
    {
      "company": "string",
      "role": "string",
      "start_date": "string (e.g., Jan 2022)",
      "end_date": "string (e.g., Present)",
      "location": "string",
      "bullets": ["string"]
    }
  ],
  "education": [
    {
      "institution": "string",
      "degree": "string",
      "field": "string",
      "year": "string",
      "gpa": "string",
      "location": "string"
    }
  ],
  "skills": [
    {
      "category": "string (e.g., Programming Languages, Frameworks)",
      "items": ["string"]
    }
  ],
  "projects": [
    {
      "name": "string",
      "description": "string",
      "link": "string",
      "tech": ["string"],
      "bullets": ["string"]
    }
  ],
  "certifications": [
    {
      "name": "string",
      "issuer": "string",
      "year": "string",
      "link": "string"
    }
  ],
  "extras": {
    "languages": ["string"],
    "awards": ["string"],
    "volunteer": ["string"]
  }
}

RULES:
- Extract every bullet point from work experience verbatim
- Infer skill categories from context (Programming Languages, Frameworks, Tools, etc.)
- Parse dates in a consistent format (Mon YYYY)
- If skills are listed as comma-separated, split them into individual items
- Preserve the original order of sections and entries
- Do NOT add information that isn't in the resume

RESUME TEXT:
${resumeText}`,
          },
        ],
      }),
    });

    if (!parseResponse.ok) {
      const errText = await parseResponse.text();
      console.error("[STUDIO PARSE] Anthropic API error:", errText);
      throw new Error("Failed to parse resume with AI");
    }

    const parseData = await parseResponse.json();
    const rawContent = parseData.content?.[0]?.text || "";

    // Extract JSON from the response (handle markdown code blocks)
    let jsonStr = rawContent;
    const jsonMatch = rawContent.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    let parsedJson;
    try {
      parsedJson = JSON.parse(jsonStr);
    } catch {
      console.error("[STUDIO PARSE] Failed to parse JSON:", jsonStr.slice(0, 500));
      throw new Error("Failed to extract structured data from resume");
    }

    // Validate required top-level keys
    const requiredKeys = ["personal_info", "summary", "experience", "education", "skills", "projects", "certifications", "extras"];
    for (const key of requiredKeys) {
      if (!(key in parsedJson)) {
        parsedJson[key] = key === "summary" ? "" : key === "extras"
          ? { languages: [], awards: [], volunteer: [] }
          : key === "personal_info"
          ? { name: "", email: "", phone: "", location: "", linkedin: "", github: "", portfolio: "" }
          : [];
      }
    }

    // Ensure extras has all sub-fields
    if (typeof parsedJson.extras !== "object" || parsedJson.extras === null) {
      parsedJson.extras = { languages: [], awards: [], volunteer: [] };
    }
    parsedJson.extras.languages = parsedJson.extras.languages || [];
    parsedJson.extras.awards = parsedJson.extras.awards || [];
    parsedJson.extras.volunteer = parsedJson.extras.volunteer || [];

    // Create studio_resume record
    const resumeTitle = title || `Resume - ${parsedJson.personal_info?.name || "Untitled"}`;

    const { data: studioResume, error: insertErr } = await admin
      .from("studio_resumes")
      .insert({
        user_id: user.id,
        parsed_json: parsedJson,
        current_json: parsedJson,
        title: resumeTitle,
        template_id: "classic-ats",
        persona: "big-tech",
      })
      .select("id, title, parsed_json, current_json, template_id, persona, created_at")
      .single();

    if (insertErr) {
      console.error("[STUDIO PARSE] Insert error:", insertErr);
      throw new Error("Failed to save parsed resume");
    }

    // Generate initial suggestions in background (fire and forget)
    generateSuggestions(admin, studioResume.id, parsedJson).catch((e) =>
      console.error("[STUDIO PARSE] Suggestion generation failed:", e)
    );

    const tokensUsed = parseData.usage?.input_tokens + parseData.usage?.output_tokens || 0;
    console.log(`[STUDIO PARSE] user=${user.id} resume=${studioResume.id} tokens=${tokensUsed}`);

    return new Response(
      JSON.stringify({
        resume: studioResume,
        tokensUsed,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("[STUDIO PARSE] Error:", err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// Background: analyze resume and generate smart suggestions
async function generateSuggestions(admin: any, resumeId: string, json: any) {
  const suggestions: any[] = [];

  // Check for weak bullets (no metrics)
  const metricPattern = /\d+%|\$[\d,]+|\d+\+?x|\d{2,}[+]?\s*(users|customers|requests|transactions|records|orders|clients)/i;
  for (let i = 0; i < (json.experience || []).length; i++) {
    const exp = json.experience[i];
    for (let j = 0; j < (exp.bullets || []).length; j++) {
      if (!metricPattern.test(exp.bullets[j])) {
        suggestions.push({
          resume_id: resumeId,
          type: "weak_bullet",
          target_path: `experience[${i}].bullets[${j}]`,
          suggestion: `This bullet lacks quantifiable metrics. Add numbers like percentages, dollar amounts, or scale to make it more impactful.`,
          severity: "high",
        });
      }
    }
  }

  // Check for filler words
  const fillerPatterns = [
    /responsible for/i,
    /helped with/i,
    /assisted in/i,
    /worked on/i,
    /involved in/i,
    /participated in/i,
    /tasked with/i,
  ];
  for (let i = 0; i < (json.experience || []).length; i++) {
    const exp = json.experience[i];
    for (let j = 0; j < (exp.bullets || []).length; j++) {
      for (const pattern of fillerPatterns) {
        if (pattern.test(exp.bullets[j])) {
          suggestions.push({
            resume_id: resumeId,
            type: "filler_words",
            target_path: `experience[${i}].bullets[${j}]`,
            suggestion: `Replace "${exp.bullets[j].match(pattern)?.[0]}" with a strong action verb like Led, Architected, Shipped, Reduced, or Increased.`,
            severity: "medium",
          });
          break;
        }
      }
    }
  }

  // Check for missing sections
  if (!json.summary || json.summary.trim().length < 20) {
    suggestions.push({
      resume_id: resumeId,
      type: "missing_section",
      target_path: "summary",
      suggestion: "Add a compelling professional summary (2-3 sentences) highlighting your years of experience, key skills, and career focus.",
      severity: "high",
    });
  }

  if (!json.projects || json.projects.length === 0) {
    suggestions.push({
      resume_id: resumeId,
      type: "missing_section",
      target_path: "projects",
      suggestion: "Consider adding a Projects section to showcase hands-on work, especially for technical roles.",
      severity: "medium",
    });
  }

  if (!json.skills || json.skills.length === 0) {
    suggestions.push({
      resume_id: resumeId,
      type: "missing_section",
      target_path: "skills",
      suggestion: "Add a Skills section organized by category (Languages, Frameworks, Tools) for better ATS compatibility.",
      severity: "high",
    });
  }

  // Check for passive voice in summary
  const passivePatterns = [/is being/i, /was being/i, /has been/i, /have been/i, /will be/i, /being managed/i];
  if (json.summary) {
    for (const pattern of passivePatterns) {
      if (pattern.test(json.summary)) {
        suggestions.push({
          resume_id: resumeId,
          type: "passive_voice",
          target_path: "summary",
          suggestion: "Your summary uses passive voice. Rewrite with active, first-person language that shows ownership and impact.",
          severity: "medium",
        });
        break;
      }
    }
  }

  // Check for date inconsistencies
  const dateFormats = new Set<string>();
  for (const exp of json.experience || []) {
    if (exp.start_date) {
      if (/^\d{4}$/.test(exp.start_date)) dateFormats.add("year-only");
      else if (/^[A-Za-z]+\s+\d{4}$/.test(exp.start_date)) dateFormats.add("month-year");
      else if (/^\d{2}\/\d{4}$/.test(exp.start_date)) dateFormats.add("numeric");
      else dateFormats.add("other");
    }
  }
  if (dateFormats.size > 1) {
    suggestions.push({
      resume_id: resumeId,
      type: "inconsistency",
      target_path: "experience",
      suggestion: "Date formats are inconsistent across your experience entries. Use a uniform format like 'Jan 2022' throughout.",
      severity: "low",
    });
  }

  if (suggestions.length > 0) {
    // Limit to 15 most important
    const sorted = suggestions.sort((a, b) => {
      const sev = { high: 0, medium: 1, low: 2 } as Record<string, number>;
      return (sev[a.severity] ?? 2) - (sev[b.severity] ?? 2);
    });
    const toInsert = sorted.slice(0, 15);
    await admin.from("studio_suggestions").insert(toInsert);
  }
}
