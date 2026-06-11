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

    const { action, sessionId, role, experienceLevel, messages } = await req.json();

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) throw new Error("AI service not configured");
    console.log(`[MOCK-INTERVIEW] action=${action} user=${user.id}`);

    // ACTION: check-access
    if (action === "check-access") {
      const { data: profile, error: profileErr } = await admin
        .from("profiles")
        .select("early_bird_active, early_bird_expiry_date, monthly_interview_count, last_interview_reset_date, plan_type, plan_expiry_date")
        .eq("user_id", user.id)
        .single();

      if (profileErr) console.error("[MOCK-INTERVIEW] profile fetch error:", profileErr.message);

      const isUnlimited = profile?.plan_type === "UNLIMITED" && profile?.plan_expiry_date && new Date(profile.plan_expiry_date) > new Date();
      const isEarlyBird = profile?.early_bird_active && profile?.early_bird_expiry_date && new Date(profile.early_bird_expiry_date) > new Date();
      const hasPaidAccess = isUnlimited || isEarlyBird;

      // Reset monthly count if new month
      let monthlyCount = profile?.monthly_interview_count || 0;
      const lastReset = profile?.last_interview_reset_date ? new Date(profile.last_interview_reset_date) : new Date(0);
      const now = new Date();
      if (lastReset.getMonth() !== now.getMonth() || lastReset.getFullYear() !== now.getFullYear()) {
        monthlyCount = 0;
        await admin.from("profiles").update({
          monthly_interview_count: 0,
          last_interview_reset_date: now.toISOString(),
        }).eq("user_id", user.id);
      }

      // UNLIMITED plan has no monthly limit
      const monthlyLimit = isUnlimited ? Infinity : isEarlyBird ? 10 : 2;
      const canAccess = hasPaidAccess && monthlyCount < monthlyLimit;
      return new Response(JSON.stringify({
        canAccess,
        isEarlyBird: !!isEarlyBird,
        isUnlimited: !!isUnlimited,
        planType: isUnlimited ? "UNLIMITED" : isEarlyBird ? "EARLY_BIRD" : "FREE",
        monthlyCount,
        monthlyLimit: isUnlimited ? 999 : (isEarlyBird ? 10 : 2),
        reason: canAccess ? "PLAN_ACCESS" : hasPaidAccess ? "LIMIT_REACHED" : "PAYMENT_REQUIRED",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ACTION: start
    if (action === "start") {
      if (!role || !experienceLevel) throw new Error("role and experienceLevel required");

      // Verify access before starting — guard against clients that skip check-access
      const { data: accessProfile } = await admin
        .from("profiles")
        .select("early_bird_active, early_bird_expiry_date, monthly_interview_count, last_interview_reset_date, plan_type, plan_expiry_date")
        .eq("user_id", user.id)
        .single();

      const isUnlimited = accessProfile?.plan_type === "UNLIMITED" &&
        accessProfile?.plan_expiry_date &&
        new Date(accessProfile.plan_expiry_date) > new Date();
      const isEarlyBird = accessProfile?.early_bird_active &&
        accessProfile?.early_bird_expiry_date &&
        new Date(accessProfile.early_bird_expiry_date) > new Date();
      const hasPaidAccess = isUnlimited || isEarlyBird;

      let monthlyCount = accessProfile?.monthly_interview_count || 0;
      const lastReset = accessProfile?.last_interview_reset_date
        ? new Date(accessProfile.last_interview_reset_date)
        : new Date(0);
      const now = new Date();
      if (lastReset.getMonth() !== now.getMonth() || lastReset.getFullYear() !== now.getFullYear()) {
        monthlyCount = 0;
        await admin.from("profiles").update({
          monthly_interview_count: 0,
          last_interview_reset_date: now.toISOString(),
        }).eq("user_id", user.id);
      }

      // UNLIMITED plan has no monthly limit
      const startMonthlyLimit = isUnlimited ? Infinity : isEarlyBird ? 10 : 2;
      if (!hasPaidAccess || monthlyCount >= startMonthlyLimit) {
        return new Response(JSON.stringify({
          error: hasPaidAccess ? "Monthly interview limit reached" : "Payment required to start interview",
          reason: hasPaidAccess ? "LIMIT_REACHED" : "PAYMENT_REQUIRED",
        }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Increment monthly count
      await admin.from("profiles").update({
        monthly_interview_count: monthlyCount + 1,
      }).eq("user_id", user.id);

      const systemPrompt = `You are a professional interviewer conducting a ${experienceLevel}-level interview for a ${role} position.

Rules:
- Ask one question at a time
- Start with an introduction and first question
- Mix behavioral and technical questions appropriate for ${role} at ${experienceLevel} level
- Ask follow-up questions based on answers
- Be encouraging but professional
- After about 6-8 questions, wrap up the interview naturally
- When wrapping up, say "That concludes our interview" and provide brief feedback
- Keep responses concise (2-3 sentences max before asking the next question)`;

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 1024,
          system: systemPrompt,
          messages: [
            { role: "user", content: `Start the interview. I'm applying for the ${role} role at ${experienceLevel} level.` },
          ],
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error(`[MOCK-INTERVIEW] AI error ${response.status}:`, errText.slice(0, 300));
        if (response.status === 429) throw new Error("AI service is busy. Please try again.");
        throw new Error(`AI service error (${response.status}): ${errText.slice(0, 100)}`);
      }
      const aiResult = await response.json();
      const aiMessage = aiResult.content?.[0]?.text || "Let's begin the interview.";

      const conversation = [
        { role: "assistant", content: aiMessage, timestamp: new Date().toISOString() },
      ];

      const { data: session, error: insertErr } = await admin
        .from("interview_sessions")
        .insert({
          user_id: user.id,
          role,
          experience_level: experienceLevel,
          conversation_json: conversation,
        })
        .select("id")
        .single();

      if (insertErr) throw insertErr;

      return new Response(JSON.stringify({
        sessionId: session.id,
        message: aiMessage,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ACTION: respond
    if (action === "respond") {
      if (!sessionId || !messages) throw new Error("sessionId and messages required");

      const { data: session } = await admin
        .from("interview_sessions")
        .select("*")
        .eq("id", sessionId)
        .eq("user_id", user.id)
        .single();
      if (!session) throw new Error("Session not found");

      const systemPrompt = `You are a professional interviewer conducting a ${session.experience_level}-level interview for a ${session.role} position.

Rules:
- Ask one question at a time
- Mix behavioral and technical questions
- Ask follow-up questions based on answers
- Be encouraging but professional
- After about 6-8 questions total, wrap up by saying "That concludes our interview" and give brief feedback
- Keep responses concise`;

      const aiMessages = messages.map((m: any) => ({ role: m.role, content: m.content }));

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 1024,
          system: systemPrompt,
          messages: aiMessages,
        }),
      });

      if (!response.ok) {
        if (response.status === 429) throw new Error("AI service is busy. Please try again.");
        throw new Error("AI service error");
      }
      const aiResult = await response.json();
      const aiMessage = aiResult.content?.[0]?.text || "";

      const updatedConversation = [...messages, { role: "assistant", content: aiMessage, timestamp: new Date().toISOString() }];

      const isComplete = aiMessage.toLowerCase().includes("concludes our interview") || aiMessage.toLowerCase().includes("that wraps up");

      await admin.from("interview_sessions").update({
        conversation_json: updatedConversation,
        status: isComplete ? "completed" : "in_progress",
      }).eq("id", sessionId);

      return new Response(JSON.stringify({
        message: aiMessage,
        isComplete,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ACTION: score
    if (action === "score") {
      if (!sessionId) throw new Error("sessionId required");

      const { data: session } = await admin
        .from("interview_sessions")
        .select("*")
        .eq("id", sessionId)
        .eq("user_id", user.id)
        .single();
      if (!session) throw new Error("Session not found");

      const conversation = session.conversation_json as any[];
      const conversationText = conversation.map((m: any) => `${m.role}: ${m.content}`).join("\n");

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 2048,
          system: "You are an expert interview evaluator. Always respond with valid JSON only, no markdown, no explanation.",
          messages: [
            {
              role: "user",
              content: `Evaluate this interview and return ONLY a JSON object with these exact keys:
{
  "communication": <0-100>,
  "confidence": <0-100>,
  "technicalDepth": <0-100>,
  "clarity": <0-100>,
  "overallScore": <0-100>,
  "strengths": ["...", "..."],
  "weakAreas": ["...", "..."],
  "suggestions": ["...", "..."]
}

Interview transcript:
${conversationText}`,
            },
          ],
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error(`[MOCK-INTERVIEW] Scoring AI error ${response.status}:`, errText.slice(0, 300));
        throw new Error(`AI scoring failed (${response.status})`);
      }
      const aiResult = await response.json();
      const raw = aiResult.content?.[0]?.text;
      if (!raw) throw new Error("AI did not return scores");

      const scores = JSON.parse(raw.replace(/```json\n?|\n?```/g, "").trim());

      await admin.from("interview_sessions").update({
        scores_json: scores,
        status: "completed",
      }).eq("id", sessionId);

      return new Response(JSON.stringify({ scores }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    throw new Error("Invalid action");
  } catch (err: any) {
    console.error("[MOCK-INTERVIEW] error:", err.message, err.stack);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
