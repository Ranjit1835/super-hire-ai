// b2b-candidate logic (token flow + public share view) with I/O injected; unit-tested in Node with fakes.
// The token is the credential: only its SHA-256 is sent to SQL, which links it to one anonymous session.
import type { CandidateReport, CandidateState } from "../_shared/contracts/company.ts";
import { CANDIDATE_CONSENT_VERSION, consentText, maskEmail, requiredPurposes, shapeReport, type CandidatePurpose } from "../_shared/company-logic.ts";
import { notifyCompletions, type Mail } from "../_shared/company-mail.ts";

export class CandidateError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export interface Deps {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<unknown>;
  sha256: (s: string) => Promise<string>;
  sendMail: (m: Mail) => Promise<{ sent: boolean; error: string | null }>;
  emailConfigured: () => boolean;
  baseUrl: () => string;
  log?: (msg: string) => void;
}

type Json = Record<string, unknown>;
type Step = "consent" | "system_check" | "coding" | "interview" | "done";

const REASONS: Record<string, [number, string]> = {
  INVALID: [404, "This link isn't valid. Please use the latest link from your invitation email."],
  EXPIRED: [410, "This invitation has expired. Please ask the recruiter for a new link."],
  REVOKED: [410, "This invitation is no longer active."],
  CLOSED: [410, "This role is no longer accepting assessments."],
  NOT_ANONYMOUS: [409, "You're signed in to a HiResume account in this browser. Open the link in a private window, or sign out first."],
  OTHER_DEVICE: [409, "This link is already in use in another browser. Continue there, or ask the recruiter to send you a new link."],
  CONSENT_REQUIRED: [400, "Please agree to every item to continue."],
  CONSENT_CHANGED: [409, "The consent wording has been updated. Please reload the page."],
};
function refuse(reason: string | undefined): never {
  const [status, msg] = REASONS[reason ?? ""] ?? [400, "Request refused."];
  throw new CandidateError(status, reason ?? "REFUSED", msg);
}

export function toState(r: Json): CandidateState {
  const s = (r.steps ?? {}) as Record<string, string | null>;
  type S = CandidateState["steps"];
  return {
    roleCandidateId: String(r.role_candidate_id), jobRoleId: String(r.job_role_id),
    attemptId: (r.attempt_id as string | null) ?? null, interviewId: (r.interview_id as string | null) ?? null,
    completed: !!r.completed,
    steps: {
      consent: (s.consent ?? "todo") as S["consent"],
      system_check: (s.system_check ?? "todo") as S["system_check"],
      coding: (s.coding ?? null) as S["coding"],
      interview: (s.interview ?? null) as S["interview"],
      done: (s.done ?? "todo") as S["done"],
    },
  };
}

export function makeHandlers(deps: Deps) {
  const rpc = async <T = Json>(fn: string, args: Record<string, unknown>): Promise<T> => {
    try {
      return (await deps.rpc(fn, args)) as T;
    } catch (e) {
      if (/FORBIDDEN|insufficient_privilege/.test((e as Error).message)) refuse("OTHER_DEVICE");
      throw e;
    }
  };
  const log = deps.log ?? ((m: string) => console.error(m));
  const after = async (r: Json) => {
    if (r.just_completed) {
      try { await notifyCompletions({ ...deps, rpc, log }, String(r.job_role_id)); }
      catch (e) { log(`[b2b-candidate] completion notice failed: ${(e as Error).message}`); }
    }
    return toState(r);
  };
  const resolve = async (token: string) => rpc<Json>("b2b_resolve_candidate_token", { _token_hash: await deps.sha256(token) });

  return {
    async resolveInvite(input: { token: string }) {
      const r = await resolve(input.token);
      const status = String(r.status) as "valid" | "expired" | "revoked" | "closed" | "invalid";
      if (status === "invalid") return { status };
      const company = r.company as Json;
      const cand = r.candidate as Json;
      const hasCoding = !!r.has_coding;
      const hasInterview = !!r.has_interview;
      const proctored = r.policy !== "off";
      const steps: Step[] = ["consent", "system_check"];
      if (hasCoding) steps.push("coding");
      if (hasInterview) steps.push("interview");
      steps.push("done");
      return {
        status,
        company: { name: String(company.name), logoUrl: (company.logo_url as string | null) ?? null },
        role: { title: String((r.role as Json).title) },
        candidate: { fullName: String(cand.full_name), emailMasked: maskEmail(String(cand.email ?? "")) },
        steps,
        purposes: requiredPurposes({ hasInterview, proctored }),
        proctored,
      };
    },

    async startCandidate(input: { token: string }, user: string) {
      const r = await rpc<Json>("b2b_claim_candidate_token", { _token_hash: await deps.sha256(input.token), _user_id: user });
      if (!r.ok) refuse(String(r.reason));
      return after(r);
    },

    async state(input: { token: string }, user: string) {
      return after(await rpc<Json>("b2b_candidate_state", { _token_hash: await deps.sha256(input.token), _user_id: user }));
    },

    async recordConsent(input: { token: string; purposes: string[]; version: string }, user: string) {
      if (input.version !== CANDIDATE_CONSENT_VERSION) refuse("CONSENT_CHANGED");
      const info = await resolve(input.token);
      if (info.status !== "valid") refuse(String(info.status).toUpperCase());
      const company = String((info.company as Json).name);
      const consents = [...new Set(input.purposes)].map((p) => ({
        purpose: p, version: CANDIDATE_CONSENT_VERSION, text: consentText(p as CandidatePurpose, company),
      }));
      const r = await rpc<Json>("b2b_candidate_consent", { _token_hash: await deps.sha256(input.token), _user_id: user, _consents: consents });
      if (!r.ok) refuse(String(r.reason));
      return after(r);
    },

    async markSystemCheck(input: { token: string }, user: string) {
      return after(await rpc<Json>("b2b_candidate_system_checked", { _token_hash: await deps.sha256(input.token), _user_id: user }));
    },

    async viewShare(input: { token: string }): Promise<{ status: "ok" | "expired" | "revoked" | "invalid"; expiresAt?: string; report?: CandidateReport }> {
      const r = await rpc<Json>("b2b_view_share", { _token_hash: await deps.sha256(input.token) });
      const status = String(r.status) as "ok" | "expired" | "revoked" | "invalid";
      if (status !== "ok" || !r.report) return { status: status === "ok" ? "invalid" : status };
      return { status, expiresAt: String(r.expires_at), report: shapeReport(r.report as Json, false) };
    },
  };
}
