// Gemini provider for the AI gateway (OpenAI-compatible endpoint, forced tool call for structured output).
// Implicit context caching is automatic on Gemini 2.5+ models; the gateway keeps static prompt text
// first so it caches, and reads the cached-token count back for the cost log.
import type { Provider, ProviderRequest, ProviderResult } from "./core.ts";

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai";
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

export function geminiProvider(apiKey: () => string): Provider {
  return {
    async complete(req: ProviderRequest): Promise<ProviderResult> {
      const body: Record<string, unknown> = {
        model: req.model,
        max_tokens: req.maxTokens,
        messages: [{ role: "system", content: req.system }, ...req.messages],
        tools: [{ type: "function", function: { name: req.schemaName, description: req.schemaName, parameters: req.schema } }],
        tool_choice: { type: "function", function: { name: req.schemaName } },
      };
      if (req.temperature !== undefined) body.temperature = req.temperature;
      if (req.reasoningEffort) body.reasoning_effort = req.reasoningEffort;

      let lastStatus = 0;
      for (let attempt = 1; attempt <= 3; attempt++) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), req.timeoutMs);
        let res: Response;
        try {
          res = await fetch(`${BASE_URL}/chat/completions`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey()}` },
            body: JSON.stringify(body),
            signal: ctrl.signal,
          });
        } catch (e) {
          clearTimeout(timer);
          if (attempt < 3) { await new Promise((r) => setTimeout(r, 600 * attempt)); continue; }
          throw new Error(`Gemini request failed: ${(e as Error).message}`);
        }
        clearTimeout(timer);
        if (res.ok) {
          const data = await res.json();
          const choice = data.choices?.[0];
          if (choice?.finish_reason === "length") throw new Error("Gemini output truncated (max_tokens)");
          const args = choice?.message?.tool_calls?.[0]?.function?.arguments;
          if (!args) throw new Error("Gemini returned no structured output");
          let output: unknown;
          try { output = JSON.parse(args); } catch { throw new Error("Gemini returned invalid JSON"); }
          return {
            output,
            inputTokens: data.usage?.prompt_tokens ?? 0,
            cachedInputTokens: data.usage?.prompt_tokens_details?.cached_tokens ?? 0,
            outputTokens: data.usage?.completion_tokens ?? 0,
          };
        }
        lastStatus = res.status;
        const text = await res.text();
        if (res.status === 400 && body.reasoning_effort && /reasoning/i.test(text)) { delete body.reasoning_effort; attempt--; continue; }
        if (attempt < 3 && RETRYABLE.has(res.status)) {
          await new Promise((r) => setTimeout(r, 800 * 2 ** (attempt - 1) + Math.random() * 400));
          continue;
        }
        throw new Error(`Gemini error ${res.status}: ${text.slice(0, 200)}`);
      }
      throw new Error(`Gemini error ${lastStatus}`);
    },
  };
}
