import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const FREE_MESSAGE_LIMIT = 3;

const PERSONA_INSTRUCTIONS: Record<string, string> = {
  "big-tech": `Optimize for Big Tech roles (FAANG/MANGA). Use metrics-heavy language emphasizing scale (millions of users, petabytes, 99.99% uptime). Highlight system design, distributed systems, and cross-functional leadership. Use keywords: impact, scale, ownership, bar-raising, customer obsession.`,
  "startup": `Optimize for startup roles. Use ownership language: "built from scratch", "wore multiple hats", "zero to one". Emphasize speed, resourcefulness, and direct business impact. Highlight revenue generation, user growth, and shipping velocity.`,
  "conservative": `Optimize for enterprise/consulting roles. Use formal, polished language. Emphasize process improvement, stakeholder management, and governance. Highlight certifications, compliance, and structured methodologies.`,
  "ai-ml": `Optimize for AI/ML engineering and research roles. Emphasize model architectures, training infrastructure, and benchmark improvements. Include publication-style language. Highlight frameworks (PyTorch, TensorFlow, JAX), model serving, and MLOps.`,
  "career-switcher": `Optimize for career transition. Bridge previous experience to target role using transferable skills. Reframe past accomplishments in terms relevant to the new field. Emphasize adaptability, learning velocity, and unique perspective.`,
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

    const { sessionId, userMessage, persona } = await req.json();
    if (!sessionId || !userMessage) throw new Error("sessionId and userMessage are required");

    // Verify session
    const { data: session, error: sessionErr } = await admin
      .from("studio_sessions")
      .select("id, user_id, resume_id, pass_type, expires_at, messages_used")
      .eq("id", sessionId)
      .single();

    if (sessionErr || !session) throw new Error("Session not found");
    if (session.user_id !== user.id) throw new Error("Unauthorized");
    if (new Date(session.expires_at) < new Date()) throw new Error("Session expired");

    // Check free tier message limit
    if (session.pass_type === "free" && session.messages_used >= FREE_MESSAGE_LIMIT) {
      return new Response(
        JSON.stringify({ error: "Free message limit reached", code: "LIMIT_REACHED" }),
        { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get resume data
    const { data: resume, error: resumeErr } = await admin
      .from("studio_resumes")
      .select("id, current_json, persona")
      .eq("id", session.resume_id)
      .single();

    if (resumeErr || !resume) throw new Error("Resume not found");

    const currentPersona = persona || resume.persona || "big-tech";

    // Update persona on resume if changed
    if (persona && persona !== resume.persona) {
      await admin
        .from("studio_resumes")
        .update({ persona, updated_at: new Date().toISOString() })
        .eq("id", resume.id);
    }

    // Get recent chat history (last 20 messages for context)
    const { data: history } = await admin
      .from("studio_messages")
      .select("role, content")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true })
      .limit(20);

    // Save user message
    const { data: userMsg, error: msgErr } = await admin
      .from("studio_messages")
      .insert({
        session_id: sessionId,
        role: "user",
        content: userMessage,
      })
      .select("id")
      .single();

    if (msgErr) {
      console.error("[STUDIO CHAT] Failed to save user message:", msgErr.message);
    }

    // Determine model based on pass_type
    const model = session.pass_type === "free" || session.pass_type === "single"
      ? "claude-haiku-4-5-20251001"
      : "claude-sonnet-4-6";

    // Build system prompt
    const personaInstructions = PERSONA_INSTRUCTIONS[currentPersona] || PERSONA_INSTRUCTIONS["big-tech"];
    const systemPrompt = buildSystemPrompt(personaInstructions, resume.current_json);

    // Build messages array
    const messages = [
      ...(history || []).map((m: any) => ({
        role: m.role === "system" ? "assistant" : m.role,
        content: m.content,
      })),
      { role: "user", content: userMessage },
    ];

    // Use Claude for all tiers — non-streaming JSON response for free, SSE for paid
    if (session.pass_type === "free") {
      return await handleClaudeJson(admin, session, resume, messages, systemPrompt, model, userMsg?.id, corsHeaders);
    } else {
      return await handleClaudeStream(admin, session, resume, messages, systemPrompt, model, userMsg?.id, corsHeaders);
    }
  } catch (err: any) {
    console.error("[STUDIO CHAT] Error:", err.message, err.stack?.slice(0, 300));
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function buildSystemPrompt(personaInstructions: string, resumeJson: any): string {
  return `You are Resume Studio AI — an expert resume coach with deep knowledge of:
- ATS systems (Workday, Greenhouse, Lever, Taleo, iCIMS)
- Recruiter psychology (6-second scan, what triggers callbacks)
- Industry-specific resume conventions (tech, finance, healthcare, etc.)
- Strong action verbs, quantification, and impact framing
- LinkedIn optimization and personal branding

Current persona guidelines: ${personaInstructions}

User's resume (JSON):
${JSON.stringify(resumeJson, null, 2)}

YOUR JOB:
When the user asks for changes, modify their resume by returning a JSON patch. Your response MUST contain a JSON block in this exact format:

\`\`\`json
{
  "explanation": "Brief explanation of what you changed and why from a recruiter's perspective",
  "changes": [
    { "path": "experience[0].bullets[1]", "old": "original text here", "new": "improved text here" }
  ],
  "follow_up_suggestions": ["suggestion 1", "suggestion 2"]
}
\`\`\`

Before the JSON block, write a natural conversational response explaining the changes.
After the JSON block, suggest 2-3 follow-up improvements.

If the user is just chatting or asking questions (not requesting changes), respond conversationally WITHOUT a JSON block.

RULES:
- Never lie about user's experience — only enhance phrasing
- Always preserve dates, company names, education facts
- Use strong action verbs (Led, Architected, Shipped, Reduced, Increased)
- Quantify everything possible (%, $, scale, time)
- Match keywords to the persona's target roles
- Keep bullets to 1-2 lines maximum
- Avoid clichés ("hardworking", "team player", "results-driven")
- When modifying bullets, always include the full "old" text so the change can be verified
- Path format: "experience[0].bullets[2]" or "summary" or "skills[1].items" or "projects[0].bullets[0]"`;
}

async function handleClaudeJson(
  admin: any,
  session: any,
  resume: any,
  messages: any[],
  systemPrompt: string,
  model: string,
  userMsgId: string | undefined,
  cors: Record<string, string>
) {
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
      model,
      max_tokens: 2048,
      system: systemPrompt,
      messages,
    }),
  });

  if (!aiResponse.ok) {
    const errText = await aiResponse.text();
    console.error("[STUDIO CHAT] Anthropic error:", aiResponse.status, errText);
    throw new Error(`AI service error: ${errText.slice(0, 150)}`);
  }

  const aiData = await aiResponse.json();
  const content = aiData.content?.[0]?.text || "";
  const tokensUsed = (aiData.usage?.input_tokens || 0) + (aiData.usage?.output_tokens || 0);

  // Parse changes if present
  const { changes, explanation } = parseChangesFromResponse(content);

  // Apply changes to resume
  let versionId: string | undefined;
  if (changes && changes.length > 0) {
    try {
      const result = await applyChangesAndSaveVersion(admin, resume, changes, explanation, userMsgId);
      versionId = result.versionId;
    } catch (e: any) {
      console.error("[STUDIO CHAT] Failed to apply changes:", e.message);
    }
  }

  // Save assistant message (non-blocking — don't fail the response)
  const { error: saveMsgErr } = await admin.from("studio_messages").insert({
    session_id: session.id,
    role: "assistant",
    content,
    changes_applied: changes,
    model_used: model,
    tokens_used: tokensUsed,
  });
  if (saveMsgErr) console.error("[STUDIO CHAT] Failed to save assistant msg:", saveMsgErr.message);

  // Increment messages_used
  await admin
    .from("studio_sessions")
    .update({ messages_used: session.messages_used + 1 })
    .eq("id", session.id);

  return new Response(
    JSON.stringify({
      content,
      changes,
      message_id: userMsgId,
      version_id: versionId,
      model_used: model,
      tokens_used: tokensUsed,
      messages_used: session.messages_used + 1,
    }),
    { headers: { ...cors, "Content-Type": "application/json" } }
  );
}

