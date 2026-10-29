import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const api = vi.hoisted(() => ({ companyApi: vi.fn(), candidateApi: vi.fn() }));
const db = vi.hoisted(() => {
  const single = vi.fn().mockResolvedValue({ data: { id: "r-new" }, error: null });
  const select = vi.fn(() => ({ single }));
  const insert = vi.fn((_row: Record<string, unknown>) => ({ select }));
  const eq = vi.fn(() => ({ select }));
  const update = vi.fn(() => ({ eq }));
  return { insert, update, single, from: vi.fn(() => ({ insert, update })) };
});
const session = vi.hoisted(() => ({ ensureVisitorSession: vi.fn() }));

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" }, signOut: vi.fn() }) }));
vi.mock("@/features/b2b/lib/db", () => ({ b2bDb: { from: db.from, rpc: vi.fn() } }));
vi.mock("@/features/b2b/lib/api", async (orig) => ({ ...(await orig<typeof import("@/features/b2b/lib/api")>()), ensureVisitorSession: session.ensureVisitorSession }));
vi.mock("../lib/api", async (orig) => ({ ...(await orig<typeof import("../lib/api")>()), companyApi: api.companyApi, candidateApi: api.candidateApi }));
vi.mock("./queries", async (orig) => ({
  ...(await orig<typeof import("./queries")>()),
  useCompanyAssessments: () => ({ data: [{ id: "a1", title: "Python test", status: "ready", duration_min: 60 }] }),
  useTeam: () => ({ data: { members: [{ id: "m1", user_id: "hm1", role: "hiring_manager", full_name: "Hema", email: "h@x.in", created_at: "" }], invites: [] } }),
  useShareLinks: () => ({ data: [] }),
}));

import { RoleForm } from "./RoleFormPage";
import { RoleView } from "./RolePage";
import { InviteDialog } from "./InviteDialog";
import { StaffReport } from "./ReportPage";
import { ShareView } from "../candidate/SharePage";
import { TokenFlow } from "../candidate/TokenFlowPage";
import type { JobRoleRecord } from "./queries";
import type { CandidateReport } from "../../../supabase/functions/_shared/contracts/company";

const ORG = "6c8f2f3e-6c7a-4a32-9d8b-2b3f9d1c0a11";
const ROLE = "11111111-1111-4111-8111-111111111111";
const RC = "22222222-2222-4222-8222-222222222222";
const RC2 = "33333333-3333-4333-8333-333333333333";
const TOKEN = "t".repeat(40);

function wrap(ui: ReactNode) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={["/x"]}><Routes><Route path="*" element={ui} /></Routes></MemoryRouter>
    </QueryClientProvider>,
  );
}

const role: JobRoleRecord = {
  id: ROLE, org_id: ORG, title: "Backend engineer", jd_text: null,
  skills_matrix: { must_have: [{ skill: "Python", weight: 5 }], nice_to_have: [], seniority: "mid" }, seniority: "mid",
  assessment_id: "a1", interview_config: { enabled: true, duration_min: 20, sections: ["intro"], difficulty: "medium", code_walkthrough: true },
  proctoring_policy: "maximum", invite_expiry_days: 7, status: "open", hiring_manager_ids: [], created_at: "2026-10-20",
};
const row = (over = {}) => ({
  id: RC, full_name: "Asha", email: "asha@x.in", phone: null, stage: "completed", decision: null, match_score: 82, recommendation: "strong",
  invited_at: "2026-10-20T10:00:00Z", started_at: null, completed_at: "2026-10-21T10:00:00Z", invite_expires_at: null, email_sent_at: null,
  email_error: null, attempt_status: "submitted", coding: 80, interview: 70, integrity: 72, integrity_band: "medium", credits_charged: true, ...over,
});
const report = (over: Partial<CandidateReport> = {}): CandidateReport => ({
  roleCandidateId: RC, stage: "completed", decision: null, invitedAt: "2026-10-20", completedAt: "2026-10-21",
  candidate: { fullName: "Asha", email: "asha@x.in", phone: null }, role: { id: ROLE, title: "Backend engineer", orgName: "Acme" },
  matchScore: 82, recommendation: "strong", coverage: 1,
  skills: [{ skill: "Python", kind: "must", weight: 5, score: 80, evidence: ["Coding test: python 80%"] }],
  coding: { attemptId: RC2, status: "submitted", score: 8, maxScore: 10, pct: 80, passed: 4, total: 5, pending: false,
    questions: [{ title: "Two sum", language: "python", code: "print(42)", passed: 4, total: 5, score: 8, maxScore: 10 }] },
  interview: null,
  integrity: { score: 72, band: "medium", sessions: [{ sessionId: RC2, kind: "coding", score: 72, band: "medium", flags: 2, review: null }] },
  comments: [], decisions: [], evidenceIncluded: false, ...over,
});

