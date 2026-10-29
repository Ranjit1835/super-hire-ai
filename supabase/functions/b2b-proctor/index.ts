// b2b-proctor — proctoring V1 (contract: _shared/contracts/proctor.ts).
// Subject actions (preflight, start, events, snapshotUploadUrl, end) accept anonymous sessions (candidates);
// review actions (timeline, reviewEvent, decide) are staff only. Every write goes through a SQL function
// (supabase/migrations/20261021000007_b2b_v1_proctoring.sql) that re-checks the actor. Flags are evidence for human review.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { HttpError, serviceClient } from "../_shared/b2b-http.ts";
import { serveContract } from "../_shared/contract-handler.ts";
import { proctorContract } from "../_shared/contracts/proctor.ts";
import { integrityScore, type ScoreEvent } from "../_shared/contracts/proctor-rules.ts";

const BUCKET = "b2b-evidence";
const SIGNED_URL_TTL_S = 300;
const db = () => serviceClient();

type R = { ok: boolean; reason?: string } & Record<string, unknown>;

const REASONS: Record<string, [number, string]> = {
  BAD_TARGET: [400, "Pass exactly one of attemptId / interviewId."],
  NOT_FOUND: [404, "Not found."],
  CLOSED: [409, "This test or interview has already ended."],
  POLICY_OFF: [409, "Proctoring is off for this test."],
  SYSTEM_CHECK_FAILED: [400, "Your system check didn't pass. Use desktop Chrome or Edge, share your entire screen and use a single display."],
  CONSENT_REQUIRED: [400, "Please accept each consent item to continue."],
  SESSION_ENDED: [409, "This proctoring session has ended."],
  BAD_STATUS: [400, "Invalid review status."],
  BAD_DECISION: [400, "Invalid decision."],
};

async function call(fn: string, args: Record<string, unknown>): Promise<R> {
  const { data, error } = await db().rpc(fn, args);
  if (error) throw error;
  const r = data as R;
  if (!r?.ok) {
    const [status, msg] = REASONS[r?.reason ?? ""] ?? [400, "Request refused."];
    throw new HttpError(status, r?.reason ?? "REFUSED", msg);
  }
  return r;
}

// Every event of the session, in order. A single select stops at PostgREST's max_rows (1000) without an error, so a
// long proctored session used to be scored on an arbitrary first 1000 events. Read in chunks until a short one.
const EVENT_CHUNK = 1000;
async function sessionEvents(sessionId: string): Promise<ScoreEvent[]> {
  const out: ScoreEvent[] = [];
  for (let from = 0; ; from += EVENT_CHUNK) {
    const { data, error } = await db().from("proctoring_events")
      .select("type, severity, confidence, started_at, ended_at").eq("session_id", sessionId)
      .order("started_at").order("id").range(from, from + EVENT_CHUNK - 1);
    if (error) throw error;
    const chunk = data ?? [];
    for (const e of chunk) out.push({ ...e, confidence: Number(e.confidence) } as ScoreEvent);
    if (chunk.length < EVENT_CHUNK) return out;
  }
}

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

