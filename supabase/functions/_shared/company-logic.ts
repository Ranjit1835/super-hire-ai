// Startup portal logic shared by the b2b-company / b2b-candidate edge functions and the browser (pure TypeScript:
// no Deno or DOM APIs). AI match score, report shaping, consent wording, email masking and pipeline export rows.
import type { CandidateReport, PipelineRow, SkillsMatrix } from "./contracts/company.ts";

type Json = Record<string, unknown>;

// ── Consent ───────────────────────────────────────────────────────────────────────────────────────────────
export const CANDIDATE_CONSENT_VERSION = "candidate-2026-10-v1";
export type CandidatePurpose =
  | "account" | "assessment" | "interview_audio" | "recording" | "proctoring_screen" | "proctoring_camera" | "proctoring_audio";

/** Itemised purposes for a role, in the order shown (same rule as _b2b_required_purposes in SQL). */
export function requiredPurposes(o: { hasInterview: boolean; proctored: boolean }): CandidatePurpose[] {
  return [
    "account", "assessment",
    ...(o.hasInterview ? (["interview_audio", "recording"] as const) : []),
    ...(o.proctored ? (["proctoring_screen", "proctoring_camera", "proctoring_audio"] as const) : []),
  ];
}

/** The exact text shown for each purpose; stored verbatim with the version when the candidate agrees. */
export function consentText(purpose: CandidatePurpose, company: string, retentionDays = 90): string {
  switch (purpose) {
    case "account": return `HiResume may use my name, email and phone to run this assessment for ${company}.`;
    case "assessment": return `My coding answers are scored automatically and shared with ${company}'s hiring team, together with an AI match score. AI does not pass or fail me; ${company}'s team decides.`;
    case "interview_audio": return `During the AI interview my microphone is used to capture my answers, which are turned into text and scored by AI.`;
    case "recording": return `The interview transcript is kept and shared with ${company}'s hiring team for up to ${retentionDays} days after the role closes (scores and reports for the contract period).`;
    case "proctoring_screen": return `My entire screen is shared during the test and interview; periodic screenshots are saved as evidence for human review (kept ${retentionDays} days).`;
    case "proctoring_camera": return `My camera is used to check that I'm present and alone (face checks run in my browser); periodic webcam snapshots are saved for human review (kept ${retentionDays} days).`;
    case "proctoring_audio": return `My microphone is checked for speech during the coding test. Flags are evidence for a human reviewer, never an automatic decision.`;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────────────────────────────────
export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const keep = local.length <= 2 ? local.slice(0, 1) : local.slice(0, 2);
  return `${keep}${"*".repeat(Math.max(3, local.length - keep.length))}@${domain}`;
}

const n = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};
const round1 = (x: number) => Math.round(x * 10) / 10;

// ── AI match score ────────────────────────────────────────────────────────────────────────────────────────
/** A piece of scored evidence (0–100) from the coding test or the interview. */
export interface Signal { source: "coding" | "mcq" | "interview"; label: string; score: number; evidence: string[] }