async function handleClaudeStream(
  admin: any,
  session: any,
  resume: any,
  messages: any[],
  systemPrompt: string,
  model: string,
  userMsgId: string | undefined,
  cors: Record<string, string>
) {
  const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
  if (!ANTHROPIC_API_KEY) throw new Error("Anthropic API key not configured");

  // Use prompt caching: system prompt + resume context is cached
  const anthropicMessages = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const requestBody = {
    model,
    max_tokens: 2048,
    stream: true,
    system: [
      {
        type: "text",
        text: systemPrompt,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: anthropicMessages,
  };

  const streamResponse = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "prompt-caching-2024-07-31",
    },
    body: JSON.stringify(requestBody),
  });

  if (!streamResponse.ok) {
    const errText = await streamResponse.text();
    console.error("[STUDIO CHAT] Anthropic stream error:", streamResponse.status, errText);
    throw new Error(`Anthropic API ${streamResponse.status}: ${errText.slice(0, 200)}`);
  }

  // Create a TransformStream to process and forward SSE
  const encoder = new TextEncoder();
  let fullContent = "";
  let inputTokens = 0;
  let outputTokens = 0;

  const readable = new ReadableStream({
    async start(controller) {
      try {
        const reader = streamResponse.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const data = line.slice(6).trim();
              if (data === "[DONE]") continue;

              try {
                const event = JSON.parse(data);

                if (event.type === "content_block_delta" && event.delta?.text) {
                  fullContent += event.delta.text;
                  // Forward text chunk to client
                  controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify({ type: "text", content: event.delta.text })}\n\n`)
                  );
                }

                if (event.type === "message_delta" && event.usage) {
                  outputTokens = event.usage.output_tokens || 0;
                }

                if (event.type === "message_start" && event.message?.usage) {
                  inputTokens = event.message.usage.input_tokens || 0;
                  // Check for cache hits
                  const cacheRead = event.message.usage.cache_read_input_tokens || 0;
                  if (cacheRead > 0) {
                    console.log(`[STUDIO CHAT] Prompt cache HIT: ${cacheRead} tokens cached`);
                  }
                }
              } catch {
                // Skip malformed events
              }
            }
          }
        }

        // Stream complete — parse changes from full content
        const { changes, explanation } = parseChangesFromResponse(fullContent);

        // Apply changes
        let versionId: string | undefined;
        if (changes && changes.length > 0) {
          const result = await applyChangesAndSaveVersion(admin, resume, changes, explanation, userMsgId);
          versionId = result.versionId;
        }

        // Send changes event
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              type: "changes",
              changes: changes || [],
              version_id: versionId,
            })}\n\n`
          )
        );

        // Save assistant message
        const tokensUsed = inputTokens + outputTokens;
        await admin.from("studio_messages").insert({
          session_id: session.id,
          role: "assistant",
          content: fullContent,
          changes_applied: changes,
          model_used: model,
          tokens_used: tokensUsed,
        });

        // Increment messages_used
        await admin
          .from("studio_sessions")
          .update({ messages_used: session.messages_used + 1 })
          .eq("id", session.id);

        // Send done event
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              type: "done",
              message_id: userMsgId,
              model_used: model,
              tokens_used: tokensUsed,
              messages_used: session.messages_used + 1,
            })}\n\n`
          )
        );

        console.log(`[STUDIO CHAT] user=${session.user_id} model=${model} tokens=${tokensUsed} changes=${changes?.length || 0}`);
        controller.close();
      } catch (err: any) {
        console.error("[STUDIO CHAT] Stream error:", err);
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "error", error: err.message })}\n\n`)
        );
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      ...cors,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

