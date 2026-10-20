// @vitest-environment node
// b2b-company and b2b-candidate handlers with a fake database, fake AI gateway and fake mailer (no network).
import { describe, it, expect, vi } from "vitest";
import { makeHandlers as company, type Deps as CompanyDeps } from "../../functions/b2b-company/handlers";
import { makeHandlers as candidate, type Deps as CandidateDeps } from "../../functions/b2b-candidate/handlers";
import { CANDIDATE_CONSENT_VERSION } from "../../functions/_shared/company-logic";
import { candidateContract, companyContract } from "../../functions/_shared/contracts/company";

const U = (n: number) => `${String(n).padStart(8, "0")}-1111-4111-8111-111111111111`;
const ACTOR = U(9);
type Db = Record<string, (args: Record<string, unknown>) => unknown>;

function deps(db: Db, over: Partial<CompanyDeps> = {}) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const mails: Array<{ to: string; subject: string }> = [];
  let t = 0;
  const d: CompanyDeps & CandidateDeps = {
    rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      if (!db[fn]) throw new Error(`unexpected rpc ${fn}`);
      return db[fn](args);
    }),
    ai: vi.fn() as unknown as CompanyDeps["ai"],
    sendMail: vi.fn(async (m) => { mails.push(m); return { sent: true, error: null }; }),
    emailConfigured: () => true,
    baseUrl: () => "https://hiresume.in",
    randomToken: () => `token-${++t}-${"x".repeat(30)}`,
    sha256: async (s: string) => `h(${s})`,
    log: () => {},
    ...over,
  };
  return { d, calls, mails };
}

describe("skillsFromJd", () => {
  it("checks the role, then asks the gateway with the JD as delimited data", async () => {
    const skills = { must_have: [{ skill: "Python", weight: 5 }], nice_to_have: [], seniority: "mid" as const };
    const ai = vi.fn(async () => ({ ok: true as const, data: skills, cacheHit: true }));
    const { d } = deps({ actor_is_company_editor: () => true }, { ai: ai as unknown as CompanyDeps["ai"] });
    const out = await company(d).skillsFromJd({ orgId: U(1), jd: "We need a Python developer. ".repeat(5) }, ACTOR);
    expect(out).toEqual({ skills, cacheHit: true });
    const req = (ai.mock.calls[0] as unknown[])[0] as { feature: string; orgId: string; messages: Array<{ content: string }> };
    expect(req.feature).toBe("jd.skills_matrix");
    expect(req.orgId).toBe(U(1));
    expect(req.messages[0].content).toMatch(/^<job_description>/);
    expect(companyContract.skillsFromJd.output.safeParse(out).success).toBe(true);
  });

  it("refuses non-editors before any model call", async () => {
    const ai = vi.fn();
    const { d } = deps({ actor_is_company_editor: () => false }, { ai: ai as unknown as CompanyDeps["ai"] });
    await expect(company(d).skillsFromJd({ orgId: U(1), jd: "x".repeat(100) }, ACTOR)).rejects.toMatchObject({ status: 403 });
    expect(ai).not.toHaveBeenCalled();
  });
});

describe("inviteCandidates", () => {
  const ok = (args: Record<string, unknown>) => ({
    ok: true, role_title: "Backend", org_name: "Acme", expiry_days: 7,
    invited: [{ role_candidate_id: U(2), email: "b@x.in", full_name: "B", token_index: 2 }],
    skipped: [{ email: "a@x.in", reason: "already_invited" }],
    _seen: args,
  });

  it("sends only hashes to SQL, links the right token, emails and records the outcome", async () => {
    const { d, calls, mails } = deps({ b2b_invite_candidates: ok, b2b_mark_candidate_email: () => null });
    const out = await company(d).inviteCandidates({ jobRoleId: U(1), sendEmail: true, source: "csv",
      candidates: [{ email: "a@x.in", fullName: "A" }, { email: "b@x.in", fullName: "B" }] }, ACTOR);
    const sent = calls[0].args._candidates as Array<{ token_hash: string }>;
    expect(sent.map((c) => c.token_hash)).toEqual([`h(token-1-${"x".repeat(30)})`, `h(token-2-${"x".repeat(30)})`]);
    expect(out.invited[0]).toMatchObject({ link: `https://hiresume.in/t/token-2-${"x".repeat(30)}`, emailed: true });
    expect(mails[0].to).toBe("b@x.in");
    expect(calls.find((c) => c.fn === "b2b_mark_candidate_email")!.args).toEqual({ _rc_ids: [U(2)], _error: null });
    expect(companyContract.inviteCandidates.output.safeParse(out).success).toBe(true);
  });

  it("without email configured: returns links, sends nothing", async () => {
    const { d, mails } = deps({ b2b_invite_candidates: ok }, { emailConfigured: () => false });
    const out = await company(d).inviteCandidates({ jobRoleId: U(1), sendEmail: true, source: "invite", candidates: [{ email: "a@x.in", fullName: "A" }, { email: "b@x.in", fullName: "B" }] }, ACTOR);
    expect(out).toMatchObject({ emailConfigured: false, invited: [{ emailed: false }] });
    expect(mails).toEqual([]);
  });

  it("explains a credit shortfall", async () => {
    const { d } = deps({ b2b_invite_candidates: () => ({ ok: false, reason: "NO_CREDITS", needed: 4, balance: 3 }) });
    await expect(company(d).inviteCandidates({ jobRoleId: U(1), sendEmail: false, source: "invite", candidates: [{ email: "a@x.in", fullName: "A" }] }, ACTOR))
      .rejects.toMatchObject({ status: 402, message: expect.stringMatching(/Needed 4, available 3/) });
  });

  it("SQL FORBIDDEN becomes a 403", async () => {
    const { d } = deps({ b2b_invite_candidates: () => { throw new Error("b2b_invite_candidates: FORBIDDEN"); } });
    await expect(company(d).inviteCandidates({ jobRoleId: U(1), sendEmail: false, source: "invite", candidates: [{ email: "a@x.in", fullName: "A" }] }, ACTOR))
      .rejects.toMatchObject({ status: 403 });
  });
});