beforeEach(() => {
  api.companyApi.mockReset(); api.candidateApi.mockReset(); session.ensureVisitorSession.mockReset();
  db.from.mockClear(); db.insert.mockClear(); db.update.mockClear();
});

describe("role from a JD", () => {
  it("extracts skills (mocked AI), lets the recruiter edit them, and saves with Maximum proctoring by default", async () => {
    api.companyApi.mockResolvedValue({ skills: { must_have: [{ skill: "Python", weight: 5 }, { skill: "SQL", weight: 3 }], nice_to_have: [{ skill: "Docker", weight: 2 }], seniority: "junior" }, cacheHit: false });
    wrap(<RoleForm orgId={ORG} role={null} />);
    fireEvent.change(screen.getByLabelText("Role title"), { target: { value: "Backend engineer" } });
    fireEvent.change(screen.getByLabelText("Job description"), { target: { value: "We need a Python developer with SQL. ".repeat(4) } });
    fireEvent.click(screen.getByRole("button", { name: "Suggest skills from the JD" }));
    await screen.findByText(/Skills suggested by AI/);
    expect(api.companyApi).toHaveBeenCalledWith("skillsFromJd", expect.objectContaining({ orgId: ORG }));
    expect(screen.getAllByLabelText("Must-have skill").map((i) => (i as HTMLInputElement).value)).toEqual(["Python", "SQL"]);
    fireEvent.click(screen.getByRole("button", { name: "Remove SQL" }));
    fireEvent.change(screen.getByLabelText("Coding test"), { target: { value: "a1" } });
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "open" } });
    fireEvent.click(screen.getByText("Hema"));
    fireEvent.click(screen.getByRole("button", { name: "Create role" }));
    await waitFor(() => expect(db.insert).toHaveBeenCalled());
    const saved = db.insert.mock.calls[0][0];
    expect(saved).toMatchObject({
      org_id: ORG, title: "Backend engineer", assessment_id: "a1", status: "open", proctoring_policy: "maximum", hiring_manager_ids: ["hm1"],
      skills_matrix: { must_have: [{ skill: "Python", weight: 5 }], nice_to_have: [{ skill: "Docker", weight: 2 }], seniority: "junior" },
      interview_config: expect.objectContaining({ enabled: true, code_walkthrough: true }),
    });
  });

  it("blocks saving without a must-have skill", async () => {
    wrap(<RoleForm orgId={ORG} role={null} />);
    fireEvent.change(screen.getByLabelText("Role title"), { target: { value: "Backend" } });
    fireEvent.click(screen.getByRole("button", { name: "Create role" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Add at least one must-have skill.");
    expect(db.insert).not.toHaveBeenCalled();
  });
});

function csvFile(text: string) {
  const f = new File([text], "candidates.csv", { type: "text/csv" });
  Object.defineProperty(f, "text", { value: () => Promise.resolve(text) });
  return f;
}

describe("invite by CSV", () => {
  it("reads the file, shows problems, invites, and lists skipped duplicates and links", async () => {
    api.companyApi.mockResolvedValue({
      invited: [{ roleCandidateId: RC, email: "asha@x.in", fullName: "Asha", link: `https://hiresume.in/t/${TOKEN}`, emailed: false }],
      skipped: [{ email: "bala@x.in", reason: "already_invited" }], emailConfigured: false,
    });
    const onDone = vi.fn();
    wrap(<InviteDialog open onOpenChange={() => {}} jobRoleId={ROLE} roleTitle="Backend engineer" onDone={onDone} />);
    fireEvent.click(screen.getByRole("tab", { name: "Upload CSV / XLSX" }));
    fireEvent.change(screen.getByLabelText(/File with columns/), { target: { files: [csvFile("Name,Email\nAsha,asha@x.in\nBala,bala@x.in\nAsha 2,ASHA@x.in\n")] } });
    expect(await screen.findByText("2 candidates ready to invite.")).toBeInTheDocument();
    expect(screen.getByText(/Row 4: same email as an earlier row/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Send invites" }));
    await screen.findByText(/1 invited/);
    expect(api.companyApi).toHaveBeenCalledWith("inviteCandidates", expect.objectContaining({
      jobRoleId: ROLE, source: "csv", candidates: [{ email: "asha@x.in", fullName: "Asha" }, { email: "bala@x.in", fullName: "Bala" }],
    }));
    expect(within(screen.getByLabelText("Skipped")).getByText(/Already invited to this role/)).toBeInTheDocument();
    expect(screen.getByText(/Email isn't set up yet/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download links (CSV)" })).toBeInTheDocument();
    expect(onDone).toHaveBeenCalled();
  });
});

describe("pipeline", () => {
  it("applies filters server-side and bulk-decides the selection", async () => {
    api.companyApi.mockImplementation(async (action: string) => {
      if (action === "pipeline") return { access: "editor", total: 2, counts: { completed: 2 }, rows: [row(), row({ id: RC2, full_name: "Bala", email: "b@x.in", match_score: 40 })] };
      if (action === "decide") return { updated: 2, skipped: [] };
      throw new Error(action);
    });
    wrap(<RoleView orgId={ORG} role={role} isEditor />);
    await screen.findByText("Asha");
    fireEvent.click(screen.getByRole("tab", { name: /Completed/ }));
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    fireEvent.click(within(screen.getByRole("form", { name: "Filters" })).getByText("Medium"));
    fireEvent.change(screen.getByLabelText("Minimum match score"), { target: { value: "50" } });
    fireEvent.change(screen.getByLabelText("Search candidates"), { target: { value: "ash" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));
    await waitFor(() => expect(api.companyApi).toHaveBeenLastCalledWith("pipeline", expect.objectContaining({
      jobRoleId: ROLE, filters: { stages: ["completed"], integrityBands: ["medium"], scoreMin: 50, search: "ash" }, page: 1,
    })));
    await screen.findByText("Asha");
    fireEvent.click(screen.getByLabelText("Select all on this page"));
    fireEvent.click(screen.getByRole("button", { name: "Advance" }));
    await screen.findByText("2 updated.");
    expect(api.companyApi).toHaveBeenCalledWith("decide", { roleCandidateIds: [RC, RC2], decision: "advance" });
    expect(screen.getByText(/AI does not pass or fail candidates; your team decides/)).toBeInTheDocument();
  });
});

describe("candidate report", () => {
  it("without interview data: coding, code, integrity link, plain AI statement", async () => {
    api.companyApi.mockResolvedValue({ access: "editor", report: report() });
    wrap(<StaffReport orgId={ORG} rcId={RC} isEditor />);
    await screen.findByRole("heading", { name: "Asha" });
    expect(screen.getByLabelText("Submitted code for Two sum")).toHaveTextContent("print(42)");
    expect(screen.getByText("No interview yet.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Review timeline and evidence" })).toHaveAttribute("href", `/proctor/review/${RC2}`);
    expect(screen.getByText(/AI does not pass or fail candidates; your team decides/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Share with an outside hiring manager" })).toBeInTheDocument();
  });

  it("with interview data: overall, evidence quotes and transcript", async () => {
    api.companyApi.mockResolvedValue({ access: "viewer", report: report({ interview: {
      interviewId: RC2, status: "completed", overall: 70, readiness: "ready", evaluationStatus: "completed",
      transcript: [{ turn: 1, role: "interviewer", content: "Explain joins" }, { turn: 1, role: "student", content: "An inner join keeps matches" }],
      evidence: [{ label: "sql", score: 60, quotes: ["An inner join keeps matches"], reason: "Basic" }] } }) });
    wrap(<StaffReport orgId={ORG} rcId={RC} isEditor={false} />);
    await screen.findByText(/overall 70\/100/);
    expect(screen.getByText("Transcript (2 turns)")).toBeInTheDocument();
    expect(screen.getAllByText("“An inner join keeps matches”").length).toBeGreaterThan(0);
    expect(screen.queryByRole("heading", { name: "Share with an outside hiring manager" })).toBeNull();
  });
});

describe("share page", () => {
  it.each([
    ["expired", /This link has expired/],
    ["revoked", /turned off by the person who shared it/],
    ["invalid", /isn't valid/],
  ])("%s link", async (status, text) => {
    api.candidateApi.mockResolvedValue({ status });
    wrap(<ShareView token={TOKEN} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(text);
  });

  it("valid link: view-only report, no contacts, no evidence images, no review links", async () => {
    api.candidateApi.mockResolvedValue({ status: "ok", expiresAt: new Date(Date.now() + 3 * 86_400_000 + 60_000).toISOString(),
      report: report({ candidate: { fullName: "Asha", email: null, phone: null }, integrity: { score: 72, band: "medium", sessions: [{ sessionId: null, kind: "coding", score: 72, band: "medium", flags: 2, review: null }] } }) });
    wrap(<ShareView token={TOKEN} />);
    await screen.findByRole("heading", { name: "Asha" });
    expect(api.candidateApi).toHaveBeenCalledWith("viewShare", { token: TOKEN }, { auth: false });
    expect(screen.getByText(/view-only · Expires in 3 days/)).toBeInTheDocument();
    expect(screen.getByText(/evidence images are not included/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Review timeline/ })).toBeNull();
    expect(screen.queryByText("asha@x.in")).toBeNull();
  });
});

describe("candidate token flow", () => {
  const info = { status: "valid", company: { name: "Acme", logoUrl: null }, role: { title: "Backend engineer" },
    candidate: { fullName: "Asha", emailMasked: "as***@x.in" }, steps: ["consent", "system_check", "coding", "interview", "done"],
    purposes: ["account", "assessment", "proctoring_camera"], proctored: true };
  const state = (steps = {}, over = {}) => ({ roleCandidateId: RC, jobRoleId: ROLE, attemptId: null, interviewId: null, completed: false,
    steps: { consent: "todo", system_check: "todo", coding: "todo", interview: "todo", done: "todo", ...steps }, ...over });

  it("resolve → anonymous session → consent → system check → coding link → interview link", async () => {
    let current = state();
    api.candidateApi.mockImplementation(async (action: string) => {
      if (action === "resolveInvite") return info;
      if (action === "startCandidate") return current;
      if (action === "recordConsent") return (current = state({ consent: "done" }));
      if (action === "markSystemCheck") return (current = state({ consent: "done", system_check: "done" }));
      throw new Error(action);
    });
    wrap(<TokenFlow token={TOKEN} />);
    await screen.findByRole("heading", { name: "Backend engineer at Acme" });
    expect(session.ensureVisitorSession).toHaveBeenCalled();
    const agree = screen.getByRole("button", { name: "I agree and continue" });
    expect(agree).toBeDisabled();
    for (const box of screen.getAllByRole("checkbox")) fireEvent.click(box);
    fireEvent.click(agree);
    await screen.findByText("Thanks, recorded.");
    expect(api.candidateApi).toHaveBeenCalledWith("recordConsent", expect.objectContaining({ token: TOKEN, purposes: ["account", "assessment", "proctoring_camera"] }));
    fireEvent.click(screen.getByRole("button", { name: "My system check passed" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "My system check passed" })).toBeNull());
    expect(screen.getByRole("link", { name: "Start the coding test" })).toHaveAttribute("href", `/assess/start?context=job_role&id=${ROLE}`);
    expect(screen.getByText(/Available after the coding test/)).toBeInTheDocument();
    expect(screen.queryByText(/%/)).toBeNull();
  });

  it("after coding, the interview link carries the attempt; completion shows the done page", async () => {
    api.candidateApi.mockImplementation(async (action: string) => action === "resolveInvite" ? info
      : state({ consent: "done", system_check: "done", coding: "done" }, { attemptId: RC2 }));
    const { unmount } = wrap(<TokenFlow token={TOKEN} />);
    expect(await screen.findByRole("link", { name: "Start the AI interview" }))
      .toHaveAttribute("href", `/interview/v1/start?context=job_role&id=${ROLE}&attempt=${RC2}`);
    unmount();
    api.candidateApi.mockImplementation(async (action: string) => action === "resolveInvite" ? info : state({}, { completed: true }));
    wrap(<TokenFlow token={TOKEN} />);
    expect(await screen.findByRole("heading", { name: /All done/ })).toBeInTheDocument();
    expect(screen.getByText(/Results aren't shown to candidates/)).toBeInTheDocument();
  });

  it("expired links and second browsers get clear messages", async () => {
    api.candidateApi.mockResolvedValue({ status: "expired" });
    const { unmount } = wrap(<TokenFlow token={TOKEN} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/expired/);
    unmount();
    api.candidateApi.mockImplementation(async (action: string) => {
      if (action === "resolveInvite") return info;
      throw new Error("This link is already in use in another browser. Continue there, or ask the recruiter to send you a new link.");
    });
    wrap(<TokenFlow token={TOKEN} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/another browser/);
  });
});
