// ─── Interview V1 state machine (sections on top of the pilot engine) ─────────
// Pure TS. Extends the pilot's InterviewState (so b2b_record_turn, resume and the pilot screens keep working)
// with a `v1` block: current section, questions asked in it, follow-ups on the current thread and per-skill
// coverage. The model only *rates* the answer and *writes* the question; the rules here decide what comes next:
//   • sections in template order, each with a hard time-box (absolute boundaries: slack flows forward)
//   • per answer: strong → a deeper follow-up, weak / no answer → one basics follow-up, otherwise move on;
//     at most template.maxFollowups follow-ups per question thread
//   • coverage: the technical section asks every must-have skill (highest weight first) before nice-to-haves,
//     and only allows a follow-up while the time left still fits one question per unprobed must-have
//   • end: every section done, the overall time is up, or the safety cap on questions is hit
import {
  SIGNALS, emptySignal, stepDifficulty,
  type AnswerSignal, type Difficulty, type EndReason, type InterviewState,
} from "../interview-engine.ts";
import { FOLLOWUP_SECTIONS, SECTION_LABEL, sectionBoundaries, type InterviewTemplate, type SectionKey } from "./template.ts";

export const MAX_V1_TURNS = 40;
/** Don't start a question in a section with less than this left in its time-box. */
export const MIN_SECTION_SECONDS = 40;
/** Don't start any question with less than this left overall. */
export const MIN_SECONDS_FOR_NEXT_TURN = 45;
/** Typical time one question + answer takes; used to reserve time for unprobed must-have skills. */
export const AVG_QUESTION_SECONDS = 75;

export type MoveKind = "new" | "deeper" | "basics";

export interface V1Extra {
  section_index: number;
  section_started_s: number;
  section_questions: number;          // questions asked in the current section, incl. the one awaiting an answer
  followups: number;                  // follow-ups on the current question thread
  thread_skill: string | null;        // skill the current thread probes (technical section)
  probed: Record<string, number>;     // skill → questions asked about it
  kind: MoveKind;                     // kind of the question awaiting an answer
}
export type V1State = InterviewState & { v1: V1Extra };

export interface Move {
  kind: MoveKind;
  section: SectionKey;
  skill: string | null;
  difficulty: Difficulty;
  newSection: boolean;
}

export interface V1Plan {
  /** Ends after this answer whatever the rating (time up, safety cap). */
  endReason: EndReason | null;
  /** What happens next for each possible rating; null = nothing left to ask (all sections done). */
  branches: Record<AnswerSignal, Move | null>;
}

export interface V1Proposal {
  answer_signal: AnswerSignal;
  answer_score: number;
  move_kind: MoveKind;
  question: string;
}

export interface V1Outcome {
  state: V1State;
  endReason: EndReason | null;
  move: Move | null;
  /** The model's question when it was written for the move the rules chose; null → regenerate / fallback. */
  question: string | null;
  overrides: string[];
}

export function topicLabel(section: SectionKey, skill: string | null): string {
  return section === "technical" && skill ? skill : SECTION_LABEL[section];
}

export function currentSection(state: V1State, t: InterviewTemplate): SectionKey {
  return t.sections[Math.min(state.v1.section_index, t.sections.length - 1)].key;
}

export function initV1State(t: InterviewTemplate, moduleId: string | null): V1State {
  const first = t.sections[0].key;
  const label = topicLabel(first, null);
  return {
    module_id: moduleId ?? "",
    current_topic: label,
    difficulty: t.startDifficulty,
    topics_covered: [],
    topics_remaining: t.skills.map((s) => s.skill),
    per_topic_signal: { [label]: emptySignal() },
    turn_count: 0,
    questions_on_topic: 1,
    v1: { section_index: 0, section_started_s: 0, section_questions: 1, followups: 0, thread_skill: null, probed: {}, kind: "new" },
  };
}

export function isV1State(v: unknown): v is V1State {
  const s = v as V1State | null;
  return !!s && typeof s === "object" && !!s.v1 && Number.isInteger(s.v1.section_index) && Number.isInteger(s.turn_count);
}

/** Next skill for a new technical question: unprobed must-haves by weight, then unprobed nice-to-haves, then the least probed must-have. */
export function pickSkill(state: V1State, t: InterviewTemplate, exclude: string | null = null): string | null {
  const probed = (s: string) => state.v1.probed[s] ?? 0;
  const byWeight = [...t.skills].sort((a, b) => b.weight - a.weight || Number(b.must) - Number(a.must));
  const unMust = byWeight.find((s) => s.must && probed(s.skill) === 0);
  if (unMust) return unMust.skill;
  const unNice = byWeight.find((s) => !s.must && probed(s.skill) === 0);
  if (unNice) return unNice.skill;
  const again = byWeight.filter((s) => s.must && s.skill !== exclude).sort((a, b) => probed(a.skill) - probed(b.skill))[0];
  return again?.skill ?? null;
}

export function unprobedMustHaves(state: V1State, t: InterviewTemplate): string[] {
  return t.skills.filter((s) => s.must && !(state.v1.probed[s.skill] > 0)).map((s) => s.skill);
}

