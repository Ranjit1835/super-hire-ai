// ─── Interview V1 template ────────────────────────────────────────────────────
// Pure TS (Deno + browser + Node tests). Turns what a drive (interview module) or a job role (skills matrix +
// optional interview config from track E) says into one template: skills matrix with weights, sections with
// hard time-boxes, follow-up limit and the code walkthrough source. Snapshotted on the interview row, so a later
// edit of the role or module never changes an interview that already started.
import type { Difficulty } from "../interview-engine.ts";

export const SECTION_KEYS = [
  "intro", "technical", "problem_solving", "behavioral", "code_walkthrough", "candidate_questions",
] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

export const SECTION_LABEL: Record<SectionKey, string> = {
  intro: "Introduction",
  technical: "Technical",
  problem_solving: "Problem solving",
  behavioral: "Behavioural",
  code_walkthrough: "Code walkthrough",
  candidate_questions: "Your questions",
};

/** Share of the interview each section gets (renormalised over the sections actually used). */
const SECTION_SHARE: Record<SectionKey, number> = {
  intro: 0.08, technical: 0.4, problem_solving: 0.17, behavioral: 0.12, code_walkthrough: 0.15, candidate_questions: 0.08,
};
/** Most questions a section asks (follow-ups included). The technical cap grows with the number of skills. */
const SECTION_MAX_Q: Record<SectionKey, number> = {
  intro: 1, technical: 6, problem_solving: 3, behavioral: 2, code_walkthrough: 4, candidate_questions: 1,
};
/** Sections where the interviewer may follow up on an answer. */
export const FOLLOWUP_SECTIONS: readonly SectionKey[] = ["technical", "problem_solving", "behavioral", "code_walkthrough"];

export type Seniority = "fresher" | "intern" | "junior" | "mid" | "senior" | "lead";

export interface SkillItem { skill: string; weight: number; must: boolean }
export interface SectionPlan { key: SectionKey; seconds: number; maxQuestions: number }

/** The candidate's own submitted solution (never hidden tests). Delimited as data in every prompt. */
export interface WalkthroughSource {
  attemptId: string;
  questionTitle: string;
  statement: string;
  language: string | null;
  code: string;
  passed: number | null;
  total: number | null;
}

export interface InterviewTemplate {
  version: "v1";
  context: "drive" | "job_role";
  title: string;
  seniority: Seniority;
  durationMin: number;
  skills: SkillItem[];
  sections: SectionPlan[];
  maxFollowups: number;
  startDifficulty: Difficulty;
  walkthrough: WalkthroughSource | null;
  doubleScore: boolean;
  styleNotes: string | null;
}

/** Interview config as track E may store it on job_roles (all optional; defaults below). */
export interface InterviewConfig {
  duration_min?: number;
  sections?: string[];
  difficulty?: "easy" | "medium" | "hard";
  code_walkthrough?: boolean;
  double_score?: boolean;
  max_followups?: number;
}

export interface TemplateInput {
  context: "drive" | "job_role";
  title: string;
  /** Job role: { must_have: [{ skill, weight }], nice_to_have: [...], seniority }. */
  skillsMatrix?: unknown;
  /** Drive: the interview module's spec (topics become must-have skills). */
  moduleSpec?: { topics?: unknown; max_minutes?: unknown; style_notes?: unknown } | null;
  seniority?: string | null;
  config?: InterviewConfig | null;
  /** job_roles.code_walkthrough (track D/E column); config.code_walkthrough wins when both are set. */
  codeWalkthroughEnabled?: boolean;
  walkthrough?: WalkthroughSource | null;
}

export const DEFAULT_DURATION_MIN = 20;
export const MIN_DURATION_MIN = 8;
export const MAX_DURATION_MIN = 60;
export const DEFAULT_MAX_FOLLOWUPS = 2;
const MAX_SKILLS = 15;
const MAX_CODE_CHARS = 12_000;

const clampInt = (n: unknown, lo: number, hi: number, dflt: number) => {
  const v = typeof n === "number" && Number.isFinite(n) ? Math.round(n) : dflt;
  return Math.min(hi, Math.max(lo, v));
};
const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** Skills from a job role's matrix, or from a module's topics (all must-have, earlier topics weigh more). */
export function skillsFrom(input: Pick<TemplateInput, "skillsMatrix" | "moduleSpec">): SkillItem[] {
  const out: SkillItem[] = [];
  const seen = new Set<string>();
  const add = (skill: unknown, weight: unknown, must: boolean) => {
    const s = text(skill, 80);
    if (!s || seen.has(s.toLowerCase()) || out.length >= MAX_SKILLS) return;
    seen.add(s.toLowerCase());
    out.push({ skill: s, weight: clampInt(weight, 1, 5, 3), must });
  };
  const m = input.skillsMatrix as { must_have?: unknown; nice_to_have?: unknown } | null | undefined;
  if (m && typeof m === "object") {
    for (const it of Array.isArray(m.must_have) ? m.must_have : []) add((it as { skill?: unknown })?.skill, (it as { weight?: unknown })?.weight, true);
    for (const it of Array.isArray(m.nice_to_have) ? m.nice_to_have : []) add((it as { skill?: unknown })?.skill, (it as { weight?: unknown })?.weight, false);
  }
  if (!out.length) {
    const topics = Array.isArray(input.moduleSpec?.topics) ? input.moduleSpec.topics : [];
    // A module's "self-introduction" topic is the intro section, not a skill.
    const real = topics.filter((t) => !/self.?intro|introduc/i.test(String(t)));
    real.forEach((t, i) => add(t, Math.max(1, 5 - Math.floor(i / 2)), true));
  }
  return out;
}

