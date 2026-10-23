// Question bank + test builder: form schemas and the payloads they turn into.
// Questions save through b2b_save_question (atomic: question + tests + reference; coding → draft until the
// sandbox verifies it). Tests (assessments) save straight into the assessments table (RLS: org editors).
import { z } from "zod";
import { Difficulty, Language, ProctoringPolicy } from "../../../supabase/functions/_shared/contracts/common";

export const LANGUAGES = Language.options;
export const LANGUAGE_LABEL: Record<string, string> = { python: "Python 3", java: "Java", cpp: "C++", c: "C", javascript: "JavaScript" };
export const CATEGORY_LABEL: Record<string, string> = { aptitude: "Aptitude", cs_fundamentals: "CS fundamentals", technical: "Technical" };

export const splitTopics = (s: string) => Array.from(new Set(s.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean))).slice(0, 10);

// ── Question rows (as read from the bank) ────────────────────────────────────
export interface QuestionRow {
  id: string;
  org_id: string | null;
  type: "coding" | "mcq";
  title: string;
  statement: string;
  difficulty: z.infer<typeof Difficulty>;
  topics: string[];
  category: string | null;
  languages: string[];
  starter_code: Record<string, string>;
  constraints: string | null;
  time_limit_ms: number | null;
  memory_limit_kb: number | null;
  options: { id: string; text: string }[] | null;
  answer: string[] | null;
  multi_select: boolean;
  explanation: string | null;
  points: number | string;
  status: "draft" | "verified" | "retired";
  source: string;
  version: number;
  created_at: string;
}

// ── MCQ ──────────────────────────────────────────────────────────────────────
export const McqForm = z.object({
  title: z.string().trim().min(3, "Title: at least 3 characters").max(200),
  statement: z.string().trim().min(10, "Question: at least 10 characters").max(4000),
  difficulty: Difficulty,
  category: z.enum(["aptitude", "cs_fundamentals", "technical"]),
  topics: z.string().max(300),
  options: z.array(z.object({ id: z.string(), text: z.string().trim().min(1, "Every option needs text").max(500) })).min(2, "At least 2 options").max(6),
  correct: z.array(z.string()).min(1, "Mark the correct answer"),
  explanation: z.string().max(2000),
  points: z.coerce.number().positive("Points must be more than 0").max(100),
  ready: z.boolean(),
}).refine((f) => f.correct.every((c) => f.options.some((o) => o.id === c)), { message: "The correct answer must be one of the options", path: ["correct"] });
export type McqForm = z.infer<typeof McqForm>;

export const OPTION_IDS = ["a", "b", "c", "d", "e", "f"];

export function emptyMcq(): McqForm {
  return { title: "", statement: "", difficulty: "easy", category: "aptitude", topics: "", explanation: "", points: 1, ready: true,
           options: OPTION_IDS.slice(0, 4).map((id) => ({ id, text: "" })), correct: [] };
}

export function mcqFromRow(r: QuestionRow): McqForm {
  return { title: r.title, statement: r.statement, difficulty: r.difficulty, category: (r.category as McqForm["category"]) ?? "technical",
           topics: r.topics.join(", "), options: r.options ?? [], correct: r.answer ?? [], explanation: r.explanation ?? "",
           points: Number(r.points), ready: r.status === "verified" };
}

export function mcqPayload(orgId: string | null, f: McqForm, id?: string) {
  return {
    ...(id ? { id } : {}), org_id: orgId, type: "mcq", title: f.title.trim(), statement: f.statement.trim(), difficulty: f.difficulty,
    category: f.category, topics: splitTopics(f.topics), options: f.options.map((o) => ({ id: o.id, text: o.text.trim() })),
    answer: f.correct, multi_select: f.correct.length > 1, explanation: f.explanation.trim(), points: f.points,
    status: f.ready ? "verified" : "draft",
  };
}