/** Decide, before calling the model, what follows each possible rating of the answer. */
export function planV1(state: V1State, t: InterviewTemplate, elapsedS: number): V1Plan {
  const none = Object.fromEntries(SIGNALS.map((s) => [s, null])) as Record<AnswerSignal, Move | null>;
  if (state.turn_count + 1 >= MAX_V1_TURNS) return { endReason: "max_turns", branches: none };
  if (t.durationMin * 60 - elapsedS < MIN_SECONDS_FOR_NEXT_TURN) return { endReason: "time_limit", branches: none };

  const bounds = sectionBoundaries(t);
  const idx = Math.min(state.v1.section_index, t.sections.length - 1);
  const sec = t.sections[idx];
  const left = bounds[idx] - elapsedS;
  const unMust = unprobedMustHaves(state, t);
  const isTech = sec.key === "technical";
  const canStay = left >= MIN_SECTION_SECONDS &&
    (state.v1.section_questions < sec.maxQuestions || (isTech && unMust.length > 0));
  const coverageOk = !isTech || left - unMust.length * AVG_QUESTION_SECONDS >= AVG_QUESTION_SECONDS;
  const followupOk = canStay && coverageOk && FOLLOWUP_SECTIONS.includes(sec.key) && state.v1.followups < t.maxFollowups;

  const advance = (difficulty: Difficulty): Move | null => {
    for (let j = idx + 1; j < t.sections.length; j++) {
      if (bounds[j] - elapsedS < MIN_SECTION_SECONDS) continue; // its time-box has already passed
      const key = t.sections[j].key;
      const skill = key === "technical" ? pickSkill(state, t) : null;
      if (key === "technical" && !skill) continue;
      return { kind: "new", section: key, skill, difficulty, newSection: true };
    }
    return null;
  };

  const branch = (signal: AnswerSignal): Move | null => {
    const thread = state.v1.thread_skill;
    if (followupOk && signal === "strong") {
      return { kind: "deeper", section: sec.key, skill: thread, difficulty: stepDifficulty(state.difficulty, "strong"), newSection: false };
    }
    if (followupOk && (signal === "weak" || signal === "no_answer") && state.v1.kind !== "basics") {
      return { kind: "basics", section: sec.key, skill: thread, difficulty: stepDifficulty(state.difficulty, "weak"), newSection: false };
    }
    const difficulty = stepDifficulty(state.difficulty, signal);
    if (canStay) {
      if (!isTech) return { kind: "new", section: sec.key, skill: null, difficulty, newSection: false };
      const skill = pickSkill(state, t, thread);
      if (skill) return { kind: "new", section: sec.key, skill, difficulty, newSection: false };
    }
    return advance(difficulty);
  };

  return { endReason: null, branches: Object.fromEntries(SIGNALS.map((s) => [s, branch(s)])) as Record<AnswerSignal, Move | null> };
}

/** Apply the (possibly missing) model proposal under the plan. Never mutates `state`. */
export function applyV1(state: V1State, t: InterviewTemplate, plan: V1Plan, proposal: V1Proposal | null, elapsedS: number): V1Outcome {
  const overrides: string[] = [];
  const signal: AnswerSignal = proposal && SIGNALS.includes(proposal.answer_signal) ? proposal.answer_signal : "adequate";
  if (proposal && !SIGNALS.includes(proposal.answer_signal)) overrides.push("invalid_signal");

  // Counts only: per-answer scores live in staff-only notes, not on the row the candidate can read.
  const per = structuredClone(state.per_topic_signal);
  const cur = per[state.current_topic] ?? emptySignal();
  cur.asked += 1;
  if (proposal) {
    if (signal === "strong") cur.strong += 1;
    else if (signal === "adequate") cur.adequate += 1;
    else cur.weak += 1;
    cur.last = signal;
  }
  per[state.current_topic] = cur;

  const base: V1State = {
    ...state,
    per_topic_signal: per,
    turn_count: state.turn_count + 1,
    topics_covered: [...state.topics_covered],
    topics_remaining: [...state.topics_remaining],
    v1: { ...state.v1, probed: { ...state.v1.probed } },
  };
  const finish = (reason: EndReason): V1Outcome => ({ state: base, endReason: reason, move: null, question: null, overrides });
  if (plan.endReason) return finish(plan.endReason);
  const move = plan.branches[signal];
  if (!move) return finish("topics_covered");

  if (move.newSection) {
    base.v1.section_index = t.sections.findIndex((s) => s.key === move.section);
    base.v1.section_started_s = Math.round(elapsedS);
    base.v1.section_questions = 1;
    base.v1.followups = 0;
  } else {
    base.v1.section_questions = state.v1.section_questions + 1;
    base.v1.followups = move.kind === "new" ? 0 : state.v1.followups + 1;
  }
  base.v1.thread_skill = move.skill;
  base.v1.kind = move.kind;
  if (move.skill && move.kind === "new") {
    base.v1.probed[move.skill] = (base.v1.probed[move.skill] ?? 0) + 1;
    if (base.topics_remaining.includes(move.skill)) {
      base.topics_remaining = base.topics_remaining.filter((s) => s !== move.skill);
      base.topics_covered.push(move.skill);
    }
  }
  const label = topicLabel(move.section, move.skill);
  base.questions_on_topic = label === state.current_topic ? state.questions_on_topic + 1 : 1;
  base.current_topic = label;
  if (!base.per_topic_signal[label]) base.per_topic_signal[label] = emptySignal();
  base.difficulty = move.difficulty;

  let question: string | null = proposal?.question?.trim() || null;
  if (proposal && proposal.move_kind !== move.kind) {
    overrides.push(`move_mismatch:${proposal.move_kind}->${move.kind}`);
    question = null;
  }
  return { state: base, endReason: null, move, question, overrides };
}
