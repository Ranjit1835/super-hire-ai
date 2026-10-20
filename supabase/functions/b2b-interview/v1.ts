// b2b-interview V1 actions (contract: _shared/contracts/interview.ts) with the database, the AI gateway and the
// network injected, so they run in Node tests against PGlite with a fake ai() (supabase/tests/rls/interview-v1-handlers.test.ts).
// Authorization lives in the SQL functions (docs/b2b/tracks/c-interview.sql): every call passes the actor.
import type { GatewayRequest, GatewayResult } from "../_shared/ai-gateway/core.ts";
import type { RoomState } from "../_shared/contracts/interview.ts";
import { sanitizeAnswerMeta } from "../_shared/interview-meta.ts";
import { buildTemplate, compatModuleSpec, SECTION_LABEL, type InterviewTemplate, type WalkthroughSource } from "../_shared/interview-v1/template.ts";
import { applyV1, initV1State, isV1State, planV1, type V1Proposal, type V1State } from "../_shared/interview-v1/engine.ts";
import {
  ASK_QUESTION_SCHEMA, AskQuestionOutput, NEXT_TURN_SCHEMA, NextTurnOutput, V1_CLOSING_LINE, V1_PROMPT_VERSION,
  buildV1OpeningMessage, buildV1RegenerateMessage, buildV1SystemPrompt, buildV1TurnMessage, cleanV1Question,
  fallbackV1Opening, fallbackV1Question, type TranscriptLine,
} from "../_shared/interview-v1/prompts.ts";
import { detectInjection } from "../_shared/interview-v1/injection.ts";
import { turnSignals } from "../_shared/interview-v1/signals.ts";
import { latencyStats } from "../_shared/interview-v1/stats.ts";
import { mmss } from "../_shared/interview-v1/quotes.ts";
import { V1_DIMENSION_LABEL, type V1Dimension } from "../_shared/interview-v1/evaluation.ts";

export class V1Error extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export interface V1Deps {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<unknown>;
  ai: <T>(req: GatewayRequest<T>) => Promise<GatewayResult<T>>;
  /** Start the evaluation without blocking the response (EdgeRuntime.waitUntil in Deno). */
  evaluateLater: (interviewId: string) => void;
  env: (key: string) => string | undefined;
  fetch: typeof fetch;
  now?: () => number;
}

type Json = Record<string, unknown>;

const REASONS: Record<string, [number, string]> = {
  NOT_FOUND: [404, "Interview not found."],
  NOT_ELIGIBLE: [403, "This interview isn't assigned to you."],
  NO_INTERVIEW: [409, "This drive has no AI interview set up."],
  NOT_OPEN: [403, "This interview isn't open."],
  NOT_OPEN_YET: [403, "This interview hasn't opened yet. Please come back at the start time."],
  WINDOW_CLOSED: [403, "The time window for this interview has closed."],
  INVITE_EXPIRED: [403, "Your invitation has expired. Please ask the recruiter for a new link."],
  ORG_SUSPENDED: [403, "This organisation's account is paused."],
  BAD_CONTEXT: [400, "Unknown interview type."],
  BAD_ATTEMPT: [400, "That coding attempt isn't yours or isn't part of this interview."],
  OTHER_IN_PROGRESS: [409, "You have another interview in progress. Finish or end it first."],
  NOT_IN_PROGRESS: [409, "This interview has already finished."],
  TURN_CONFLICT: [409, "Out of sync. Showing the latest question."],
};

export function refuse(reason: string | undefined): never {
  const [status, msg] = REASONS[reason ?? ""] ?? [400, "Request refused."];
  throw new V1Error(status, reason ?? "REFUSED", msg);
}

interface LoadedTurn { turn: number; role: "interviewer" | "student"; content: string; topic: string | null; created_at: string; client_turn_id: string | null }
interface Loaded {
  ok: boolean; reason?: string; id: string; org_id: string; kind: "drive" | "job_role"; context_id: string; status: RoomState["status"];
  end_reason: string | null; started_at: string; deadline_at: string; server_now: string; state: V1State; template: InterviewTemplate;
  policy: RoomState["policy"]; first_name: string | null; results_visible: boolean;
  result: { overall_score: number | null; recommendation: string | null; dimensions: { key: V1Dimension; score: number | null }[] | null } | null;
  turns: LoadedTurn[];
}

