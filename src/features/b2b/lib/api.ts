import { supabase } from "@/integrations/supabase/client";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** POST to a B2B edge function. B2B functions return real HTTP status codes. */
export async function callB2B<T>(fn: string, body: Record<string, unknown>, opts: { auth?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json", apikey: SUPABASE_KEY };
  if (opts.auth !== false) {
    const { data } = await supabase.auth.getSession();
    if (data.session) headers.Authorization = `Bearer ${data.session.access_token}`;
  }
  let res: Response;
  try {
    res = await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, { method: "POST", headers, body: JSON.stringify(body) });
  } catch {
    throw new ApiError(0, "NETWORK", "Can't reach HiResume. Check your internet connection and try again.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data?.code ?? "ERROR", data?.error ?? `Request failed (${res.status})`);
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