// ── Coding ───────────────────────────────────────────────────────────────────
const TestRow = z.object({
  input: z.string().max(100000),
  expected_output: z.string().max(100000),
  is_sample: z.boolean(),
  weight: z.coerce.number().positive("Weight must be more than 0").max(100),
});

export const CodingForm = z.object({
  title: z.string().trim().min(3, "Title: at least 3 characters").max(200),
  statement: z.string().trim().min(10, "Problem statement: at least 10 characters").max(20000),
  difficulty: Difficulty,
  topics: z.string().max(300),
  languages: z.array(Language).min(1, "Pick at least one language"),
  starter_code: z.record(z.string(), z.string().max(5000)),
  constraints: z.string().max(2000),
  time_limit_ms: z.coerce.number().int().min(100).max(20000),
  memory_limit_kb: z.coerce.number().int().min(16000).max(1024000),
  tests: z.array(TestRow).min(2, "Add at least two tests"),
  reference_language: Language,
  reference_code: z.string().trim().min(1, "Add a reference solution (it is run on every test to verify the question)").max(20000),
  points: z.coerce.number().positive().max(100),
}).refine((f) => f.tests.some((t) => t.is_sample), { message: "Mark at least one test as a sample (shown to candidates)", path: ["tests"] })
  .refine((f) => f.tests.some((t) => !t.is_sample), { message: "Add at least one hidden test", path: ["tests"] });
export type CodingForm = z.infer<typeof CodingForm>;

export function emptyCoding(): CodingForm {
  return { title: "", statement: "", difficulty: "easy", topics: "", languages: ["python", "java", "cpp"], starter_code: {}, constraints: "",
           time_limit_ms: 2000, memory_limit_kb: 256000, points: 10, reference_language: "python", reference_code: "",
           tests: [{ input: "", expected_output: "", is_sample: true, weight: 1 }, { input: "", expected_output: "", is_sample: false, weight: 1 }] };
}

export function codingFromRow(r: QuestionRow, tests: { input: string; expected_output: string; is_sample: boolean; weight: number | string }[],
                              ref: { language: string; code: string } | null): CodingForm {
  return {
    title: r.title, statement: r.statement, difficulty: r.difficulty, topics: r.topics.join(", "),
    languages: r.languages.filter((l): l is CodingForm["languages"][number] => (LANGUAGES as readonly string[]).includes(l)),
    starter_code: r.starter_code ?? {}, constraints: r.constraints ?? "", time_limit_ms: r.time_limit_ms ?? 2000,
    memory_limit_kb: r.memory_limit_kb ?? 256000, points: Number(r.points),
    tests: tests.map((t) => ({ input: t.input, expected_output: t.expected_output, is_sample: t.is_sample, weight: Number(t.weight) })),
    reference_language: (ref?.language as CodingForm["reference_language"]) ?? "python", reference_code: ref?.code ?? "",
  };
}

export function codingPayload(orgId: string | null, f: CodingForm, id?: string) {
  const languages = Array.from(new Set([...f.languages, f.reference_language]));
  return {
    ...(id ? { id } : {}), org_id: orgId, type: "coding", title: f.title.trim(), statement: f.statement.trim(), difficulty: f.difficulty,
    topics: splitTopics(f.topics), languages,
    starter_code: Object.fromEntries(languages.map((l) => [l, f.starter_code[l] ?? ""])),
    constraints: f.constraints.trim(), time_limit_ms: f.time_limit_ms, memory_limit_kb: f.memory_limit_kb, points: f.points,
    tests: f.tests, reference: { language: f.reference_language, code: f.reference_code },
  };
}

/** First zod message, for a form-level error line. */
export function firstError(e: z.ZodError): string {
  return e.issues[0]?.message ?? "Please check the form.";
}

// ── Assessments (tests) ──────────────────────────────────────────────────────
export const PoolRule = z.object({
  difficulty: z.union([Difficulty, z.literal("")]),
  topics: z.string().max(300),
  count: z.coerce.number().int().min(1, "Count must be at least 1").max(50),
});
export type PoolRule = z.infer<typeof PoolRule>;

