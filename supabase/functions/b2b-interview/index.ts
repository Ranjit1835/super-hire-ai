// B2B adaptive voice interview.
//
// Actions (all require a signed-in student)
//   start   { moduleId, clientMeta? }                          → opening question (or resume payload)
//   resume  { interviewId }                                    → transcript + current question + time left
//   answer  { interviewId, clientTurnId, turnCount, answer, meta? } → next question | completion
//   end     { interviewId }                                    → student ends (0 answers = cancelled + refunded)
//   current {}                                                 → the student's live interview, if any
//
// The browser only ever sends its latest answer. The server owns the transcript and the
// state machine (_shared/interview-engine.ts); every write goes through a SQL function
// that re-checks ownership, idempotency (clientTurnId) and turn order (turnCount).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { HttpError, handle, json, requireUser, serviceClient, str, uuid } from "../_shared/b2b-http.ts";
import { normalizeModuleSpec, type ModuleSpec } from "../_shared/module-spec.ts";
import {
  applyTurn, initState, isInterviewState, planTurn, DIFFICULTIES,
  type InterviewState, type TurnProposal, type AnswerSignal,
} from "../_shared/interview-engine.ts";
import {
  ASK_QUESTION_TOOL, CLOSING_LINE, INTERVIEWER_PROMPT_VERSION, buildOpeningMessage, buildRegenerateMessage,
  buildSystemPrompt, buildTurnMessage, cleanQuestion, fallbackQuestion, nextTurnTool, type TranscriptTurn,
} from "../_shared/interview-prompts.ts";
import { callTool, type LlmUsage } from "../_shared/b2b-llm.ts";
import { sanitizeAnswerMeta, sanitizeClientMeta } from "../_shared/interview-meta.ts";

const MAX_ANSWER_CHARS = 4000;

type Admin = ReturnType<typeof serviceClient>;

interface InterviewRow {
  id: string; org_id: string; user_id: string; module_id: string; module_spec: ModuleSpec; state: InterviewState;
  status: string; end_reason: string | null; started_at: string; deadline_at: string;
}
interface TurnRow { turn_index: number; role: "interviewer" | "student"; content: string; topic: string | null; client_turn_id: string | null }

const START_ERRORS: Record<string, [number, string]> = {
  NOT_A_STUDENT: [403, "This module isn't available to your account."],
  MODULE_UNAVAILABLE: [404, "This module is no longer available. Refresh the page."],
  LIMIT_REACHED: [403, "You've used all the interviews in your institution's plan."],
  PLAN_EXPIRED: [403, "Your institution's plan has ended. Contact your placement office."],
  ORG_NOT_FOUND: [404, "Institution not found."],
};

async function loadInterview(admin: Admin, id: string, userId: string): Promise<InterviewRow> {
  const { data, error } = await admin
    .from("b2b_interviews")
    .select("id, org_id, user_id, module_id, module_spec, state, status, end_reason, started_at, deadline_at")
    .eq("id", id).eq("user_id", userId).maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(404, "NOT_FOUND", "Interview not found.");
  return data as InterviewRow;
}

async function loadTurns(admin: Admin, id: string): Promise<TurnRow[]> {
  const { data, error } = await admin
    .from("b2b_interview_turns")
    .select("turn_index, role, content, topic, client_turn_id")
    .eq("interview_id", id)
    .order("turn_index").order("created_at");
  if (error) throw error;
  // Within a turn index the interviewer's question precedes the student's answer.
  return (data as TurnRow[]).sort((a, b) => a.turn_index - b.turn_index || (a.role === "interviewer" ? -1 : 1));
}

function elapsedSeconds(iv: Pick<InterviewRow, "started_at">): number {
  return Math.max(0, (Date.now() - new Date(iv.started_at).getTime()) / 1000);
}