describe("pipeline and report", () => {
  const rawReport = {
    role_candidate_id: U(2), stage: "completed", decision: null, invited_at: "2026-10-20", completed_at: "2026-10-21",
    candidate: { full_name: "B", email: "b@x.in", phone: null },
    role: { id: U(1), title: "Backend", org_name: "Acme", skills_matrix: { must_have: [{ skill: "Python", weight: 5 }], nice_to_have: [], seniority: "mid" } },
    attempt: { id: U(3), status: "submitted", score: 9, max_score: 10, questions: [{ title: "Q", language: "python", code: "x", passed: 9, total: 10, score: 9, max_score: 10, status: "done" }] },
    interview: null, dimension_scores: [], integrity: [], comments: [], decisions: [],
  };

  it("pipeline refreshes stale match scores, then queries, then sends completion notices", async () => {
    const { d, calls, mails } = deps({
      b2b_match_inputs: () => [rawReport],
      b2b_store_matches: () => 1,
      b2b_role_pipeline: () => ({ ok: true, access: "editor", total: 0, counts: {}, rows: [] }),
      b2b_claim_completion_notices: () => [{ role_candidate_id: U(2), org_id: U(8), role_title: "Backend", candidate_name: "B", recipients: ["rec@x.in"] }],
    });
    const out = await company(d).pipeline({ jobRoleId: U(1), filters: { stages: ["completed"] }, page: 1, pageSize: 50 }, ACTOR);
    expect(calls.map((c) => c.fn)).toEqual(["b2b_match_inputs", "b2b_store_matches", "b2b_role_pipeline", "b2b_claim_completion_notices"]);
    const stored = (calls[1].args._items as Array<{ score: number; recommendation: string }>)[0];
    expect(stored.score).toBe(90);
    expect(stored.recommendation).toBe("strong");
    expect(calls[2].args._filters).toEqual({ stages: ["completed"] });
    expect(mails[0]).toMatchObject({ to: "rec@x.in", subject: "B completed the Backend assessment" });
    expect(companyContract.pipeline.output.safeParse(out).success).toBe(true);
  });

  it("report returns a contract-valid report and stores its match", async () => {
    const { d, calls } = deps({
      b2b_candidate_report: () => ({ ok: true, access: "viewer", report: rawReport }),
      b2b_store_matches: () => 1, b2b_claim_completion_notices: () => [],
    });
    const out = await company(d).report({ roleCandidateId: U(2) }, ACTOR);
    expect(out.access).toBe("viewer");
    expect(out.report.matchScore).toBe(90);
    expect(calls.map((c) => c.fn)).toContain("b2b_store_matches");
    expect(companyContract.report.output.safeParse(out).success).toBe(true);
  });

  it("share links: hashed token in SQL, plaintext only in the returned link", async () => {
    const { d, calls } = deps({ b2b_create_share_link: () => ({ ok: true, share_id: U(5), expires_at: "2026-10-27T00:00:00Z" }) });
    const out = await company(d).createShareLink({ roleCandidateId: U(2), expiresInDays: 7 }, ACTOR);
    expect(calls[0].args).toMatchObject({ _token_hash: `h(token-1-${"x".repeat(30)})`, _days: 7 });
    expect(out.link).toBe(`https://hiresume.in/share/token-1-${"x".repeat(30)}`);
  });
});

