// ─── Run one evaluation (Deno; used by b2b-evaluate and b2b-interview) ────────
// claim → load transcript → audio metrics → evaluator call → validate/ground →
// one retry with the validation errors → save. Safe to call concurrently: the claim
// row makes the second caller return "pending" instead of paying for a second call.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { ModuleSpec } from "./module-spec.ts";
import { computeAudioMetrics, type StudentTurnInput } from "./audio-metrics.ts";
import {
  EVALUATOR_PROMPT_VERSION, buildEvaluatorMessage, buildEvaluatorSystemPrompt, evaluatorTool,
  retryMessage, validateEvaluation, type TranscriptEntry,
} from "./evaluator.ts";
import { callTool, evaluatorModel, type LlmUsage } from "./b2b-llm.ts";

export type EvaluationOutcome =
  | { status: "completed"; evaluation_id: string }
  | { status: "pending"; evaluation_id: string }
  | { status: "failed"; evaluation_id: string; error: string }
  | { status: "skipped"; reason: string };

interface TurnRow {
  turn_index: number; role: "interviewer" | "student"; content: string;
  topic: string | null; difficulty: StudentTurnInput["difficulty"]; meta: StudentTurnInput["meta"];
}

export async function evaluateInterview(admin: SupabaseClient, interviewId: string): Promise<EvaluationOutcome> {
  const { data: claim, error: claimErr } = await admin.rpc("b2b_claim_evaluation", {
    _interview_id: interviewId, _version: EVALUATOR_PROMPT_VERSION,
  });
  if (claimErr) throw claimErr;
  const c = claim as { claimed: boolean; status?: string; evaluation_id?: string; reason?: string };
  if (!c.claimed) {
    if (c.reason) return { status: "skipped", reason: c.reason };
    return { status: c.status === "completed" ? "completed" : "pending", evaluation_id: c.evaluation_id! };
  }
  const evaluationId = c.evaluation_id!;
  const usage: LlmUsage[] = [];
  let attempts = 0;
  const model = evaluatorModel();

  try {
    const { data: iv, error: ivErr } = await admin
      .from("b2b_interviews").select("module_spec, end_reason").eq("id", interviewId).single();
    if (ivErr) throw ivErr;
    const { data: turnsData, error: tErr } = await admin
      .from("b2b_interview_turns").select("turn_index, role, content, topic, difficulty, meta")
      .eq("interview_id", interviewId).order("turn_index");
    if (tErr) throw tErr;

    const spec = iv.module_spec as ModuleSpec;
    const turns = (turnsData as TurnRow[]).sort((a, b) => a.turn_index - b.turn_index || (a.role === "interviewer" ? -1 : 1));
    const student = turns.filter((t) => t.role === "student");
    const metrics = computeAudioMetrics(student.map((t) => ({ content: t.content, difficulty: t.difficulty, meta: t.meta })));
    const transcript: TranscriptEntry[] = turns.map((t) => ({ turn: t.turn_index, role: t.role, content: t.content, topic: t.topic }));

    const system = buildEvaluatorSystemPrompt();
    const messages: Array<{ role: "user" | "assistant"; content: string }> = [
      { role: "user", content: buildEvaluatorMessage(spec, transcript, metrics, iv.end_reason) },
    ];
    const tool = evaluatorTool(spec.topics);

    let lastErrors: string[] = [];
    for (let i = 0; i < 2; i++) { // first try + one retry on schema failure
      attempts++;
      const { args, usage: u } = await callTool({
        system, messages, tool, model, maxTokens: 12_000, temperature: 0.2, timeoutMs: 60_000, reasoningEffort: "medium",
      });
      usage.push(u);
      const { result, errors } = validateEvaluation(args, spec, student.map((t) => t.content));
      if (result) {
        await save(admin, evaluationId, {
          status: "completed", model, result, metrics, overall: result.overall_score,
          readiness: result.readiness_level, gap: result.primary_gap, attempts, usage, error: null,
        });
        return { status: "completed", evaluation_id: evaluationId };
      }
      lastErrors = errors;
      console.warn(`[evaluate] schema errors (attempt ${i + 1}):`, errors.slice(0, 5));
      messages.push({ role: "assistant", content: JSON.stringify(args).slice(0, 8000) });
      messages.push({ role: "user", content: retryMessage(errors) });
    }
    throw new Error(`Invalid evaluator output: ${lastErrors.slice(0, 5).join("; ")}`);
  } catch (e) {
    const msg = (e as Error).message.slice(0, 500);
    console.error(`[evaluate] interview=${interviewId} failed:`, msg);
    await save(admin, evaluationId, {
      status: "failed", model, result: null, metrics: null, overall: null, readiness: null, gap: null, attempts, usage, error: msg,
    });
    return { status: "failed", evaluation_id: evaluationId, error: msg };
  }
}

async function save(admin: SupabaseClient, id: string, v: {
  status: string; model: string; result: unknown; metrics: unknown; overall: number | null; readiness: string | null;
  gap: string | null; attempts: number; usage: LlmUsage[]; error: string | null;
}) {
  const { error } = await admin.rpc("b2b_save_evaluation", {
    _evaluation_id: id, _status: v.status, _model: v.model, _result: v.result, _audio_metrics: v.metrics,
    _overall: v.overall, _readiness: v.readiness, _primary_gap: v.gap, _attempts: v.attempts,
    _llm_usage: v.usage.map((u) => ({ ...u, purpose: "evaluation" })), _error: v.error,
  });
  if (error) console.error("[evaluate] save failed:", error.message);
}

/** Start an evaluation in the background of the current request (Supabase EdgeRuntime). */
export function evaluateInBackground(admin: SupabaseClient, interviewId: string) {
  const p = evaluateInterview(admin, interviewId).catch((e) => console.error("[evaluate] background:", (e as Error).message));
  const rt = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(p);
}
