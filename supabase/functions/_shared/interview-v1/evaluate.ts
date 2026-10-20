// ─── Run one V1 evaluation (dependencies injected; Deno wiring in ../evaluate-interview.ts) ─────────────
// claim (same claim/retry policy as the pilot) → load → blind transcript with timestamps → evaluator call(s)
// through the AI gateway (never cached) → verify quotes, band, double-score flags → save + dimension scores.
import type { GatewayRequest, GatewayResult } from "../ai-gateway/core.ts";
import { blindScrub } from "./blind.ts";
import {
  EVALUATOR_SCHEMA, EvaluatorOutput, V1_EVALUATOR_VERSION, buildEvaluatorSystem, buildEvaluatorUser,
  dimensionScoreRows, finalizeEvaluation, readinessFor, type EvalLine,
} from "./evaluation.ts";
import type { AnswerTurn } from "./quotes.ts";
import { answerSignals, type AnswerSignalNote, type AnswerTiming } from "./signals.ts";
import type { InterviewTemplate } from "./template.ts";

export interface EvalDeps {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<unknown>;
  ai: <T>(req: GatewayRequest<T>) => Promise<GatewayResult<T>>;
}

export type V1EvalOutcome =
  | { status: "completed"; evaluation_id: string }
  | { status: "pending"; evaluation_id: string }
  | { status: "failed"; evaluation_id: string; error: string }
  | { status: "skipped"; reason: string };

interface InputTurn { turn: number; role: "interviewer" | "student"; content: string; topic: string | null; meta: Record<string, unknown> | null; created_at: string }
interface EvalInput {
  id: string; org_id: string; user_id: string; started_at: string; template: InterviewTemplate;
  names: (string | null)[]; institutions: (string | null)[]; turns: InputTurn[];
  notes: { kind: string; turn: number | null; data: Record<string, unknown> }[];
}

const offset = (startedAt: string, at: string) => Math.max(0, (Date.parse(at) - Date.parse(startedAt)) / 1000);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

export async function evaluateV1(deps: EvalDeps, interviewId: string): Promise<V1EvalOutcome> {
  const claim = await deps.rpc("b2b_claim_evaluation", { _interview_id: interviewId, _version: V1_EVALUATOR_VERSION }) as
    { claimed: boolean; status?: string; evaluation_id?: string; reason?: string };
  if (!claim.claimed) {
    if (claim.reason) return { status: "skipped", reason: claim.reason };
    if (claim.status === "completed") return { status: "completed", evaluation_id: claim.evaluation_id! };
    if (claim.status === "failed") return { status: "failed", evaluation_id: claim.evaluation_id!, error: "retry_not_due" };
    return { status: "pending", evaluation_id: claim.evaluation_id! };
  }
  const evaluationId = claim.evaluation_id!;
  let attempts = 0;
  const save = (v: Record<string, unknown>) => deps.rpc("b2b_save_evaluation", {
    _evaluation_id: evaluationId, _model: "gateway:interview.v1.evaluate", _audio_metrics: null, _llm_usage: [], ...v,
  });

  try {
    const input = await deps.rpc("b2b_iv_eval_input", { _interview_id: interviewId }) as EvalInput;
    const t = input.template;
    const ctx = { names: input.names, institutions: input.institutions };
    const lines: EvalLine[] = input.turns.map((x) => ({
      turn: x.turn, role: x.role === "student" ? "candidate" : "interviewer", text: blindScrub(x.content, ctx),
      offsetS: Math.round(offset(input.started_at, x.created_at)), section: x.topic,
    }));
    const answers: AnswerTurn[] = lines.filter((l) => l.role === "candidate").map((l) => ({ turn: l.turn, text: l.text, offsetS: l.offsetS }));

    // Signals: per-turn ones were stored with each answer; flat cadence needs the whole interview.
    const timings: AnswerTiming[] = input.turns.filter((x) => x.role === "student").map((x) => ({
      turn: x.turn, words: x.content.trim().split(/\s+/).filter(Boolean).length,
      response_latency_ms: num(x.meta?.response_latency_ms), speech_ms: num(x.meta?.speech_ms), max_pause_ms: num(x.meta?.max_pause_ms),
    }));
    const signals: AnswerSignalNote[] = answerSignals(timings);
    const integrity = input.notes.filter((n) => n.kind === "integrity")
      .map((n) => ({ turn: n.turn, patterns: Array.isArray(n.data.patterns) ? (n.data.patterns as string[]) : [String(n.data.type ?? "event")] }));

    const system = buildEvaluatorSystem(t);
    const user = buildEvaluatorUser(t, lines);
    const runs: EvaluatorOutput[] = [];
    for (let i = 0; i < (t.doubleScore ? 2 : 1); i++) {
      attempts++;
      const r = await deps.ai({
        feature: "interview.v1.evaluate", orgId: input.org_id, userId: input.user_id, interviewId,
        purpose: i === 0 ? "evaluation" : "evaluation_second_run",
        system, messages: [{ role: "user", content: user }], cacheInput: { interviewId, run: i },
        jsonSchema: EVALUATOR_SCHEMA, schemaName: "submit_evaluation", parse: EvaluatorOutput.safeParse,
      });
      if (!r.ok) throw new Error(`${r.code}: ${r.message}`.slice(0, 400));
      runs.push(r.data);
    }

    const result = finalizeEvaluation({ runs, template: t, answers, signals, integrity });
    await save({
      _status: "completed", _result: result, _overall: result.overall_score, _readiness: readinessFor(result.recommendation),
      _primary_gap: result.gaps[0] ?? null, _attempts: attempts, _error: null,
    });
    await deps.rpc("b2b_iv_save_scores", { _interview_id: interviewId, _rows: dimensionScoreRows(result) });
    return { status: "completed", evaluation_id: evaluationId };
  } catch (e) {
    const msg = (e as Error).message.slice(0, 500);
    await save({ _status: "failed", _result: null, _overall: null, _readiness: null, _primary_gap: null, _attempts: attempts, _error: msg })
      .catch(() => undefined);
    return { status: "failed", evaluation_id: evaluationId, error: msg };
  }
}