export const SectionForm = z.object({
  type: z.enum(["coding", "mcq"]),
  title: z.string().trim().min(1, "Every section needs a title").max(120),
  pick: z.array(PoolRule),
  question_ids: z.array(z.string().uuid()),
}).refine((s) => s.pick.length > 0 || s.question_ids.length > 0, { message: "Each section needs a pool rule or chosen questions" });
export type SectionForm = z.infer<typeof SectionForm>;

export const AssessmentForm = z.object({
  title: z.string().trim().min(3, "Title: at least 3 characters").max(200),
  duration_min: z.coerce.number().int().min(5, "At least 5 minutes").max(300, "At most 300 minutes"),
  languages: z.array(Language).min(1, "Pick at least one language"),
  randomize: z.boolean(),
  shuffle_options: z.boolean(),
  negative_marking: z.coerce.number().min(0).max(1, "Negative marking is a fraction of the question's points (0 to 1)"),
  proctoring_policy: ProctoringPolicy,
  strict_max_violations: z.coerce.number().int().min(1).max(50),
  practice_enabled: z.boolean(),
  late_join_min: z.union([z.coerce.number().int().min(0).max(600), z.literal("")]),
  status: z.enum(["draft", "ready", "archived"]),
  sections: z.array(SectionForm).min(1, "Add at least one section"),
});
export type AssessmentForm = z.infer<typeof AssessmentForm>;

export interface AssessmentRow {
  id: string; org_id: string; title: string; duration_min: number; languages: string[]; randomize: boolean; shuffle_options: boolean;
  negative_marking: number | string; proctoring_policy: string; strict_max_violations: number; practice_enabled: boolean;
  late_join_min: number | null; status: "draft" | "ready" | "archived"; created_at: string; updated_at: string;
  sections: { type: "coding" | "mcq"; title: string; pick?: { difficulty?: string; topics?: string[]; count: number }[]; question_ids?: string[] }[];
}

export function emptyAssessment(): AssessmentForm {
  return { title: "", duration_min: 60, languages: ["python", "java", "cpp", "javascript"], randomize: true, shuffle_options: true,
           negative_marking: 0, proctoring_policy: "standard", strict_max_violations: 3, practice_enabled: false, late_join_min: "",
           status: "draft", sections: [{ type: "coding", title: "Coding", pick: [{ difficulty: "easy", topics: "", count: 1 }], question_ids: [] }] };
}

export function assessmentFromRow(r: AssessmentRow): AssessmentForm {
  return {
    title: r.title, duration_min: r.duration_min,
    languages: r.languages.filter((l): l is AssessmentForm["languages"][number] => (LANGUAGES as readonly string[]).includes(l)),
    randomize: r.randomize, shuffle_options: r.shuffle_options, negative_marking: Number(r.negative_marking),
    proctoring_policy: r.proctoring_policy as AssessmentForm["proctoring_policy"], strict_max_violations: r.strict_max_violations,
    practice_enabled: r.practice_enabled, late_join_min: r.late_join_min ?? "", status: r.status,
    sections: r.sections.map((s) => ({
      type: s.type, title: s.title, question_ids: s.question_ids ?? [],
      pick: (s.pick ?? []).map((p) => ({ difficulty: (p.difficulty as PoolRule["difficulty"]) ?? "", topics: (p.topics ?? []).join(", "), count: p.count })),
    })),
  };
}

