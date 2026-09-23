// ─── Adaptive interview state machine ─────────────────────────────────────────
// Pure TS (no I/O). The LLM *proposes* (answer signal, whether the topic is covered,
// which allowed topic to ask next, the question text); this module *decides* using
// fixed rules, so behaviour is predictable, testable and can't drift off-module:
//   • difficulty: strong → up one level, weak / no answer → down one, else unchanged
//   • topics: only the module's topics; move on when covered, when the per-topic cap is
//     reached, or when the remaining turns are needed to reach the remaining topics
//   • end: all topics covered, max turns reached, or not enough time for another turn
import type { ModuleSpec } from "./module-spec.ts";

export type Difficulty = "beginner" | "intermediate" | "advanced";
export type AnswerSignal = "strong" | "adequate" | "weak" | "no_answer" | "off_topic";
export type EndReason = "topics_covered" | "max_turns" | "time_limit";

export const DIFFICULTIES: Difficulty[] = ["beginner", "intermediate", "advanced"];
export const SIGNALS: AnswerSignal[] = ["strong", "adequate", "weak", "no_answer", "off_topic"];
export const START_DIFFICULTY: Difficulty = "beginner";
/** Don't start another question with less than this much time left. */
export const MIN_SECONDS_FOR_NEXT_TURN = 45;

export interface TopicSignal {
  asked: number;
  strong: number;
  adequate: number;
  weak: number;       // weak + no_answer + off_topic
  scores: number[];   // in-turn 0–10 estimates (adaptivity only; the Step 6 evaluator is authoritative)
  last: AnswerSignal | null;
}

export interface InterviewState {
  module_id: string;
  current_topic: string;
  difficulty: Difficulty;
  topics_covered: string[];
  topics_remaining: string[];   // not yet started (excludes current_topic)
  per_topic_signal: Record<string, TopicSignal>;
  turn_count: number;           // answers received
  questions_on_topic: number;   // questions asked on current_topic, incl. the one awaiting an answer
}

export interface TurnPlan {
  /** Interview ends after this answer without asking anything else. */
  endReason: EndReason | null;
  /** Topics the next question may use (first = default if the model's pick is invalid). */
  allowedTopics: string[];
  mustMoveOn: boolean;
  /** Difficulty the next question should target for each possible signal. */
  difficultyIf: Record<AnswerSignal, Difficulty>;
}

/** What the model returned for one turn (already schema-checked by the caller). */
export interface TurnProposal {
  answer_signal: AnswerSignal;
  answer_score: number;
  topic_covered: boolean;
  next_topic: string;
  question: string;
}

export interface TurnOutcome {
  state: InterviewState;
  endReason: EndReason | null;
  /** Question to ask next (null when ending). */
  next: { topic: string; difficulty: Difficulty; question: string | null } | null;
  /** Rule overrides applied to the model's proposal (logged; question must be regenerated if topic changed). */
  overrides: string[];
}

export function emptySignal(): TopicSignal {
  return { asked: 0, strong: 0, adequate: 0, weak: 0, scores: [], last: null };
}

export function initState(moduleId: string, spec: ModuleSpec): InterviewState {
  const [first, ...rest] = spec.topics;
  return {
    module_id: moduleId,
    current_topic: first,
    difficulty: START_DIFFICULTY,
    topics_covered: [],
    topics_remaining: rest,
    per_topic_signal: Object.fromEntries(spec.topics.map((t) => [t, emptySignal()])),
    turn_count: 0,
    questions_on_topic: 1, // the opening question is on the first topic
  };
}

export function stepDifficulty(d: Difficulty, s: AnswerSignal): Difficulty {
  const i = DIFFICULTIES.indexOf(d);
  if (s === "strong") return DIFFICULTIES[Math.min(i + 1, DIFFICULTIES.length - 1)];
  if (s === "weak" || s === "no_answer") return DIFFICULTIES[Math.max(i - 1, 0)];
  return d;
}

export function maxQuestionsPerTopic(spec: ModuleSpec): number {
  return Math.min(3, Math.max(1, Math.ceil(spec.max_turns / spec.topics.length) + 1));
}

/** Decide, before calling the model, what the next question is allowed to be. */
export function planTurn(state: InterviewState, spec: ModuleSpec, elapsedSeconds: number): TurnPlan {
  const difficultyIf = Object.fromEntries(
    SIGNALS.map((s) => [s, stepDifficulty(state.difficulty, s)]),
  ) as Record<AnswerSignal, Difficulty>;
  const base = { difficultyIf };

  const answeredAfterThis = state.turn_count + 1;
  if (answeredAfterThis >= spec.max_turns) {
    return { ...base, endReason: "max_turns", allowedTopics: [], mustMoveOn: false };
  }
  if (spec.max_minutes * 60 - elapsedSeconds < MIN_SECONDS_FOR_NEXT_TURN) {
    return { ...base, endReason: "time_limit", allowedTopics: [], mustMoveOn: false };
  }
  const turnsLeft = spec.max_turns - answeredAfterThis;
  const remaining = state.topics_remaining;
  const mustMoveOn =
    state.questions_on_topic >= maxQuestionsPerTopic(spec) ||
    (remaining.length > 0 && turnsLeft <= remaining.length);

  if (mustMoveOn && remaining.length === 0) {
    return { ...base, endReason: "topics_covered", allowedTopics: [], mustMoveOn };
  }
  const allowedTopics = mustMoveOn ? [...remaining] : [state.current_topic, ...remaining];
  return { ...base, endReason: null, allowedTopics, mustMoveOn };
}