const STOP = new Set(["and", "the", "for", "with", "of", "in", "on", "to", "a", "an", "or", "skills", "knowledge", "experience", "basics", "general"]);
export function tokens(s: string): string[] {
  return s.toLowerCase().replace(/c\+\+/g, "cpp").replace(/c#/g, "csharp").replace(/[^a-z0-9.]+/g, " ").split(" ")
    .map((t) => t.replace(/^\.+|\.+$/g, "")).filter((t) => t.length >= 2 && !STOP.has(t));
}

/** Does a signal label speak to a skill? Whole-phrase containment or a shared meaningful token. */
export function matches(skill: string, label: string): boolean {
  const a = tokens(skill);
  const b = tokens(label);
  if (!a.length || !b.length) return false;
  const as = a.join(" ");
  const bs = b.join(" ");
  if (as.includes(bs) || bs.includes(as)) return true;
  return a.some((t) => t.length >= 3 && b.includes(t));
}

export function recommendationFor(score: number | null): "strong" | "good" | "borderline" | "not_yet" | null {
  if (score === null) return null;
  if (score >= 80) return "strong";
  if (score >= 65) return "good";
  if (score >= 50) return "borderline";
  return "not_yet";
}

export interface MatchResult {
  score: number | null;
  recommendation: ReturnType<typeof recommendationFor>;
  coverage: number;            // share of skill weight with direct evidence (0–1)
  overall: number | null;      // mean of the coding % and the interview overall
  skills: CandidateReport["skills"];
}

/**
 * Weighted match of evidence against the skills matrix (AI recommendation only; humans decide):
 *   skill score   = mean of matching signals; must-haves count double their weight
 *   skills part   = weighted mean over skills with evidence
 *   overall       = mean of the coding % and the interview overall score
 *   match         = 0.6 × skills part + 0.4 × overall (either alone when the other is missing)
 */
export function computeMatch(matrix: SkillsMatrix | null, signals: Signal[], overallParts: Array<number | null>): MatchResult {
  const parts = overallParts.filter((x): x is number => x !== null);
  const overall = parts.length ? round1(parts.reduce((a, b) => a + b, 0) / parts.length) : null;
  const list = matrix ? [
    ...matrix.must_have.map((s) => ({ ...s, kind: "must" as const })),
    ...matrix.nice_to_have.map((s) => ({ ...s, kind: "nice" as const })),
  ] : [];
  let wSum = 0;
  let wHit = 0;
  let acc = 0;
  const skills = list.map((s) => {
    const hits = signals.filter((g) => matches(s.skill, g.label));
    const w = s.weight * (s.kind === "must" ? 2 : 1);
    wSum += w;
    if (!hits.length) return { skill: s.skill, kind: s.kind, weight: s.weight, score: null, evidence: [] as string[] };
    const score = round1(hits.reduce((a, h) => a + h.score, 0) / hits.length);
    wHit += w;
    acc += w * score;
    const evidence = hits.flatMap((h) => [`${sourceLabel(h.source)}: ${h.label} ${Math.round(h.score)}%`, ...h.evidence.slice(0, 2)]).slice(0, 6);
    return { skill: s.skill, kind: s.kind, weight: s.weight, score, evidence };
  });
  const skillPart = wHit > 0 ? acc / wHit : null;
  const score = skillPart !== null && overall !== null ? round1(0.6 * skillPart + 0.4 * overall)
    : skillPart !== null ? round1(skillPart) : overall;
  return { score, recommendation: recommendationFor(score), coverage: wSum ? round1(wHit / wSum) : 0, overall, skills };
}

function sourceLabel(s: Signal["source"]): string {
  return s === "coding" ? "Coding test" : s === "mcq" ? "MCQ" : "Interview";
}

// ── Report shaping (from _b2b_report_json) ────────────────────────────────────────────────────────────────
const BANDS = ["high", "medium", "low"] as const;
type Band = (typeof BANDS)[number];
const band = (v: unknown): Band | null => (BANDS as readonly string[]).includes(String(v)) ? (v as Band) : null;
const BAND_RANK: Record<Band, number> = { high: 0, medium: 1, low: 2 };
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const arr = (v: unknown): Json[] => (Array.isArray(v) ? (v.filter((x) => x && typeof x === "object") as Json[]) : []);

function scoredItems(result: unknown): Array<{ label: string; score: number | null; quotes: string[]; reason: string }> {
  if (!result || typeof result !== "object") return [];
  const r = result as Json;
  const out: Array<{ label: string; score: number | null; quotes: string[]; reason: string }> = [];
  for (const key of ["dimensions", "per_topic"]) {
    const group = r[key];
    if (!group || typeof group !== "object") continue;
    for (const [label, item] of Object.entries(group as Json)) {
      if (!item || typeof item !== "object") continue;
      const it = item as Json;
      const raw = n(it.score);
      out.push({
        label: label.replace(/_/g, " "),
        score: raw === null ? null : round1(raw <= 10 ? raw * 10 : raw),
        quotes: Array.isArray(it.evidence) ? it.evidence.filter((q): q is string => typeof q === "string").slice(0, 3) : [],
        reason: str(it.reason) ?? "",
      });
    }
  }
  return out;
}

/** Signals for the match score from the raw report (dimension scores + interview evaluation items). */
export function signalsFrom(raw: Json): { signals: Signal[]; codingPct: number | null; interviewOverall: number | null } {
  const signals: Signal[] = [];
  for (const d of arr(raw.dimension_scores)) {
    const score = n(d.score);
    if (score === null) continue;
    const dim = String(d.dimension ?? "");
    const topic = str(d.topic);
    if (d.source_type === "assessment") {
      signals.push({ source: dim === "coding" ? "coding" : "mcq", label: topic ?? dim.replace(/_/g, " "), score, evidence: [] });
    } else if (d.source_type === "interview") {
      signals.push({ source: "interview", label: topic ?? dim.replace(/_/g, " "), score, evidence: [] });
    }
  }
  const iv = raw.interview as Json | null | undefined;
  const ev = iv?.evaluation as Json | null | undefined;
  for (const it of scoredItems(ev?.result)) {
    if (it.score !== null) signals.push({ source: "interview", label: it.label, score: it.score, evidence: it.quotes.map((q) => `“${q}”`) });
  }
  const a = raw.attempt as Json | null | undefined;
  const score = n(a?.score);
  const max = n(a?.max_score);
  const done = a && !["not_started", "in_progress"].includes(String(a.status));
  const codingPct = done && score !== null && max ? round1((score / max) * 100) : null;
  const ovr = n(ev?.overall_score);
  const interviewOverall = ev?.status === "completed" && ovr !== null ? round1(ovr * 10) : null;
  // The coding test is evidence for any coding-flavoured skill in the matrix.
  if (codingPct !== null) {
    const langs = new Set(arr(a?.questions).map((q) => str(q.language)).filter((x): x is string => !!x));
    signals.push({ source: "coding", label: ["coding", "programming", "problem solving", "algorithms", "data structures", ...langs].join(" "), score: codingPct, evidence: [] });
  }
  return { signals, codingPct, interviewOverall };
}

export function toSkillsMatrix(v: unknown): SkillsMatrix | null {
  if (!v || typeof v !== "object") return null;
  const m = v as Json;
  if (!Array.isArray(m.must_have)) return null;
  const items = (x: unknown) => arr(x).map((s) => ({ skill: String(s.skill ?? ""), weight: n(s.weight) ?? 1 })).filter((s) => s.skill);
  return { must_have: items(m.must_have), nice_to_have: items(m.nice_to_have), seniority: (m.seniority as SkillsMatrix["seniority"]) ?? "mid" };
}

export function matchFromRaw(raw: Json): MatchResult {
  const role = (raw.role ?? {}) as Json;
  const { signals, codingPct, interviewOverall } = signalsFrom(raw);
  return computeMatch(toSkillsMatrix(role.skills_matrix), signals, [codingPct, interviewOverall]);
}

/** Contract-shaped report from the raw SQL JSON. `staff = false` for share links. */
export function shapeReport(raw: Json, staff: boolean): CandidateReport {
  const m = matchFromRaw(raw);
  const cand = (raw.candidate ?? {}) as Json;
  const role = (raw.role ?? {}) as Json;
  const a = raw.attempt as Json | null;
  const iv = raw.interview as Json | null;
  const ev = (iv?.evaluation ?? null) as Json | null;
  const qs = arr(a?.questions);
  const sessions = arr(raw.integrity).map((s) => ({
    sessionId: staff ? str(s.session_id) : null,
    kind: s.kind === "interview" ? "interview" as const : "coding" as const,
    score: n(s.score), band: band(s.band), flags: n(s.flags) ?? 0, review: str(s.review),
  }));
  const scored = sessions.filter((s) => s.score !== null);
  const worst = scored.length ? scored.reduce((x, y) => ((y.score as number) < (x.score as number) ? y : x)) : null;
  const banded = sessions.filter((s) => s.band);
  const worstBand = banded.length ? banded.reduce((x, y) => (BAND_RANK[y.band as Band] > BAND_RANK[x.band as Band] ? y : x)).band : null;
  const sum = (k: "passed" | "total") => qs.reduce((t, q) => t + (n(q[k]) ?? 0), 0);
  const aScore = n(a?.score);
  const aMax = n(a?.max_score);
  return {
    roleCandidateId: String(raw.role_candidate_id),
    stage: raw.stage as CandidateReport["stage"],
    decision: (raw.decision ?? null) as CandidateReport["decision"],
    invitedAt: String(raw.invited_at ?? ""),
    completedAt: str(raw.completed_at),
    candidate: { fullName: String(cand.full_name ?? ""), email: staff ? str(cand.email) : null, phone: staff ? str(cand.phone) : null },
    role: { id: String(role.id), title: String(role.title ?? ""), orgName: String(role.org_name ?? "") },
    matchScore: m.score,
    recommendation: m.recommendation,
    coverage: m.coverage,
    skills: m.skills,
    coding: a ? {
      attemptId: String(a.id), status: String(a.status), score: aScore, maxScore: aMax,
      pct: aScore !== null && aMax ? round1((aScore / aMax) * 100) : null,
      passed: sum("passed"), total: sum("total"),
      pending: a.grading === "pending" || qs.some((q) => q.status === "queued" || q.status === "running"),
      questions: qs.map((q) => ({
        title: String(q.title ?? ""), language: str(q.language), code: str(q.code),
        passed: n(q.passed), total: n(q.total), score: n(q.score), maxScore: n(q.max_score),
      })),
    } : null,
    interview: iv ? {
      interviewId: String(iv.id), status: String(iv.status),
      overall: ev?.status === "completed" && n(ev.overall_score) !== null ? round1((n(ev.overall_score) as number) * 10) : null,
      readiness: str(ev?.readiness_level), evaluationStatus: str(ev?.status),
      transcript: arr(iv.transcript).map((t) => ({ turn: n(t.turn) ?? 0, role: String(t.role ?? ""), content: String(t.content ?? "") })),
      evidence: scoredItems(ev?.result),
    } : null,
    integrity: { score: worst?.score ?? null, band: worstBand ?? null, sessions },
    comments: staff ? arr(raw.comments).map((c) => ({ id: String(c.id), author: String(c.author ?? "Team member"), body: String(c.body ?? ""), createdAt: String(c.created_at ?? "") })) : [],
    decisions: staff ? arr(raw.decisions).map((d) => ({
      decision: d.decision as CandidateReport["decisions"][number]["decision"], note: str(d.note), by: String(d.by ?? "Team member"), createdAt: String(d.created_at ?? ""),
    })) : [],
    evidenceIncluded: false,
  };
}

// ── Pipeline export ───────────────────────────────────────────────────────────────────────────────────────
export const PIPELINE_EXPORT_COLUMNS = [
  "Name", "Email", "Phone", "Stage", "Decision", "AI match score", "AI recommendation", "Coding %", "Interview",
  "Integrity score", "Integrity band", "Invited", "Completed",
] as const;
export const STAGE_LABEL: Record<string, string> = {
  invited: "Invited", in_progress: "In progress", completed: "Completed", shortlisted: "Shortlisted",
  rejected: "Rejected", hired: "Hired", withdrawn: "Withdrawn",
};
export function pipelineExportRows(rows: PipelineRow[]): Array<Array<string | number | null>> {
  const d = (s: string | null) => (s ? s.slice(0, 10) : null);
  return rows.map((r) => [
    r.full_name, r.email, r.phone, STAGE_LABEL[r.stage] ?? r.stage, r.decision, r.match_score, r.recommendation,
    r.coding, r.interview, r.integrity, r.integrity_band, d(r.invited_at), d(r.completed_at),
  ]);
}
