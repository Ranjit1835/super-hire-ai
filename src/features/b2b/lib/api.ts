import { supabase } from "@/integrations/supabase/client";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export class ApiError extends Error {
  status: number;
  code: string;
  data?: unknown;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** POST to a B2B edge function. B2B functions return real HTTP status codes. */
export async function callB2B<T>(
  fn: string, body: Record<string, unknown>, opts: { auth?: boolean; timeoutMs?: number } = {},
): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json", apikey: SUPABASE_KEY };
  if (opts.auth !== false) {
    const { data } = await supabase.auth.getSession();
    if (data.session) headers.Authorization = `Bearer ${data.session.access_token}`;
  }
  let res: Response;
  const ctrl = new AbortController();
  const timer = opts.timeoutMs ? setTimeout(() => ctrl.abort(), opts.timeoutMs) : null;
  try {
    res = await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
      method: "POST", headers, body: JSON.stringify(body), signal: ctrl.signal,
    });
  } catch {
    throw new ApiError(0, "NETWORK", "Can't reach HiResume. Check your internet connection and try again.");
  } finally {
    if (timer) clearTimeout(timer);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new ApiError(res.status, data?.code ?? "ERROR", data?.error ?? `Request failed (${res.status})`);
    err.data = data;
    throw err;
  }
  return data as T;
}

// ── b2b-invites ──────────────────────────────────────────────────────────────
export interface ImportRowResult { row: number; status: "invited" | "skipped" | "error"; reason?: string }
export interface InvitedStudent { row: number; invite_id: string; full_name: string; email: string; roll_no: string; link: string }
export interface EmailOutcome { sent: number; failed: number; error: string | null }
export interface ImportResponse { results: ImportRowResult[]; invited: InvitedStudent[]; email: EmailOutcome }

export interface InvitePreview {
  status: "pending" | "accepted" | "revoked" | "expired";
  full_name: string;
  email: string;
  roll_no: string;
  batch: string | null;
  org: { id: string; name: string; type: string; logo_url: string | null; is_demo: boolean };
  has_account: boolean;
  consent: { version: string; text: string };
}

export const invitesApi = {
  import: (orgId: string, rows: unknown[], sendEmail: boolean) =>
    callB2B<ImportResponse>("b2b-invites", { action: "import", orgId, rows, sendEmail }),
  resend: (inviteId: string, sendEmail: boolean) =>
    callB2B<{ link: string; email: EmailOutcome }>("b2b-invites", { action: "resend", inviteId, sendEmail }),
  revoke: (inviteId: string) => callB2B<{ ok: boolean; reason?: string }>("b2b-invites", { action: "revoke", inviteId }),
  preview: (token: string) => callB2B<InvitePreview>("b2b-invites", { action: "preview", token }, { auth: false }),
  register: (token: string, password: string) =>
    callB2B<{ ok: true; org_id: string; email: string }>("b2b-invites", { action: "register", token, password, consent: true }, { auth: false }),
  accept: (token: string) => callB2B<{ ok: true; org_id: string }>("b2b-invites", { action: "accept", token, consent: true }),
};

/** Remembers an invite across OAuth / email-confirmation redirects. */
export const PENDING_INVITE_KEY = "hiresume_pending_invite";
export function rememberPendingInvite(token: string) {
  try { localStorage.setItem(PENDING_INVITE_KEY, token); } catch { /* storage blocked */ }
}
export function takePendingInvite(): string | null {
  try {
    const t = localStorage.getItem(PENDING_INVITE_KEY);
    if (t) localStorage.removeItem(PENDING_INVITE_KEY);
    return t;
  } catch {
    return null;
  }
}

// ── b2b-interview ────────────────────────────────────────────────────────────
export interface InterviewPayload {
  interview: {
    id: string; module_id: string; module_name: string;
    status: "in_progress" | "completed" | "abandoned" | "cancelled";
    end_reason: string | null; started_at: string; deadline_at: string; server_now: string;
    turn_count: number; max_turns: number; topics_total: number; topics_covered: number; current_topic: string | null;
  } | null;
  question?: string | null;
  closing?: string | null;
  transcript?: Array<{ turn: number; role: "interviewer" | "student"; content: string }>;
  resumed?: boolean;
  refunded?: boolean;
  duplicate?: boolean;
  credit?: { remaining?: number; limit?: number } | null;
}