export function assessmentRow(orgId: string, f: AssessmentForm) {
  return {
    org_id: orgId, title: f.title.trim(), duration_min: f.duration_min, languages: f.languages, randomize: f.randomize,
    shuffle_options: f.shuffle_options, negative_marking: f.negative_marking, proctoring_policy: f.proctoring_policy,
    strict_max_violations: f.strict_max_violations, practice_enabled: f.practice_enabled,
    late_join_min: f.late_join_min === "" ? null : f.late_join_min, status: f.status,
    sections: f.sections.map((s) => ({
      type: s.type, title: s.title.trim(),
      ...(s.pick.length ? { pick: s.pick.map((p) => ({ ...(p.difficulty ? { difficulty: p.difficulty } : {}), topics: splitTopics(p.topics), count: p.count })) } : {}),
      ...(s.question_ids.length ? { question_ids: s.question_ids } : {}),
    })),
  };
}

/** "2 easy arrays + 1 medium strings" */
export function describeRule(p: PoolRule): string {
  const topics = splitTopics(p.topics);
  return [String(p.count), p.difficulty || "any-difficulty", topics.length ? topics.join("/") : "any topic"].join(" ");
}

type PoolQuestion = Pick<QuestionRow, "id" | "type" | "status" | "difficulty" | "topics" | "languages">;

function poolOf<Q extends Omit<PoolQuestion, "id">>(bank: Q[], type: "coding" | "mcq", rule: PoolRule, languages: string[]): Q[] {
  const topics = splitTopics(rule.topics);
  return bank.filter((q) => q.status === "verified" && q.type === type
    && (!rule.difficulty || q.difficulty === rule.difficulty)
    && (topics.length === 0 || q.topics.some((t) => topics.includes(t.toLowerCase())))
    && (type !== "coding" || q.languages.some((l) => languages.includes(l))));
}

/** Verified questions a pool rule can draw from (same rule as the server: type, difficulty, topic overlap, language overlap). */
export function poolMatches(bank: Omit<PoolQuestion, "id">[], type: "coding" | "mcq", rule: PoolRule, languages: string[]): number {
  return poolOf(bank, type, rule, languages).length;
}

export interface DrawCheck {
  /** Per section, per rule: questions the rule gets for every candidate, whatever earlier rules happened to draw. */
  guaranteed: number[][];
  /** Chosen question ids an earlier pool rule may take first (the server then skips them). */
  fixedAtRisk: string[];
  /** Any rule can come up short, or a chosen question can be lost. */
  short: boolean;
}

/**
 * Worst case of _b2b_build_question_set: sections in order, chosen questions first, then rules in order, and nothing
 * is drawn twice. The server silently gives fewer questions when a pool runs dry, so overlapping rules (or a rule
 * overlapping chosen questions) can short a candidate even when each rule alone has enough.
 */
export function checkDraw(bank: PoolQuestion[], sections: Pick<SectionForm, "type" | "pick" | "question_ids">[], languages: string[]): DrawCheck {
  const byId = new Map(bank.map((q) => [q.id, q]));
  const taken = new Set<string>();                       // chosen questions placed so far
  const earlier: { pool: Set<string>; count: number }[] = [];
  const guaranteed: number[][] = [];
  const fixedAtRisk: string[] = [];
  for (const s of sections) {
    for (const id of s.question_ids) {
      const q = byId.get(id);
      if (!q || q.status !== "verified" || q.type !== s.type || taken.has(id)) continue;
      if (earlier.some((r) => r.pool.has(id))) fixedAtRisk.push(id);
      taken.add(id);
    }
    guaranteed.push(s.pick.map((rule) => {
      const pool = new Set(poolOf(bank, s.type, rule, languages).map((q) => q.id).filter((id) => !taken.has(id)));
      let lost = 0;
      for (const r of earlier) {
        let overlap = 0;
        for (const id of r.pool) if (pool.has(id)) overlap++;
        lost += Math.min(r.count, overlap);
      }
      earlier.push({ pool, count: rule.count });
      return Math.max(0, pool.size - lost);
    }));
  }
  const short = fixedAtRisk.length > 0 || guaranteed.some((g, si) => g.some((n, ri) => n < sections[si].pick[ri].count));
  return { guaranteed, fixedAtRisk, short };
}