function matchTopic(name: string, allowed: string[]): string | null {
  const n = name.trim().toLowerCase();
  return allowed.find((t) => t.toLowerCase() === n) ?? null;
}

function clampScore(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(Math.min(10, Math.max(0, n)) * 10) / 10;
}

/** Apply the model's proposal under the rules. Never mutates `state`. */
export function applyTurn(
  state: InterviewState, spec: ModuleSpec, plan: TurnPlan, proposal: TurnProposal | null,
): TurnOutcome {
  const overrides: string[] = [];
  const signal: AnswerSignal = proposal && SIGNALS.includes(proposal.answer_signal) ? proposal.answer_signal : "adequate";
  if (proposal && !SIGNALS.includes(proposal.answer_signal)) overrides.push("invalid_signal");

  const per = structuredClone(state.per_topic_signal);
  const cur = per[state.current_topic] ?? emptySignal();
  cur.asked += 1;
  // Without a proposal (model unavailable, or final answer where no rating is needed)
  // the answer is counted but not rated, and difficulty stays put.
  if (proposal) {
    if (signal === "strong") cur.strong += 1;
    else if (signal === "adequate") cur.adequate += 1;
    else cur.weak += 1;
    cur.scores.push(clampScore(proposal.answer_score));
    cur.last = signal;
  }
  per[state.current_topic] = cur;

  const difficulty = proposal ? stepDifficulty(state.difficulty, signal) : state.difficulty;
  const base: InterviewState = {
    ...state,
    per_topic_signal: per,
    difficulty,
    turn_count: state.turn_count + 1,
    topics_covered: [...state.topics_covered],
    topics_remaining: [...state.topics_remaining],
  };

  const finish = (reason: EndReason): TurnOutcome => {
    if (!base.topics_covered.includes(base.current_topic)) base.topics_covered.push(base.current_topic);
    return { state: base, endReason: reason, next: null, overrides };
  };

  if (plan.endReason) return finish(plan.endReason);

  // The model says the current topic is done and nothing is left → finish early.
  if (proposal?.topic_covered && base.topics_remaining.length === 0) return finish("topics_covered");

  let target = proposal ? matchTopic(proposal.next_topic, plan.allowedTopics) : null;
  if (!target) {
    if (proposal) overrides.push(`topic_not_allowed:${proposal.next_topic}`);
    const stay = !plan.mustMoveOn && !proposal?.topic_covered;
    target = stay ? base.current_topic : plan.allowedTopics.find((t) => t !== base.current_topic) ?? plan.allowedTopics[0];
  }
  // Covered topic but the model wants to keep going on it → move on anyway if we can.
  if (target === base.current_topic && proposal?.topic_covered && base.topics_remaining.length > 0) {
    overrides.push("covered_topic_repeated");
    target = base.topics_remaining[0];
  }

  if (target !== base.current_topic) {
    base.topics_covered.push(base.current_topic);
    base.topics_remaining = base.topics_remaining.filter((t) => t !== target);
    base.current_topic = target;
    base.questions_on_topic = 1;
  } else {
    base.questions_on_topic = state.questions_on_topic + 1;
  }

  const topicChanged = !!proposal && matchTopic(proposal.next_topic, [target]) === null;
  const question = proposal && !topicChanged ? proposal.question.trim() : null;
  return { state: base, endReason: null, next: { topic: target, difficulty, question: question || null }, overrides };
}

/** Summary used in prompts and reports. */
export function progressLine(state: InterviewState, spec: ModuleSpec): string {
  return `Question ${state.turn_count + 1} of at most ${spec.max_turns}; topics covered ${state.topics_covered.length}/${spec.topics.length}`;
}

export function isInterviewState(v: unknown): v is InterviewState {
  if (!v || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  return typeof s.module_id === "string" && typeof s.current_topic === "string" &&
    DIFFICULTIES.includes(s.difficulty as Difficulty) && Array.isArray(s.topics_covered) &&
    Array.isArray(s.topics_remaining) && typeof s.per_topic_signal === "object" &&
    Number.isInteger(s.turn_count) && Number.isInteger(s.questions_on_topic);
}