/** The shape every action returns so the client can (re)render from any point. */
function payload(iv: InterviewRow, turns: TurnRow[], extra: Record<string, unknown> = {}) {
  const lastQ = [...turns].reverse().find((t) => t.role === "interviewer");
  const answered = turns.filter((t) => t.role === "student").length;
  return {
    interview: {
      id: iv.id,
      module_id: iv.module_id,
      module_name: iv.module_spec.name,
      status: iv.status,
      end_reason: iv.end_reason,
      started_at: iv.started_at,
      deadline_at: iv.deadline_at,
      server_now: new Date().toISOString(),
      turn_count: iv.state.turn_count,
      max_turns: iv.module_spec.max_turns,
      topics_total: iv.module_spec.topics.length,
      topics_covered: iv.state.topics_covered.length,
      current_topic: iv.status === "in_progress" ? iv.state.current_topic : null,
    },
    // Awaiting an answer to this question (null when finished).
    question: iv.status === "in_progress" && lastQ && lastQ.turn_index === answered + 1 ? lastQ.content : null,
    closing: iv.status !== "in_progress" && lastQ && lastQ.turn_index > answered ? lastQ.content : null,
    transcript: turns.map((t) => ({ turn: t.turn_index, role: t.role, content: t.content })),
    ...extra,
  };
}

async function firstName(admin: Admin, orgId: string, userId: string): Promise<string | null> {
  const { data } = await admin.from("org_memberships").select("full_name").eq("org_id", orgId).eq("user_id", userId).maybeSingle();
  const n = (data?.full_name ?? "").trim().split(/\s+/)[0];
  return n && n.length <= 40 ? n : null;
}

async function askOpening(admin: Admin, iv: InterviewRow): Promise<{ question: string; usage: LlmUsage | null; fallback: boolean }> {
  const spec = iv.module_spec;
  const name = await firstName(admin, iv.org_id, iv.user_id);
  const { args, usage } = await callTool({
    system: buildSystemPrompt(spec),
    messages: [{ role: "user", content: buildOpeningMessage(spec, name) }],
    tool: ASK_QUESTION_TOOL,
    timeoutMs: 20_000,
  });
  const q = cleanQuestion(String(args.question ?? ""));
  if (!q) throw new Error("empty opening");
  return { question: q, usage, fallback: false };
}

function asProposal(args: Record<string, unknown>): TurnProposal | null {
  const signal = String(args.answer_signal ?? "") as AnswerSignal;
  const q = cleanQuestion(String(args.question ?? ""));
  if (!signal || typeof args.next_topic !== "string") return null;
  return {
    answer_signal: signal,
    answer_score: Number(args.answer_score),
    topic_covered: args.topic_covered === true,
    next_topic: args.next_topic,
    question: q,
  };
}