serve(serveContract("B2B-PROCTOR", proctorContract, {
  async preflight(input, ctx) {
    const r = await call("b2b_proctor_preflight", { _actor: ctx.user.id, _attempt_id: input.attemptId ?? null, _interview_id: input.interviewId ?? null });
    return {
      policy: r.policy as "off" | "standard" | "strict" | "maximum", orgName: String(r.org_name ?? ""),
      retentionDays: Number(r.retention_days), contactEmail: (r.contact_email as string | null) ?? null,
      strictMaxViolations: Number(r.strict_max), snapshotIntervalS: Number(r.snapshot_interval_s),
    };
  },

  async start(input, ctx) {
    const r = await call("b2b_proctor_start", {
      _actor: ctx.user.id, _attempt_id: input.attemptId ?? null, _interview_id: input.interviewId ?? null,
      _kind: input.kind, _system_check: input.systemCheck, _consents: input.consents,
    });
    const tier = input.systemCheck.tier;
    return {
      sessionId: String(r.session_id), policy: r.policy as "standard" | "strict" | "maximum",
      snapshotIntervalS: Number(r.snapshot_interval_s), uploadPrefix: `org/${r.org_id}/sessions/${r.session_id}/`,
      strictMaxViolations: Number(r.strict_max), status: r.status as "active" | "paused", resumed: !!r.resumed,
      checks: { faces: tier !== "minimal", headPose: tier === "full" || tier === "lite", vad: input.kind === "assessment" },
    };
  },

  async events(input, ctx) {
    const r = await call("b2b_proctor_log_events", { _actor: ctx.user.id, _session_id: input.sessionId, _events: input.events });
    return { accepted: Number(r.accepted), violations: Number(r.violations), action: r.action as "none" | "warn" | "pause" | "resume" | "submit" };
  },

  async snapshotUploadUrl(input, ctx) {
    const s = await call("b2b_proctor_subject_session", { _actor: ctx.user.id, _session_id: input.sessionId });
    if (s.status === "ended") throw new HttpError(409, "SESSION_ENDED", REASONS.SESSION_ENDED[1]);
    const ext = input.contentType === "image/webp" ? "webp" : "jpg";
    const rand = crypto.getRandomValues(new Uint32Array(1))[0].toString(36);
    const path = `org/${s.org_id}/sessions/${input.sessionId}/${input.kind}-${Date.now()}-${rand}.${ext}`;
    const { data, error } = await db().storage.from(BUCKET).createSignedUploadUrl(path);
    if (error || !data) throw error ?? new Error("upload url");
    return { path, signedUrl: data.signedUrl, token: data.token };
  },

  async end(input, ctx) {
    const s = await call("b2b_proctor_subject_session", { _actor: ctx.user.id, _session_id: input.sessionId });
    if (s.status === "ended" && s.integrity_score !== null && s.integrity_score !== undefined) {
      return { integrityScore: Number(s.integrity_score), band: s.integrity_band as "high" | "medium" | "low" };
    }
    const detail = integrityScore(await sessionEvents(input.sessionId));
    const r = await call("b2b_proctor_end", {
      _actor: ctx.user.id, _session_id: input.sessionId, _score: detail.score, _band: detail.band, _detail: detail,
    });
    return { integrityScore: Number(r.integrity_score), band: r.integrity_band as "high" | "medium" | "low" };
  },

  async timeline(input, ctx) {
    const r = await call("b2b_proctor_timeline", { _actor: ctx.user.id, _session_id: input.sessionId });
    const s = r.session as Record<string, unknown>;
    const events = (r.events as Record<string, unknown>[]) ?? [];
    const paths = [...new Set(events.map((e) => e.evidence_path).filter((p): p is string => typeof p === "string"))];
    const urls = new Map<string, string>();
    if (paths.length) {
      const { data } = await db().storage.from(BUCKET).createSignedUrls(paths, SIGNED_URL_TTL_S);
      for (const d of data ?? []) if (d.path && d.signedUrl && !d.error) urls.set(d.path, d.signedUrl);
    }
    // A session that never ended cleanly (tab closed) gets a provisional score from its events so far.
    const provisional = s.integrity_score === null || s.integrity_score === undefined;
    const live = provisional
      ? integrityScore(events.map((e) => ({ type: String(e.type), severity: e.severity as ScoreEvent["severity"],
                                            confidence: Number(e.confidence), started_at: String(e.started_at), ended_at: e.ended_at as string | null })))
      : null;
    return {
      session: {
        id: String(s.id), policy: s.policy as "off" | "standard" | "strict" | "maximum",
        integrity_score: live ? live.score : num(s.integrity_score),
        integrity_band: (live ? live.band : s.integrity_band) as "high" | "medium" | "low" | null,
        score_detail: live ?? s.score_detail ?? null, started_at: String(s.started_at), ended_at: (s.ended_at as string | null) ?? null,
        status: String(s.status), violations: Number(s.violations), context_type: String(s.context_type),
        subject_name: (s.subject_name as string | null) ?? null, system_check: s.system_check ?? null, provisional,
      },
      events: events.map((e) => ({
        id: Number(e.id), type: String(e.type), severity: e.severity as "info" | "low" | "medium" | "high", confidence: Number(e.confidence),
        started_at: String(e.started_at), ended_at: (e.ended_at as string | null) ?? null,
        evidenceUrl: typeof e.evidence_path === "string" ? urls.get(e.evidence_path) ?? null : null,
        review_status: String(e.review_status), review_note: (e.review_note as string | null) ?? null,
        meta: (e.meta as Record<string, unknown> | null) ?? null,
      })),
      reviews: ((r.reviews as Record<string, unknown>[]) ?? []).map((x) => ({
        id: String(x.id), decision: x.decision as "no_concern" | "minor_concern" | "serious_concern", note: (x.note as string | null) ?? null,
        reviewer_name: (x.reviewer_name as string | null) ?? null, created_at: String(x.created_at),
      })),
    };
  },

  async reviewEvent(input, ctx) {
    await call("b2b_proctor_review_event", { _actor: ctx.user.id, _event_id: input.eventId, _status: input.status, _note: input.note ?? null });
    return { ok: true as const };
  },

  async decide(input, ctx) {
    await call("b2b_proctor_decide", { _actor: ctx.user.id, _session_id: input.sessionId, _decision: input.decision, _note: input.note ?? null });
    return { ok: true as const };
  },
}, { allowAnonymous: (a) => ["preflight", "start", "events", "snapshotUploadUrl", "end"].includes(a) }));
