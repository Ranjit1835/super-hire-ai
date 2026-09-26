// ─── Shared AI provider layer ────────────────────────────────────────────────
// All HiResume edge functions call the LLM through this module so the provider is
// a one-file change, not a per-function rewrite. Currently targets Google Gemini
// via its OpenAI-compatible endpoint (Anthropic billing is dead — migrated 2026-09).
//
// Model IDs are env-overridable so a future model swap is a secret change, not a
// code change. Defaults are pinned to a model verified working (gemini-3.6-flash).
// NOTE: gemini-3.6-flash is a *thinking* model — reasoning shares the output token
// budget, so max_tokens must be generous or the answer/tool-JSON gets truncated.

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai";

// gemini-3.6-flash handles both tiers well; keep FAST/SMART split so a stronger
// model can be slotted into the paid tier later via a secret, with no code change.
export const MODEL_FAST = Deno.env.get("HIRESUME_MODEL_FAST") || "gemini-3.6-flash";
export const MODEL_SMART = Deno.env.get("HIRESUME_MODEL_SMART") || "gemini-3.6-flash";

export class AiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "AiError";
    this.status = status;
  }
}

export function isRateLimit(e: unknown): boolean {
  return e instanceof AiError && e.status === 429;
}

function apiKey(): string {
  const k = (Deno.env.get("GEMINI_API_KEY") || "").trim();
  if (!k) throw new Error("Gemini API key not configured");
  return k;
}

export interface ChatMessage {
  role: string; // "system" | "user" | "assistant"
  content: string;
}

function buildMessages(system: string | undefined, messages: ChatMessage[]): ChatMessage[] {
  return system ? [{ role: "system", content: system }, ...messages] : messages;
}

// Gemini's free tier intermittently returns 503 ("high demand") and 429 under
// load — transient. Retry these a few times with exponential backoff so a spike
// doesn't surface as a user-visible failure.
const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;

async function post(body: Record<string, unknown>, _stream = false): Promise<Response> {
  let lastStatus = 0;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey()}`,
      },
      body: JSON.stringify(body),
    });
    if (res.ok) return res;

    lastStatus = res.status;
    const text = await res.text();
    // Some models reject reasoning_effort: retry once without it (doesn't count as an attempt).
    if (res.status === 400 && body.reasoning_effort && /reasoning/i.test(text)) {
      console.warn("AI model rejected reasoning_effort; retrying without it");
      delete body.reasoning_effort;
      attempt--;
      continue;
    }
    console.error(`AI upstream error (attempt ${attempt}/${MAX_ATTEMPTS}):`, res.status, text.slice(0, 300));

    if (attempt < MAX_ATTEMPTS && RETRYABLE.has(res.status)) {
      const delay = 800 * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 400); // ~1s, ~2s
      await new Promise((r) => setTimeout(r, delay));
      continue;
    }
    break;
  }
  if (lastStatus === 429) throw new AiError("Rate limit exceeded. Please try again later.", 429);
  throw new AiError(`AI provider error (${lastStatus})`, lastStatus);
}

// ─── Forced tool call → returns the parsed arguments object ───────────────────
export async function aiToolCall(opts: {
  system?: string;
  messages: ChatMessage[];
  toolName: string;
  toolDescription?: string;
  parameters: Record<string, unknown>;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  /** Thinking budget for thinking models ("low" is much faster); omitted = provider default. */
  reasoningEffort?: "none" | "low" | "medium" | "high";
}): Promise<Record<string, unknown>> {
  const res = await post({
    model: opts.model || MODEL_FAST,
    max_tokens: opts.maxTokens ?? 24000,
    ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
    ...(opts.reasoningEffort ? { reasoning_effort: opts.reasoningEffort } : {}),
    messages: buildMessages(opts.system, opts.messages),
    tools: [{
      type: "function",
      function: {
        name: opts.toolName,
        description: opts.toolDescription || opts.toolName,
        parameters: opts.parameters,
      },
    }],
    tool_choice: { type: "function", function: { name: opts.toolName } },
  });

  const data = await res.json();
  if (data.usage) console.log("Token usage:", JSON.stringify(data.usage));

  const choice = data.choices?.[0];
  if (choice?.finish_reason === "length") {
    console.error("AI error: tool response truncated (finish_reason=length)");
    throw new AiError("AI response was truncated", 502);
  }

  const toolCall = choice?.message?.tool_calls?.find(
    (c: any) => c?.function?.name === opts.toolName,
  ) ?? choice?.message?.tool_calls?.[0];
  if (!toolCall?.function?.arguments) throw new AiError("AI did not return structured output", 502);

  try {
    return JSON.parse(toolCall.function.arguments);
  } catch {
    throw new AiError("Invalid AI response format", 502);
  }
}

// ─── Plain text / JSON-in-text completion → returns the text + token usage ─────
export async function aiText(opts: {
  system?: string;
  messages: ChatMessage[];
  model?: string;
  maxTokens?: number;
  temperature?: number;
}): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const res = await post({
    model: opts.model || MODEL_FAST,
    // Generous default: thinking tokens share the budget, small caps truncate answers.
    max_tokens: opts.maxTokens ?? 8192,
    ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
    messages: buildMessages(opts.system, opts.messages),
  });

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || "";
  return {
    text,
    inputTokens: data.usage?.prompt_tokens ?? 0,
    outputTokens: data.usage?.completion_tokens ?? 0,
  };
}

// ─── Streaming → returns the raw OpenAI-compatible SSE Response ────────────────
// Caller owns re-emitting to its own client SSE contract. Each upstream chunk is
//   data: {"choices":[{"delta":{"content":"..."}}], "usage": {...}? }
// terminated by  data: [DONE]
export async function aiStream(opts: {
  system?: string;
  messages: ChatMessage[];
  model?: string;
  maxTokens?: number;
  temperature?: number;
}): Promise<Response> {
  return await post({
    model: opts.model || MODEL_FAST,
    max_tokens: opts.maxTokens ?? 8192,
    ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
    messages: buildMessages(opts.system, opts.messages),
    stream: true,
    stream_options: { include_usage: true },
  }, true);
}
