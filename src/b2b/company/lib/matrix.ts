// Skills-matrix editing: a flat list of rows the recruiter edits, validated against the shared SkillsMatrix schema.
import { SkillsMatrix } from "../../../../supabase/functions/_shared/contracts/company";

export type Seniority = SkillsMatrix["seniority"];
export interface SkillRow { key: string; skill: string; weight: number; kind: "must" | "nice" }
export interface MatrixForm { rows: SkillRow[]; seniority: Seniority; summary: string }

let seq = 0;
const key = () => `s${++seq}`;

export const SENIORITY: { value: Seniority; label: string }[] = [
  { value: "intern", label: "Intern" }, { value: "junior", label: "Junior (0–2 years)" }, { value: "mid", label: "Mid (2–5 years)" },
  { value: "senior", label: "Senior (5+ years)" }, { value: "lead", label: "Lead" },
];

export const emptyMatrix = (): MatrixForm => ({ rows: [], seniority: "mid", summary: "" });

export function fromMatrix(m: Partial<SkillsMatrix> | null | undefined): MatrixForm {
  if (!m || !Array.isArray(m.must_have)) return emptyMatrix();
  return {
    rows: [
      ...m.must_have.map((s) => ({ key: key(), skill: s.skill, weight: s.weight, kind: "must" as const })),
      ...(m.nice_to_have ?? []).map((s) => ({ key: key(), skill: s.skill, weight: s.weight, kind: "nice" as const })),
    ],
    seniority: m.seniority ?? "mid",
    summary: m.summary ?? "",
  };
}

export function toMatrix(f: MatrixForm): SkillsMatrix {
  const pick = (k: SkillRow["kind"]) => f.rows.filter((r) => r.kind === k && r.skill.trim())
    .map((r) => ({ skill: r.skill.trim(), weight: clampWeight(r.weight) }));
  return { must_have: pick("must"), nice_to_have: pick("nice"), seniority: f.seniority, ...(f.summary.trim() ? { summary: f.summary.trim() } : {}) };
}

export const clampWeight = (w: number) => Math.min(5, Math.max(1, Math.round(Number.isFinite(w) ? w : 3)));

export function addSkill(f: MatrixForm, kind: SkillRow["kind"], skill = ""): MatrixForm {
  return { ...f, rows: [...f.rows, { key: key(), skill, weight: kind === "must" ? 4 : 2, kind }] };
}
export function updateSkill(f: MatrixForm, k: string, patch: Partial<Omit<SkillRow, "key">>): MatrixForm {
  return { ...f, rows: f.rows.map((r) => (r.key === k ? { ...r, ...patch, ...(patch.weight !== undefined ? { weight: clampWeight(patch.weight) } : {}) } : r)) };
}
export function removeSkill(f: MatrixForm, k: string): MatrixForm {
  return { ...f, rows: f.rows.filter((r) => r.key !== k) };
}

/** Plain-English problems with the matrix (empty list = valid). */
export function matrixErrors(f: MatrixForm): string[] {
  const errs: string[] = [];
  const named = f.rows.filter((r) => r.skill.trim());
  if (!named.some((r) => r.kind === "must")) errs.push("Add at least one must-have skill.");
  if (named.filter((r) => r.kind === "must").length > 15) errs.push("Keep must-have skills to 15 or fewer.");
  if (named.filter((r) => r.kind === "nice").length > 15) errs.push("Keep nice-to-have skills to 15 or fewer.");
  const seen = new Set<string>();
  for (const r of named) {
    const k = r.skill.trim().toLowerCase();
    if (seen.has(k)) errs.push(`"${r.skill.trim()}" is listed twice.`);
    seen.add(k);
    if (r.skill.trim().length > 80) errs.push(`"${r.skill.trim().slice(0, 20)}…" is too long (80 characters max).`);
  }
  if (f.summary.length > 600) errs.push("Keep the summary under 600 characters.");
  if (!errs.length && !SkillsMatrix.safeParse(toMatrix(f)).success) errs.push("The skills matrix isn't valid.");
  return errs;
}
