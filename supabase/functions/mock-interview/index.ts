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

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("AI service not configured");

    // ACTION: check-access
    if (action === "check-access") {
      const { data: profile } = await admin
        .from("profiles")
        .select("early_bird_active, early_bird_expiry_date, monthly_interview_count, last_interview_reset_date")
        .eq("user_id", user.id)
        .single();

      const isEarlyBird = profile?.early_bird_active && profile?.early_bird_expiry_date && new Date(profile.early_bird_expiry_date) > new Date();

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

      const canAccess = isEarlyBird && monthlyCount < 2;
      return new Response(JSON.stringify({
        canAccess,
        isEarlyBird: !!isEarlyBird,
        monthlyCount,
        monthlyLimit: 2,
        reason: canAccess ? "EARLY_BIRD_ACCESS" : isEarlyBird ? "LIMIT_REACHED" : "PAYMENT_REQUIRED",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ACTION: start
    if (action === "start") {
      if (!role || !experienceLevel) throw new Error("role and experienceLevel required");

      // Increment monthly count
      const { data: profile } = await admin
        .from("profiles")
        .select("monthly_interview_count")
        .eq("user_id", user.id)
        .single();
      await admin.from("profiles").update({
        monthly_interview_count: (profile?.monthly_interview_count || 0) + 1,
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

      const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: `Start the interview. I'm applying for the ${role} role at ${experienceLevel} level.` },
          ],
        }),
      });

      if (!response.ok) {
        if (response.status === 429) throw new Error("AI service is busy. Please try again.");
        if (response.status === 402) throw new Error("AI credits exhausted.");
        throw new Error("AI service error");
      }
      const aiResult = await response.json();
      const aiMessage = aiResult.choices?.[0]?.message?.content || "Let's begin the interview.";

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

      const aiMessages = [
        { role: "system", content: systemPrompt },
        ...messages.map((m: any) => ({ role: m.role, content: m.content })),
      ];

      const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: aiMessages,
        }),
      });

      if (!response.ok) {
        if (response.status === 429) throw new Error("AI service is busy. Please try again.");
        throw new Error("AI service error");
      }
      const aiResult = await response.json();
      const aiMessage = aiResult.choices?.[0]?.message?.content || "";

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

      const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: [
            { role: "system", content: "You are an expert interview evaluator." },
            { role: "user", content: `Evaluate this interview conversation and return scores:\n\n${conversationText}` },
          ],
          tools: [{
            type: "function",
            function: {
              name: "return_scores",
              description: "Return interview evaluation scores",
              parameters: {
                type: "object",
                properties: {
                  communication: { type: "number", description: "Communication score 0-100" },
                  confidence: { type: "number", description: "Confidence score 0-100" },
                  technicalDepth: { type: "number", description: "Technical depth score 0-100" },
                  clarity: { type: "number", description: "Clarity score 0-100" },
                  overallScore: { type: "number", description: "Overall score 0-100" },
                  strengths: { type: "array", items: { type: "string" } },
                  weakAreas: { type: "array", items: { type: "string" } },
                  suggestions: { type: "array", items: { type: "string" } },
                },
                required: ["communication", "confidence", "technicalDepth", "clarity", "overallScore", "strengths", "weakAreas", "suggestions"],
              },
            },
          }],
          tool_choice: { type: "function", function: { name: "return_scores" } },
        }),
      });

      if (!response.ok) throw new Error("AI scoring failed");
      const aiResult = await response.json();
      const toolCall = aiResult.choices?.[0]?.message?.tool_calls?.[0];
      if (!toolCall) throw new Error("AI did not return scores");

      const scores = JSON.parse(toolCall.function.arguments);

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
    console.error("mock-interview error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