/** Split the duration into section time-boxes. */
export function planSections(keys: SectionKey[], durationMin: number, skillCount: number): SectionPlan[] {
  const total = durationMin * 60;
  const share = keys.reduce((a, k) => a + SECTION_SHARE[k], 0) || 1;
  return keys.map((key) => ({
    key,
    seconds: Math.max(45, Math.round((total * SECTION_SHARE[key]) / share)),
    maxQuestions: key === "technical" ? Math.min(12, Math.max(SECTION_MAX_Q.technical, Math.ceil(skillCount * 1.5))) : SECTION_MAX_Q[key],
  }));
}

export function buildTemplate(input: TemplateInput): InterviewTemplate {
  const cfg = input.config ?? {};
  const skills = skillsFrom(input);
  const durationMin = clampInt(
    cfg.duration_min ?? (input.context === "drive" ? input.moduleSpec?.max_minutes : undefined),
    MIN_DURATION_MIN, MAX_DURATION_MIN, DEFAULT_DURATION_MIN,
  );
  const walkOn = (cfg.code_walkthrough ?? input.codeWalkthroughEnabled ?? true) && !!input.walkthrough;
  const wanted = Array.isArray(cfg.sections) && cfg.sections.length
    ? SECTION_KEYS.filter((k) => cfg.sections!.includes(k))
    : [...SECTION_KEYS];
  let keys = wanted.filter((k) => k !== "code_walkthrough" || walkOn);
  // A technical section needs skills to probe; the intro always opens the interview.
  if (!skills.length) keys = keys.filter((k) => k !== "technical");
  if (!keys.includes("intro")) keys = ["intro", ...keys];
  if (walkOn && !keys.includes("code_walkthrough")) keys.splice(keys.length - (keys.includes("candidate_questions") ? 1 : 0), 0, "code_walkthrough");

  const sen = (input.seniority ?? (input.skillsMatrix as { seniority?: string } | null)?.seniority ?? "") as Seniority;
  const seniority: Seniority = ["intern", "junior", "mid", "senior", "lead"].includes(sen) ? sen : input.context === "drive" ? "fresher" : "junior";
  const startDifficulty: Difficulty = cfg.difficulty === "hard" ? "advanced"
    : cfg.difficulty === "medium" || ["mid", "senior", "lead"].includes(seniority) ? "intermediate" : "beginner";

  const w = walkOn ? input.walkthrough! : null;
  return {
    version: "v1",
    context: input.context,
    title: text(input.title, 120) || "Interview",
    seniority,
    durationMin,
    skills,
    sections: planSections(keys, durationMin, skills.length),
    maxFollowups: clampInt(cfg.max_followups, 0, 3, DEFAULT_MAX_FOLLOWUPS),
    startDifficulty,
    walkthrough: w ? { ...w, code: w.code.slice(0, MAX_CODE_CHARS), statement: w.statement.slice(0, 4000) } : null,
    doubleScore: input.context === "job_role" && cfg.double_score === true,
    styleNotes: text(input.moduleSpec?.style_notes, 1000) || null,
  };
}

/** A ModuleSpec-shaped snapshot for b2b_interviews.module_spec, so pilot screens and reports keep working. */
export function compatModuleSpec(t: InterviewTemplate) {
  const maxTurns = t.sections.reduce((a, s) => a + s.maxQuestions, 0);
  return {
    name: t.title.slice(0, 80),
    type: "skill" as const,
    topics: t.skills.length ? t.skills.map((s) => s.skill) : [SECTION_LABEL.intro],
    pass_threshold: 6,
    max_turns: Math.min(30, Math.max(3, maxTurns)),
    max_minutes: t.durationMin,
  };
}

/** Absolute end (seconds from the start) of each section: earlier sections that finish early give later ones time. */
export function sectionBoundaries(t: Pick<InterviewTemplate, "sections">): number[] {
  let acc = 0;
  return t.sections.map((s) => (acc += s.seconds));
}
