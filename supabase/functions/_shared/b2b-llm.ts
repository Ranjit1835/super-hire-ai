// ─── LLM client for B2B interview functions ───────────────────────────────────
// Same provider and key as the rest of HiResume (Gemini, OpenAI-compatible endpoint),
// plus what a lab of 60 concurrent students needs: per-call timeout, bounded retries
// with jitter, low reasoning effort for fast turns, and token usage returned to the
// caller for cost logging.
//
// Env: GEMINI_API_KEY (required), B2B_INTERVIEW_MODEL (default: HIRESUME_MODEL_FAST or
// gemini-3.6-flash), B2B_REASONING_EFFORT (default "low"; set "" to omit).

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai";
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

export interface LlmUsage {
  model: string;
  input_tokens: number;
  output_tokens: number;
  latency_ms: number;
  attempts: number;
}

export class LlmError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export function interviewModel(): string {
  return Deno.env.get("B2B_INTERVIEW_MODEL") || Deno.env.get("HIRESUME_MODEL_FAST") || "gemini-3.6-flash";
}

export function evaluatorModel(): string {
  return Deno.env.get("B2B_EVALUATOR_MODEL") || Deno.env.get("HIRESUME_MODEL_SMART") || interviewModel();
}

interface ToolDef { name: string; description: string; parameters: Record<string, unknown> }

export async function callTool(opts: {
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  tool: ToolDef;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  maxAttempts?: number;
  /** Overrides B2B_REASONING_EFFORT for this call ("" = omit). */
  reasoningEffort?: string;
}): Promise<{ args: Record<string, unknown>; usage: LlmUsage }> {
  const key = (Deno.env.get("GEMINI_API_KEY") || "").trim();
  if (!key) throw new LlmError("GEMINI_API_KEY not configured", 500);
  const model = opts.model || interviewModel();
  const effortEnv = Deno.env.get("B2B_REASONING_EFFORT");
  let reasoning: string | null = opts.reasoningEffort !== undefined
    ? opts.reasoningEffort || null
    : effortEnv === undefined ? "low" : effortEnv || null;
  const maxAttempts = opts.maxAttempts ?? 2;
  const started = Date.now();
  let lastStatus = 0;

  for (let attempt = 1; attempt <= maxAttempts + 1; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 20_000);
    let res: Response;
    try {
      res = await fetch(`${BASE_URL}/chat/completions`, {
        method: "POST",
        signal: ctrl.signal,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model,
          max_tokens: opts.maxTokens ?? 4096, // thinking tokens share this budget
          temperature: opts.temperature ?? 0.6,
          ...(reasoning ? { reasoning_effort: reasoning } : {}),
          messages: [{ role: "system", content: opts.system }, ...opts.messages],
          tools: [{ type: "function", function: opts.tool }],
          tool_choice: { type: "function", function: { name: opts.tool.name } },
        }),
      });
    } catch (e) {
      clearTimeout(timer);
      lastStatus = 504;
      console.error(`[b2b-llm] attempt ${attempt} network/timeout:`, (e as Error).name);
      if (attempt < maxAttempts) { await backoff(attempt); continue; }
      throw new LlmError("AI provider timed out", 504);
    }
    clearTimeout(timer);

    if (!res.ok) {
      lastStatus = res.status;
      const body = (await res.text()).slice(0, 300);
      // Some models reject reasoning_effort: retry once without it (doesn't count as an attempt).
      if (res.status === 400 && reasoning && /reasoning/i.test(body)) {
        console.warn("[b2b-llm] model rejected reasoning_effort; retrying without it");
        reasoning = null;
        attempt--;
        continue;
      }
      console.error(`[b2b-llm] attempt ${attempt} status ${res.status}:`, body);
      if (attempt < maxAttempts && RETRYABLE.has(res.status)) { await backoff(attempt); continue; }
      throw new LlmError(`AI provider error (${res.status})`, res.status);
    }

    const data = await res.json();
    const choice = data.choices?.[0];
    const call = choice?.message?.tool_calls?.find((c: { function?: { name?: string } }) => c?.function?.name === opts.tool.name)
      ?? choice?.message?.tool_calls?.[0];
    const usage: LlmUsage = {
      model,
      input_tokens: data.usage?.prompt_tokens ?? 0,
      output_tokens: data.usage?.completion_tokens ?? 0,
      latency_ms: Date.now() - started,
      attempts: attempt,
    };
    if (!call?.function?.arguments) {
      lastStatus = 502;
      console.error("[b2b-llm] no tool call; finish_reason:", choice?.finish_reason);
      if (attempt < maxAttempts) continue;
      throw new LlmError("AI returned no structured output", 502);
    }
    try {
      return { args: JSON.parse(call.function.arguments), usage };
    } catch {
      lastStatus = 502;
      if (attempt < maxAttempts) continue;
      throw new LlmError("AI returned invalid JSON", 502);
    }
  }
  throw new LlmError(`AI provider error (${lastStatus})`, lastStatus || 500);
}

function backoff(attempt: number): Promise<void> {
  // ~0.6s, ~1.2s + jitter: spreads a lab-wide burst instead of retrying in lockstep.
  const ms = 600 * 2 ** (attempt - 1) + Math.floor(Math.random() * 500);
  return new Promise((r) => setTimeout(r, ms));
}