export function makeV1Handlers(deps: V1Deps) {
  const now = deps.now ?? Date.now;
  const rpc = async <T>(fn: string, args: Json) => (await deps.rpc(fn, args)) as T;

  async function load(actor: string, interviewId: string): Promise<Loaded> {
    const r = await rpc<Loaded>("b2b_iv_load", { _actor: actor, _interview_id: interviewId });
    if (!r.ok) refuse(r.reason);
    return r;
  }

  function toRoom(iv: Loaded, extra: Partial<RoomState> = {}): RoomState {
    const t = iv.template;
    const started = Date.parse(iv.started_at);
    const transcript = iv.turns.map((x) => {
      const offsetS = Math.max(0, Math.round((Date.parse(x.created_at) - started) / 1000));
      return { turn: x.turn, role: x.role === "student" ? "candidate" as const : "interviewer" as const, text: x.content, offsetS, at: mmss(offsetS) };
    });
    const answered = iv.turns.filter((x) => x.role === "student").length;
    const lastQ = [...iv.turns].reverse().find((x) => x.role === "interviewer");
    const live = iv.status === "in_progress";
    const sec = isV1State(iv.state) ? t.sections[Math.min(iv.state.v1.section_index, t.sections.length - 1)]?.key ?? null : null;
    return {
      interviewId: iv.id, context: iv.kind, contextId: iv.context_id, title: t.title, status: iv.status, endReason: iv.end_reason,
      policy: iv.policy, startedAt: new Date(iv.started_at).toISOString(), deadlineAt: new Date(iv.deadline_at).toISOString(),
      serverNow: new Date(now()).toISOString(), durationMin: t.durationMin,
      sections: t.sections.map((s) => ({ key: s.key, label: SECTION_LABEL[s.key], minutes: Math.round(s.seconds / 6) / 10 })),
      section: live ? sec : null,
      turnCount: answered,
      question: live && lastQ && lastQ.turn === answered + 1 ? lastQ.content : null,
      closing: !live && lastQ && lastQ.turn > answered ? lastQ.content : null,
      transcript, codeWalkthrough: !!t.walkthrough, resultsVisible: !!iv.results_visible,
      result: iv.results_visible && iv.result ? {
        recommendation: (iv.result.recommendation as NonNullable<RoomState["result"]>["recommendation"]) ?? null,
        overall: iv.result.overall_score === null ? null : Number(iv.result.overall_score),
        dimensions: (iv.result.dimensions ?? []).map((d) => ({ label: V1_DIMENSION_LABEL[d.key] ?? String(d.key), score: d.score })),
      } : null,
      ...extra,
    };
  }

  async function opening(actor: string, iv: Loaded): Promise<void> {
    const t = iv.template;
    let question = "";
    let fallback = false;
    const r = await deps.ai({
      feature: "interview.v1.turn", orgId: iv.org_id, userId: actor, interviewId: iv.id, purpose: "opening",
      system: buildV1SystemPrompt(t), messages: [{ role: "user", content: buildV1OpeningMessage(t, iv.first_name) }],
      cacheInput: null, jsonSchema: ASK_QUESTION_SCHEMA, schemaName: "ask_question", parse: AskQuestionOutput.safeParse,
    });
    if (r.ok) question = cleanV1Question(r.data.question);
    if (!question) { question = fallbackV1Opening(t, iv.first_name); fallback = true; }
    await rpc("b2b_iv_record_opening", {
      _actor: actor, _interview_id: iv.id, _question: question,
      _meta: { prompt_version: V1_PROMPT_VERSION, fallback, section: "intro" }, _state: iv.state,
    });
  }

  /** Close an interview whose time ran out while the candidate was away. */
  async function closeIfExpired(actor: string, iv: Loaded): Promise<Loaded> {
    if (iv.status !== "in_progress" || now() < Date.parse(iv.deadline_at)) return iv;
    const r = await rpc<{ status?: string }>("b2b_iv_finish", { _actor: actor, _interview_id: iv.id, _reason: "time_limit" });
    if (r.status === "completed") deps.evaluateLater(iv.id);
    return load(actor, iv.id);
  }

  return {
    async startContext(input: { kind: "drive" | "job_role"; contextId: string; attemptId?: string }, actor: string) {
      const ctx = await rpc<Json & { ok: boolean; reason?: string }>("b2b_iv_context", {
        _actor: actor, _context: input.kind, _context_id: input.contextId, _attempt_id: input.attemptId ?? null,
      });
      if (!ctx.ok) refuse(ctx.reason);
      let interviewId: string;
      let resumed: boolean;
      const existing = ctx.existing as { interview_id: string } | null;
      if (existing) {
        interviewId = existing.interview_id;
        resumed = true;
      } else {
        const walk = ctx.walkthrough as (WalkthroughSource & { questionTitle: string | null }) | null;
        const role = ctx.job_role as { skills_matrix?: unknown; seniority?: string | null; code_walkthrough?: boolean; interview_config?: unknown } | null;
        const t = buildTemplate({
          context: input.kind, title: String(ctx.title ?? ""),
          moduleSpec: (ctx.module as { spec?: Json } | null)?.spec ?? null,
          skillsMatrix: role?.skills_matrix, seniority: role?.seniority ?? null,
          config: role?.interview_config && typeof role.interview_config === "object" ? role.interview_config as Json : null,
          codeWalkthroughEnabled: role?.code_walkthrough, walkthrough: walk && walk.questionTitle && walk.code ? walk : null,
        });
        const moduleId = (ctx.module as { id?: string } | null)?.id ?? null;
        const created = await rpc<{ ok: boolean; reason?: string; interview_id: string; resumed: boolean }>("b2b_iv_create", {
          _actor: actor, _context: input.kind, _context_id: input.contextId, _attempt_id: input.attemptId ?? null,
          _template: t, _module_spec: compatModuleSpec(t), _state: initV1State(t, moduleId), _prompt_version: V1_PROMPT_VERSION,
          _client_meta: {},
        });
        if (!created.ok) refuse(created.reason);
        interviewId = created.interview_id;
        resumed = created.resumed;
      }
      const iv = await load(actor, interviewId);
      if (iv.status === "in_progress" && iv.turns.length === 0) await opening(actor, iv);
      return { interviewId, resumed };
    },

    async room(input: { interviewId: string }, actor: string): Promise<RoomState> {
      return toRoom(await closeIfExpired(actor, await load(actor, input.interviewId)));
    },

    async turn(input: {
      interviewId: string; clientTurnId: string; turnCount: number; answer: string; meta: Json;
      clientLatency?: { turn_end_to_first_audio_ms: number } | null;
    }, actor: string): Promise<RoomState> {
      let iv = await load(actor, input.interviewId);
      if (iv.turns.some((x) => x.client_turn_id === input.clientTurnId)) return toRoom(iv, { duplicate: true });
      iv = await closeIfExpired(actor, iv);
      if (iv.status !== "in_progress") refuse("NOT_IN_PROGRESS");
      const state = iv.state;
      if (!isV1State(state)) throw new Error(`interview ${iv.id} has no V1 state`);
      if (state.turn_count !== input.turnCount) refuse("TURN_CONFLICT");

      const t = iv.template;
      const answer = input.answer.slice(0, 4000);
      const elapsed = Math.max(0, (now() - Date.parse(iv.started_at)) / 1000);
      const plan = planV1(state, t, elapsed);
      const injection = detectInjection(answer);
      const meta = sanitizeAnswerMeta({ ...input.meta, input_mode: "voice" }, answer);
      const signals = turnSignals({ turn: state.turn_count + 1, words: meta.words, response_latency_ms: meta.response_latency_ms, speech_ms: meta.speech_ms, max_pause_ms: meta.max_pause_ms });
      const recent: TranscriptLine[] = iv.turns.map((x) => ({ role: x.role === "student" ? "candidate" : "interviewer", text: x.content }));
      const system = buildV1SystemPrompt(t);

      let proposal: V1Proposal | null = null;
      let reason: string | null = null;
      let llmError: string | null = null;
      if (!plan.endReason && Object.values(plan.branches).some(Boolean)) {
        const r = await deps.ai({
          feature: "interview.v1.turn", orgId: iv.org_id, userId: actor, interviewId: iv.id, purpose: "turn",
          system, messages: [{ role: "user", content: buildV1TurnMessage(state, t, plan, recent, answer, elapsed, injection.detected) }],
          cacheInput: null, jsonSchema: NEXT_TURN_SCHEMA, schemaName: "next_turn", parse: NextTurnOutput.safeParse,
        });
        if (r.ok) {
          proposal = { answer_signal: r.data.answer_signal, answer_score: r.data.answer_score, move_kind: r.data.move_kind, question: cleanV1Question(r.data.question) };
          reason = r.data.reason?.slice(0, 200) ?? null;
        } else llmError = `${r.code}: ${r.message}`.slice(0, 300);
      }

      const out = applyV1(state, t, plan, proposal, elapsed);
      let next: string | null = null;
      let fallback = false;
      if (out.move) {
        next = out.question;
        if (!next) {
          const r = await deps.ai({
            feature: "interview.v1.turn", orgId: iv.org_id, userId: actor, interviewId: iv.id, purpose: "regenerate",
            system, messages: [{ role: "user", content: buildV1RegenerateMessage(out.move, t, answer) }],
            cacheInput: null, jsonSchema: ASK_QUESTION_SCHEMA, schemaName: "ask_question", parse: AskQuestionOutput.safeParse,
          });
          next = r.ok ? cleanV1Question(r.data.question) || null : null;
          if (!next) { next = fallbackV1Question(out.move, t); fallback = true; }
        }
      }

      const r = await rpc<{ ok: boolean; reason?: string; duplicate?: boolean }>("b2b_iv_record_turn", {
        _actor: actor, _interview_id: iv.id, _expected_turn_count: input.turnCount, _client_turn_id: input.clientTurnId,
        _answer: answer, _answer_meta: meta, _answer_topic: state.current_topic, _answer_difficulty: state.difficulty,
        _next_question: out.move ? next : V1_CLOSING_LINE,
        _next_meta: { prompt_version: V1_PROMPT_VERSION, section: out.move?.section ?? null, move: out.move?.kind ?? null, fallback },
        _state: out.state, _end_reason: out.endReason,
        _note: {
          judgement: proposal ? { signal: proposal.answer_signal, score: proposal.answer_score, reason } : null,
          move: out.move, overrides: out.overrides, llm_error: llmError, injection, signals,
          latency: input.clientLatency ?? null,
        },
      });
      if (!r.ok) refuse(r.reason);
      if (out.endReason && !r.duplicate) deps.evaluateLater(iv.id);
      if (input.clientLatency) console.log(`[VOICE-LATENCY] ${JSON.stringify({ source: "b2b-interview-v1", session: iv.id, ...input.clientLatency })}`);
      return toRoom(await load(actor, iv.id), { duplicate: !!r.duplicate });
    },

    async finish(input: { interviewId: string }, actor: string): Promise<RoomState> {
      const r = await rpc<{ status?: string; already?: boolean }>("b2b_iv_finish", { _actor: actor, _interview_id: input.interviewId, _reason: "student_ended" });
      if (r.status === "completed" && !r.already) deps.evaluateLater(input.interviewId);
      return toRoom(await load(actor, input.interviewId));
    },

    async audioIssue(input: { interviewId: string; kind: string; detail?: string }, actor: string) {
      await rpc("b2b_iv_note", { _actor: actor, _interview_id: input.interviewId, _kind: "audio_issue", _data: { kind: input.kind, detail: input.detail ?? null } });
      return { ok: true as const };
    },

    async latency(input: { interviewId: string; samples: number[] }, actor: string) {
      const s = latencyStats(input.samples);
      await rpc("b2b_iv_note", { _actor: actor, _interview_id: input.interviewId, _kind: "latency_summary", _data: { ...s, samples: input.samples.slice(0, 100) } });
      return { ok: true as const, p50: s.p50, p95: s.p95 };
    },

    async liveToken(input: { interviewId?: string }, actor: string) {
      const key = (deps.env("GEMINI_API_KEY") ?? "").trim();
      if (!key) throw new V1Error(503, "LIVE_NOT_CONFIGURED", "The Gemini Live spike isn't configured (GEMINI_API_KEY is not set).");
      const allowed = await rpc<boolean>("b2b_iv_live_allowed", { _actor: actor, _interview_id: input.interviewId ?? null });
      if (!allowed) throw new V1Error(403, "FORBIDDEN", "Not allowed.");
      const model = deps.env("GEMINI_LIVE_MODEL") || "gemini-live-2.5-flash-preview";
      const expires = new Date(now() + 30 * 60_000).toISOString();
      const newSession = new Date(now() + 2 * 60_000).toISOString();
      // Ephemeral tokens (v1alpha): single use; the browser must open its session within 2 minutes. To verify against the docs.
      const res = await deps.fetch(`https://generativelanguage.googleapis.com/v1alpha/auth_tokens?key=${encodeURIComponent(key)}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uses: 1, expireTime: expires, newSessionExpireTime: newSession }),
      }).catch(() => null);
      if (!res || !res.ok) throw new V1Error(502, "LIVE_TOKEN_FAILED", `Gemini refused the token request${res ? ` (${res.status})` : ""}.`);
      const data = await res.json().catch(() => ({})) as { name?: string };
      if (!data.name) throw new V1Error(502, "LIVE_TOKEN_FAILED", "Gemini returned no token.");
      return { token: data.name, expiresAt: expires, model };
    },
  };
}

export type V1Handlers = ReturnType<typeof makeV1Handlers>;