serve(handle("B2B-INTERVIEW", async (req, body) => {
  const action = str(body.action, "action", 20);
  const user = await requireUser(req);
  const admin = serviceClient();

  // ── current ────────────────────────────────────────────────────────────────
  if (action === "current") {
    const { data, error } = await admin
      .from("b2b_interviews")
      .select("id, org_id, user_id, module_id, module_spec, state, status, end_reason, started_at, deadline_at")
      .eq("user_id", user.id).eq("status", "in_progress").maybeSingle();
    if (error) throw error;
    if (!data) return json({ interview: null });
    const iv = data as InterviewRow;
    return json(payload(iv, await loadTurns(admin, iv.id)));
  }

  // ── start ──────────────────────────────────────────────────────────────────
  if (action === "start") {
    const moduleId = uuid(body.moduleId, "moduleId");
    const clientMeta = sanitizeClientMeta(body.clientMeta);

    let result: Record<string, unknown> | null = null;
    for (let attempt = 0; attempt < 2 && !result; attempt++) {
      const { data: mod, error: modErr } = await admin
        .from("interview_modules").select("id, org_id, spec, version, is_active").eq("id", moduleId).maybeSingle();
      if (modErr) throw modErr;
      if (!mod || !mod.org_id || !mod.is_active) throw new HttpError(404, "MODULE_UNAVAILABLE", START_ERRORS.MODULE_UNAVAILABLE[1]);
      const { spec } = normalizeModuleSpec(mod.spec);
      if (!spec) throw new Error(`module ${moduleId} has an invalid spec`);

      const { data, error } = await admin.rpc("b2b_start_interview", {
        _user_id: user.id, _module_id: moduleId, _module_version: mod.version,
        _initial_state: initState(moduleId, spec), _prompt_version: INTERVIEWER_PROMPT_VERSION, _client_meta: clientMeta,
      });
      if (error) throw error;
      const r = data as Record<string, unknown>;
      if (r.ok || r.reason !== "MODULE_CHANGED") result = r; // module edited mid-start: reload once
    }
    if (!result) throw new HttpError(409, "MODULE_CHANGED", "This module was just updated. Please try again.");

    if (!result.ok) {
      if (result.reason === "OTHER_IN_PROGRESS") {
        throw new HttpError(409, "OTHER_IN_PROGRESS", "You have another interview in progress. Finish or end it first.");
      }
      const [status, msg] = START_ERRORS[String(result.reason)] ?? [400, "Could not start the interview."];
      throw new HttpError(status, String(result.reason), msg);
    }

    const iv = await loadInterview(admin, String(result.interview_id), user.id);
    let turns = await loadTurns(admin, iv.id);
    if (turns.length === 0) {
      try {
        const o = await askOpening(admin, iv);
        const { error } = await admin.rpc("b2b_record_opening", {
          _interview_id: iv.id, _question: o.question,
          _meta: { llm: o.usage ? [o.usage] : [], prompt_version: INTERVIEWER_PROMPT_VERSION },
          _state: iv.state,
        });
        if (error) throw error;
      } catch (e) {
        console.error("[B2B-INTERVIEW] opening failed, refunding:", (e as Error).message);
        await admin.rpc("b2b_cancel_failed_start", { _interview_id: iv.id });
        throw new HttpError(503, "AI_BUSY", "The interviewer is busy right now. Your interview credit was not used — please try again in a minute.");
      }
      turns = await loadTurns(admin, iv.id);
    }
    console.log(`[B2B-INTERVIEW] start interview=${iv.id} org=${iv.org_id} resumed=${!!result.resumed}`);
    return json(payload(iv, turns, { resumed: !!result.resumed, credit: result.credit ?? null }));
  }

  const interviewId = uuid(body.interviewId, "interviewId");

  // ── resume ─────────────────────────────────────────────────────────────────
  if (action === "resume") {
    let iv = await loadInterview(admin, interviewId, user.id);
    if (iv.status === "in_progress" && elapsedSeconds(iv) >= iv.module_spec.max_minutes * 60) {
      // Time ran out while the student was away: close it and let the evaluator use what exists.
      await admin.rpc("b2b_end_interview", { _interview_id: iv.id, _user_id: user.id, _state: null, _reason: "time_limit" });
      iv = await loadInterview(admin, interviewId, user.id);
    }
    return json(payload(iv, await loadTurns(admin, iv.id)));
  }

  // ── end ────────────────────────────────────────────────────────────────────
  if (action === "end") {
    const { data, error } = await admin.rpc("b2b_end_interview", { _interview_id: interviewId, _user_id: user.id, _state: null, _reason: "student_ended" });
    if (error) throw error;
    if ((data as { ok: boolean }).ok === false) throw new HttpError(404, "NOT_FOUND", "Interview not found.");
    const iv = await loadInterview(admin, interviewId, user.id);
    return json(payload(iv, await loadTurns(admin, iv.id), { refunded: !!(data as { refunded?: boolean }).refunded }));
  }

  // ── answer ─────────────────────────────────────────────────────────────────
  if (action === "answer") {
    const clientTurnId = uuid(body.clientTurnId, "clientTurnId");
    const expected = Number(body.turnCount);
    if (!Number.isInteger(expected) || expected < 0) throw new HttpError(400, "BAD_REQUEST", "turnCount must be a non-negative integer");
    const answer = str(body.answer, "answer", MAX_ANSWER_CHARS + 500).slice(0, MAX_ANSWER_CHARS);
    const answerMeta = sanitizeAnswerMeta(body.meta, answer);

    const iv = await loadInterview(admin, interviewId, user.id);
    let turns = await loadTurns(admin, iv.id);

    // Retry of an answer we already stored → return the stored outcome, no second LLM call.
    if (turns.some((t) => t.client_turn_id === clientTurnId)) return json(payload(iv, turns, { duplicate: true }));
    if (iv.status !== "in_progress") throw new HttpError(409, "NOT_IN_PROGRESS", "This interview has already finished.");
    if (!isInterviewState(iv.state)) throw new Error(`interview ${iv.id} has a corrupt state`);
    if (iv.state.turn_count !== expected) {
      return json({ ...payload(iv, turns), error: "Out of sync — showing the latest question.", code: "TURN_CONFLICT" }, 409);
    }

    const spec = iv.module_spec;
    const state = iv.state;
    const elapsed = elapsedSeconds(iv);
    const plan = planTurn(state, spec, elapsed);
    const recent: TranscriptTurn[] = turns.map((t) => ({ role: t.role, content: t.content }));
    const system = buildSystemPrompt(spec);
    const usage: LlmUsage[] = [];
    let reason: string | null = null;
    let proposal: TurnProposal | null = null;
    let llmError: string | null = null;

    // Last answer: nothing more to ask, so skip the model (the evaluator scores it later).
    if (!plan.endReason) {
      try {
        const { args, usage: u } = await callTool({
          system,
          messages: [{ role: "user", content: buildTurnMessage(state, spec, plan, recent, answer, elapsed) }],
          tool: nextTurnTool(plan.allowedTopics, DIFFICULTIES),
          timeoutMs: 20_000,
        });
        usage.push(u);
        proposal = asProposal(args);
        reason = typeof args.reason === "string" ? args.reason.slice(0, 200) : null;
      } catch (e) {
        llmError = (e as Error).message;
        console.error("[B2B-INTERVIEW] turn LLM failed; continuing with rules:", llmError);
      }
    }

    const out = applyTurn(state, spec, plan, proposal);
    let nextQuestion: string | null = null;
    let fallback = false;
    if (out.next) {
      nextQuestion = out.next.question;
      if (!nextQuestion) {
        try {
          const { args, usage: u } = await callTool({
            system,
            messages: [{ role: "user", content: buildRegenerateMessage(out.next.topic, out.next.difficulty, answer) }],
            tool: ASK_QUESTION_TOOL,
            timeoutMs: 12_000,
            maxAttempts: 1,
          });
          usage.push(u);
          nextQuestion = cleanQuestion(String(args.question ?? "")) || null;
        } catch (e) {
          console.error("[B2B-INTERVIEW] regenerate failed:", (e as Error).message);
        }
        if (!nextQuestion) {
          nextQuestion = fallbackQuestion(out.next.topic, out.next.difficulty);
          fallback = true;
        }
      }
    }

    const { data, error } = await admin.rpc("b2b_record_turn", {
      _interview_id: iv.id,
      _user_id: user.id,
      _expected_turn_count: expected,
      _client_turn_id: clientTurnId,
      _answer: answer,
      _answer_meta: {
        ...answerMeta,
        assessment: proposal ? { signal: proposal.answer_signal, score: proposal.answer_score, topic_covered: proposal.topic_covered, reason } : null,
      },
      _answer_topic: state.current_topic,
      _answer_difficulty: state.difficulty,
      _next_question: out.next ? nextQuestion : CLOSING_LINE,
      _next_meta: { llm: usage, overrides: out.overrides, fallback, llm_error: llmError, prompt_version: INTERVIEWER_PROMPT_VERSION },
      _state: out.state,
      _end_reason: out.endReason,
    });
    if (error) throw error;
    const r = data as { ok: boolean; reason?: string; duplicate?: boolean };
    const fresh = await loadInterview(admin, iv.id, user.id);
    turns = await loadTurns(admin, iv.id);
    if (!r.ok) {
      if (r.reason === "TURN_CONFLICT") return json({ ...payload(fresh, turns), error: "Out of sync — showing the latest question.", code: "TURN_CONFLICT" }, 409);
      throw new HttpError(409, r.reason ?? "CONFLICT", "This interview has already finished.");
    }
    console.log(`[B2B-INTERVIEW] answer interview=${iv.id} turn=${expected + 1} end=${out.endReason ?? "-"} overrides=${out.overrides.join(",") || "-"} llm_ms=${usage.map((u) => u.latency_ms).join("+") || 0}`);
    return json(payload(fresh, turns, { duplicate: !!r.duplicate }));
  }

  throw new HttpError(400, "BAD_REQUEST", "Unknown action");
}));
