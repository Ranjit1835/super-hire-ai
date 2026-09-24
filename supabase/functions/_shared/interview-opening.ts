// Opening question for any B2B interview (student practice or public test).
import type { ModuleSpec } from "./module-spec.ts";
import { ASK_QUESTION_TOOL, buildOpeningMessage, buildSystemPrompt, cleanQuestion } from "./interview-prompts.ts";
import { callTool, type LlmUsage } from "./b2b-llm.ts";

export async function askOpeningQuestion(spec: ModuleSpec, firstName: string | null): Promise<{ question: string; usage: LlmUsage }> {
  const { args, usage } = await callTool({
    system: buildSystemPrompt(spec),
    messages: [{ role: "user", content: buildOpeningMessage(spec, firstName) }],
    tool: ASK_QUESTION_TOOL,
    timeoutMs: 20_000,
  });
  const question = cleanQuestion(String(args.question ?? ""));
  if (!question) throw new Error("empty opening");
  return { question, usage: { ...usage, purpose: "opening" } as LlmUsage };
}

export function firstNameOf(fullName: string | null | undefined): string | null {
  const n = (fullName ?? "").trim().split(/\s+/)[0];
  return n && n.length <= 40 ? n : null;
}
