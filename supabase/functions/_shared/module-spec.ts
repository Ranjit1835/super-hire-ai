// ─── Interview module spec ────────────────────────────────────────────────────
// Pure TS, shared by the admin form and the interview engine. Mirrors the
// public.b2b_valid_module_spec() CHECK in the database (the backstop).

export type ModuleType = "skill" | "company_pack" | "hr";

export interface ModuleSpec {
  name: string;
  type: ModuleType;
  description?: string;
  topics: string[];
  pass_threshold: number; // 0–10, average score needed to "pass" the module
  max_turns: number;      // questions asked by the interviewer
  max_minutes: number;
  style_notes?: string;   // how to interview; injected into the interviewer prompt as data
}

export const MODULE_LIMITS = {
  name: [2, 80],
  description: 300,
  styleNotes: 2000,
  topics: [1, 15],
  topic: [2, 80],
  passThreshold: [0, 10],
  maxTurns: [3, 30],
  maxMinutes: [3, 60],
} as const;

export const MODULE_TYPE_LABEL: Record<ModuleType, string> = {
  skill: "Skill",
  company_pack: "Company-style practice",
  hr: "HR / behavioural",
};

export const COMPANY_PACK_DISCLAIMER =
  "Style practice modelled on commonly reported fresher interview patterns. Not an official interview and not affiliated with the company.";

export type ModuleErrors = Partial<Record<keyof ModuleSpec | "form", string>>;

const isInt = (n: unknown) => typeof n === "number" && Number.isInteger(n);

/** Normalise (trim, collapse whitespace, drop empty topics) then validate. */
export function normalizeModuleSpec(input: unknown): { spec: ModuleSpec | null; errors: ModuleErrors } {
  const errors: ModuleErrors = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { spec: null, errors: { form: "Module must be an object" } };
  }
  const o = input as Record<string, unknown>;
  const text = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");
  const notes = (v: unknown) => (typeof v === "string" ? v.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim() : "");

  const name = text(o.name);
  if (name.length < MODULE_LIMITS.name[0]) errors.name = "Give the module a name";
  else if (name.length > MODULE_LIMITS.name[1]) errors.name = `Name must be at most ${MODULE_LIMITS.name[1]} characters`;

  const type = o.type as ModuleType;
  if (!["skill", "company_pack", "hr"].includes(type)) errors.type = "Choose a module type";

  const description = text(o.description);
  if (description.length > MODULE_LIMITS.description) errors.description = `At most ${MODULE_LIMITS.description} characters`;

  const style_notes = notes(o.style_notes);
  if (style_notes.length > MODULE_LIMITS.styleNotes) errors.style_notes = `At most ${MODULE_LIMITS.styleNotes} characters`;

  const topics = Array.isArray(o.topics) ? o.topics.map(text).filter(Boolean) : [];
  if (topics.length < MODULE_LIMITS.topics[0]) errors.topics = "Add at least one topic";
  else if (topics.length > MODULE_LIMITS.topics[1]) errors.topics = `At most ${MODULE_LIMITS.topics[1]} topics`;
  else if (topics.some((t) => t.length < MODULE_LIMITS.topic[0] || t.length > MODULE_LIMITS.topic[1])) {
    errors.topics = `Each topic must be ${MODULE_LIMITS.topic[0]}–${MODULE_LIMITS.topic[1]} characters`;
  } else if (new Set(topics.map((t) => t.toLowerCase())).size !== topics.length) {
    errors.topics = "Topics must be unique";
  }

  const pass_threshold = Number(o.pass_threshold);
  if (!Number.isFinite(pass_threshold) || pass_threshold < 0 || pass_threshold > 10) {
    errors.pass_threshold = "Pass mark must be between 0 and 10";
  }
  const max_turns = Number(o.max_turns);
  if (!isInt(max_turns) || max_turns < MODULE_LIMITS.maxTurns[0] || max_turns > MODULE_LIMITS.maxTurns[1]) {
    errors.max_turns = `Questions must be a whole number from ${MODULE_LIMITS.maxTurns[0]} to ${MODULE_LIMITS.maxTurns[1]}`;
  }
  const max_minutes = Number(o.max_minutes);
  if (!isInt(max_minutes) || max_minutes < MODULE_LIMITS.maxMinutes[0] || max_minutes > MODULE_LIMITS.maxMinutes[1]) {
    errors.max_minutes = `Duration must be a whole number from ${MODULE_LIMITS.maxMinutes[0]} to ${MODULE_LIMITS.maxMinutes[1]} minutes`;
  }
  if (!errors.max_turns && !errors.max_minutes && max_minutes * 60 / max_turns < 30) {
    errors.max_turns = "That's under 30 seconds per question. Reduce questions or add minutes.";
  }

  if (Object.keys(errors).length) return { spec: null, errors };
  return {
    spec: {
      name, type, topics, pass_threshold: Math.round(pass_threshold * 10) / 10, max_turns, max_minutes,
      ...(description ? { description } : {}),
      ...(style_notes ? { style_notes } : {}),
    },
    errors,
  };
}

export function emptyModuleSpec(type: ModuleType = "skill"): ModuleSpec {
  return { name: "", type, topics: [], pass_threshold: 6, max_turns: 12, max_minutes: 15, description: "", style_notes: "" };
}