function parseChangesFromResponse(content: string): {
  changes: any[] | null;
  explanation: string;
} {
  try {
    // Look for JSON block in markdown code fence
    const jsonMatch = content.match(/```json\s*([\s\S]*?)```/);
    if (!jsonMatch) return { changes: null, explanation: "" };

    const parsed = JSON.parse(jsonMatch[1].trim());
    return {
      changes: Array.isArray(parsed.changes) ? parsed.changes : null,
      explanation: parsed.explanation || "",
    };
  } catch {
    return { changes: null, explanation: "" };
  }
}

async function applyChangesAndSaveVersion(
  admin: any,
  resume: any,
  changes: any[],
  explanation: string,
  triggeredByMessageId: string | undefined
): Promise<{ versionId: string }> {
  const currentJson = JSON.parse(JSON.stringify(resume.current_json));

  for (const change of changes) {
    try {
      applyChange(currentJson, change.path, change.new);
    } catch (e: any) {
      console.error(`[STUDIO CHAT] Failed to apply change at ${change.path}:`, e.message);
    }
  }

  // Update resume
  await admin
    .from("studio_resumes")
    .update({ current_json: currentJson, updated_at: new Date().toISOString() })
    .eq("id", resume.id);

  // Save version
  const summary = explanation || changes.map((c) => `Updated ${c.path}`).join(", ");
  const { data: version } = await admin
    .from("studio_versions")
    .insert({
      resume_id: resume.id,
      snapshot_json: currentJson,
      change_summary: summary.slice(0, 500),
      triggered_by_message_id: triggeredByMessageId || null,
    })
    .select("id")
    .single();

  // Trim to last 10 versions
  const { data: versions } = await admin
    .from("studio_versions")
    .select("id")
    .eq("resume_id", resume.id)
    .order("created_at", { ascending: false });

  if (versions && versions.length > 10) {
    const idsToDelete = versions.slice(10).map((v: any) => v.id);
    await admin.from("studio_versions").delete().in("id", idsToDelete);
  }

  return { versionId: version?.id };
}

function applyChange(obj: any, path: string, newValue: any) {
  // Parse path like "experience[0].bullets[1]" or "summary"
  const parts = path.match(/([^[\].]+)|\[(\d+)\]/g);
  if (!parts) return;

  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i].replace(/[\[\]]/g, "");
    const idx = parseInt(part);
    current = isNaN(idx) ? current[part] : current[idx];
    if (current === undefined || current === null) return;
  }

  const lastPart = parts[parts.length - 1].replace(/[\[\]]/g, "");
  const lastIdx = parseInt(lastPart);
  if (isNaN(lastIdx)) {
    current[lastPart] = newValue;
  } else {
    current[lastIdx] = newValue;
  }
}