const TURN_TIMEOUT_MS = 45_000; // server allows ~20 s per model call + one regenerate

export const interviewApi = {
  current: () => callB2B<InterviewPayload>("b2b-interview", { action: "current" }, { timeoutMs: 15_000 }),
  start: (moduleId: string, clientMeta: Record<string, unknown>) =>
    callB2B<InterviewPayload>("b2b-interview", { action: "start", moduleId, clientMeta }, { timeoutMs: TURN_TIMEOUT_MS }),
  resume: (interviewId: string) =>
    callB2B<InterviewPayload>("b2b-interview", { action: "resume", interviewId }, { timeoutMs: 15_000 }),
  answer: (a: { interviewId: string; clientTurnId: string; turnCount: number; answer: string; meta: Record<string, unknown> }) =>
    callB2B<InterviewPayload>("b2b-interview", { action: "answer", ...a }, { timeoutMs: TURN_TIMEOUT_MS }),
  end: (interviewId: string) =>
    callB2B<InterviewPayload>("b2b-interview", { action: "end", interviewId }, { timeoutMs: 15_000 }),
};

// ── b2b-evaluate ─────────────────────────────────────────────────────────────
export interface EvaluationRow {
  id: string;
  interview_id: string;
  evaluator_version: string;
  status: "pending" | "completed" | "failed";
  result: import("./shared").EvaluationResult | null;
  audio_metrics: import("./shared").AudioMetrics | null;
  overall_score: number | null;
  readiness_level: "not_ready" | "developing" | "ready" | null;
  primary_gap: string | null;
  completed_at: string | null;
}
export interface EvaluationResponse {
  status: "completed" | "pending" | "failed" | "unavailable" | "none" | "in_progress";
  evaluation: EvaluationRow | null;
  reason?: string;
  error?: string | null;
}

export const evaluateApi = {
  /** Runs (or joins) the evaluation; can take up to ~1 minute. */
  evaluate: (interviewId: string) =>
    callB2B<EvaluationResponse>("b2b-evaluate", { action: "evaluate", interviewId }, { timeoutMs: 120_000 }),
  get: (interviewId: string) =>
    callB2B<EvaluationResponse>("b2b-evaluate", { action: "get", interviewId }, { timeoutMs: 15_000 }),
};

// ── Public readiness test ────────────────────────────────────────────────────
export interface PublicTestInfo {
  org: { name: string; slug: string; type: string; logo_url: string | null; is_demo: boolean; cta_label: string | null; cta_url: string | null };
  available: boolean;
  modules: Array<{ id: string; name: string; type: string; description: string | null; minutes: number; questions: number }>;
}

/** Ensure there is a session for the visitor: a real account if signed in, otherwise anonymous. */
export async function ensureVisitorSession(): Promise<void> {
  const { data } = await supabase.auth.getSession();
  if (data.session) return;
  const { error } = await supabase.auth.signInAnonymously();
  if (error) throw new ApiError(error.status ?? 0, "ANON_AUTH", "Couldn't start a test session. Please refresh and try again.");
}

export const publicTestApi = {
  info: async (slug: string): Promise<PublicTestInfo | null> => {
    const { data, error } = await supabase.rpc("public_test_info" as never, { _slug: slug } as never);
    if (error) throw new ApiError(0, "NETWORK", "Couldn't load this test. Check your connection and try again.");
    return (data as PublicTestInfo | null) ?? null;
  },
  start: (a: { slug: string; moduleId: string; lead: Record<string, string>; clientMeta: Record<string, unknown> }) =>
    callB2B<{ interviewId: string }>("b2b-public-test", { action: "start", consent: true, ...a }, { timeoutMs: 45_000 }),
};