describe("candidate handlers", () => {
  const TOKEN = "t".repeat(40);
  const resolved = { status: "valid", role_candidate_id: U(2), company: { name: "Acme", logo_url: null }, role: { title: "Backend" },
    candidate: { full_name: "Asha", email: "asha@x.in" }, has_coding: true, has_interview: true, policy: "maximum" };
  const st = (over = {}) => ({ ok: true, role_candidate_id: U(2), job_role_id: U(1), attempt_id: null, interview_id: null, completed: false,
    just_completed: false, steps: { consent: "todo", system_check: "todo", coding: "todo", interview: "todo", done: "todo" }, ...over });

  it("resolve masks the email and lists steps and purposes", async () => {
    const { d } = deps({ b2b_resolve_candidate_token: () => resolved });
    const out = await candidate(d).resolveInvite({ token: TOKEN });
    expect(out).toMatchObject({ status: "valid", candidate: { fullName: "Asha", emailMasked: "as***@x.in" },
      steps: ["consent", "system_check", "coding", "interview", "done"], proctored: true });
    expect(out.purposes).toContain("proctoring_camera");
    expect(candidateContract.resolveInvite.output.safeParse(out).success).toBe(true);
    const { d: d2 } = deps({ b2b_resolve_candidate_token: () => ({ status: "invalid" }) });
    expect(await candidate(d2).resolveInvite({ token: TOKEN })).toEqual({ status: "invalid" });
  });

  it("start refuses a second browser with a clear message", async () => {
    const { d } = deps({ b2b_claim_candidate_token: () => ({ ok: false, reason: "OTHER_DEVICE" }) });
    await expect(candidate(d).startCandidate({ token: TOKEN }, U(7))).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/another browser/) });
  });

  it("consent stores the server's own text for each purpose and version", async () => {
    const { d, calls } = deps({ b2b_resolve_candidate_token: () => resolved, b2b_candidate_consent: () => st({ steps: { ...st().steps, consent: "done" } }) });
    const out = await candidate(d).recordConsent({ token: TOKEN, purposes: ["account", "assessment"], version: CANDIDATE_CONSENT_VERSION }, U(7));
    expect(out.steps.consent).toBe("done");
    const consents = calls.find((c) => c.fn === "b2b_candidate_consent")!.args._consents as Array<{ purpose: string; text: string; version: string }>;
    expect(consents[1]).toMatchObject({ purpose: "assessment", version: CANDIDATE_CONSENT_VERSION, text: expect.stringMatching(/Acme's team decides/) });
    await expect(candidate(d).recordConsent({ token: TOKEN, purposes: ["account"], version: "old" }, U(7))).rejects.toMatchObject({ status: 409 });
  });

  it("a just-completed state triggers the recruiter notice once", async () => {
    const claim = vi.fn(() => [{ role_candidate_id: U(2), org_id: U(8), role_title: "Backend", candidate_name: "Asha", recipients: ["r@x.in"] }]);
    const { d, mails } = deps({ b2b_candidate_state: () => st({ completed: true, just_completed: true }), b2b_claim_completion_notices: claim });
    const out = await candidate(d).state({ token: TOKEN }, U(7));
    expect(out.completed).toBe(true);
    expect(claim).toHaveBeenCalledTimes(1);
    expect(mails).toHaveLength(1);
    expect(candidateContract.state.output.safeParse(out).success).toBe(true);
  });

  it("viewShare passes through expired / revoked and shapes a view-only report", async () => {
    const { d } = deps({ b2b_view_share: () => ({ status: "expired" }) });
    expect(await candidate(d).viewShare({ token: TOKEN })).toEqual({ status: "expired" });
    const { d: d2 } = deps({ b2b_view_share: () => ({ status: "ok", expires_at: "2026-10-30", report: {
      role_candidate_id: U(2), stage: "completed", decision: null, invited_at: "x", completed_at: null,
      candidate: { full_name: "Asha", email: null, phone: null }, role: { id: U(1), title: "Backend", org_name: "Acme", skills_matrix: {} },
      attempt: null, interview: null, dimension_scores: [], integrity: [], comments: [], decisions: [] } }) });
    const ok = await candidate(d2).viewShare({ token: TOKEN });
    expect(ok.report).toMatchObject({ candidate: { email: null }, evidenceIncluded: false, comments: [] });
    expect(candidateContract.viewShare.output.safeParse(ok).success).toBe(true);
  });
});
