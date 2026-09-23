import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const hooks = vi.hoisted(() => ({
  useIsSuperAdmin: vi.fn(),
  useMyMemberships: vi.fn(),
  useMyQuota: vi.fn(),
  useOrgUsageSummary: vi.fn(),
  useOrgStudents: vi.fn(),
  useOrgInvites: vi.fn(),
  useAllOrgs: vi.fn(),
  usePlans: vi.fn(),
}));
vi.mock("../hooks/useB2B", () => hooks);

const auth = vi.hoisted(() => ({
  user: null as null | { id: string; email: string },
  signIn: vi.fn(async () => ({ error: null })),
  signOut: vi.fn(),
  signInWithGoogle: vi.fn(),
  loading: false,
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth }));

const api = vi.hoisted(() => ({
  invitesApi: { import: vi.fn(), preview: vi.fn(), register: vi.fn(), accept: vi.fn(), resend: vi.fn(), revoke: vi.fn() },
}));
vi.mock("../lib/api", async (orig) => ({ ...(await orig<typeof import("../lib/api")>()), invitesApi: api.invitesApi }));

const orgRow = {
  id: "org-a", name: "SVR Engineering College", slug: "svr", type: "college", logo_url: null, is_demo: false,
  plan_id: "pilot", plan_starts_at: "2026-09-01T00:00:00Z", plan_ends_at: "2099-10-13T00:00:00Z", created_at: "",
};
vi.mock("../lib/db", () => ({
  b2bDb: {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: orgRow, error: null }) }) }) }),
  },
}));

import { OrgLayout, OrgRedirect } from "./OrgLayout";
import OrgOverview from "./OrgHome";
import OrgImport from "./OrgImport";
import OrgInvites from "./OrgInvites";
import LearnHome from "./LearnHome";
import InviteAccept from "./InviteAccept";

const ok = <T,>(data: T) => ({ data, isLoading: false, error: null });

function renderApp(path: string, extra?: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/org" element={<OrgRedirect />} />
          <Route path="/org/:orgId" element={<OrgLayout />}>
            <Route index element={<OrgOverview />} />
            <Route path="invites" element={<OrgInvites />} />
            <Route path="import" element={<OrgImport />} />
          </Route>
          <Route path="/learn" element={<LearnHome />} />
          <Route path="/invite/:token" element={<InviteAccept />} />
          <Route path="/dashboard" element={<p>b2c dashboard</p>} />
          <Route path="/admin/orgs" element={<p>super admin</p>} />
          {extra}
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const adminMembership = [{ org_id: "org-a", role: "org_admin", organizations: orgRow }];
const studentMembership = [{ org_id: "org-a", role: "student", organizations: orgRow }];

beforeEach(() => {
  vi.clearAllMocks();
  auth.user = { id: "u1", email: "tpo@college.edu" };
  hooks.useIsSuperAdmin.mockReturnValue(ok(false));
  hooks.useMyMemberships.mockReturnValue(ok([]));
  hooks.useMyQuota.mockReturnValue(ok([]));
  hooks.useOrgUsageSummary.mockReturnValue(ok({
    org_id: "org-a",
    plan: { id: "pilot", name: "Pilot", interviews_per_student: 6, max_students: 150, company_packs_enabled: true, dashboard_enabled: true },
    plan_starts_at: orgRow.plan_starts_at, plan_ends_at: orgRow.plan_ends_at,
    students: 2, interviews_used: 7, students_exhausted: 1,
  }));
  hooks.useOrgStudents.mockReturnValue(ok([
    { id: "m1", user_id: "s1", full_name: "Anil Kumar", email: "anil@x.in", roll_no: "21A91A0501", interviews_used: 6 },
    { id: "m2", user_id: "s2", full_name: "Divya R", email: "divya@x.in", roll_no: "21A91A0502", interviews_used: 1 },
  ]));
  hooks.useOrgInvites.mockReturnValue(ok({ invites: [], batches: [] }));
});

describe("org overview", () => {
  it("shows usage against the plan and each student's remaining interviews", async () => {
    hooks.useMyMemberships.mockReturnValue(ok(adminMembership));
    renderApp("/org/org-a");
    expect(await screen.findByText("SVR Engineering College")).toBeInTheDocument();
    expect(screen.getByText("2 / 150")).toBeInTheDocument();
    expect(screen.getByText("7 / 12")).toBeInTheDocument();
    const cells = (name: string) => [...screen.getByText(name).closest("tr")!.querySelectorAll("td")].map((td) => td.textContent);
    expect(cells("Anil Kumar").at(-1)).toBe("0");
    expect(cells("Divya R").at(-1)).toBe("5");
    expect(screen.getByRole("link", { name: "Add students" })).toBeInTheDocument();
  });

  it("hides management for trainers and blocks outsiders", async () => {
    hooks.useMyMemberships.mockReturnValue(ok([{ ...adminMembership[0], role: "trainer" }]));
    const { unmount } = renderApp("/org/org-a");
    expect(await screen.findByText("Trainer (view only)")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Add students" })).toBeNull();
    unmount();

    hooks.useMyMemberships.mockReturnValue(ok([]));
    renderApp("/org/org-a");
    expect(await screen.findByText("You don't have access to this institution")).toBeInTheDocument();
  });

  it("/org routes staff to their org, students to /learn, B2C users to the dashboard", async () => {
    hooks.useMyMemberships.mockReturnValue(ok(studentMembership));
    const a = renderApp("/org");
    expect(await screen.findByText("Your interview modules will appear here")).toBeInTheDocument();
    a.unmount();
    hooks.useMyMemberships.mockReturnValue(ok([]));
    renderApp("/org");
    expect(screen.getByText("b2c dashboard")).toBeInTheDocument();
  });
});

describe("CSV import", () => {
  beforeEach(() => hooks.useMyMemberships.mockReturnValue(ok(adminMembership)));

  const upload = async (csv: string) => {
    const input = await screen.findByLabelText("Student roster CSV");
    const file = new File([csv], "roster.csv", { type: "text/csv" });
    Object.defineProperty(file, "text", { value: async () => csv });
    fireEvent.change(input, { target: { files: [file] } });
  };

  it("previews per-row errors, sends only valid rows, and offers the link download", async () => {
    api.invitesApi.import.mockResolvedValue({
      results: [{ row: 2, status: "invited" }, { row: 4, status: "skipped", reason: "Already invited" }],
      invited: [{ row: 2, invite_id: "i1", full_name: "Anil Kumar", email: "anil@x.in", roll_no: "R1", link: "https://hiresume.in/invite/t1" }],
      email: { sent: 0, failed: 1, error: "Email sending is not configured." },
    });
    renderApp("/org/org-a/import");
    await upload("name,email,roll_no,department,batch\nAnil Kumar,anil@x.in,R1,CSE,A\n,bad,,CSE,A\nDivya R,divya@x.in,R2,CSE,A");

    expect(await screen.findByText(/students ready/)).toHaveTextContent("2 students ready · 1 rows have problems");
    expect(screen.getByText(/Name is missing; "bad" is not a valid email/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Invite 2 students" }));
    await waitFor(() => expect(api.invitesApi.import).toHaveBeenCalled());
    const [orgId, rows, sendEmail] = api.invitesApi.import.mock.calls[0];
    expect(orgId).toBe("org-a");
    expect(rows.map((r: { email: string }) => r.email)).toEqual(["anil@x.in", "divya@x.in"]);
    expect(sendEmail).toBe(true);

    expect(await screen.findByText(/Emails could not be sent/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Download invite links/ })).toBeInTheDocument();
    expect(screen.getByText("Already invited")).toBeInTheDocument();
  });

  it("explains Excel files and missing columns instead of failing silently", async () => {
    renderApp("/org/org-a/import");
    await upload("name,email\nA B,a@x.in");
    expect(await screen.findByRole("alert")).toHaveTextContent(/Missing column\(s\): roll no, batch/);
  });

  it("is not available to trainers", async () => {
    hooks.useMyMemberships.mockReturnValue(ok([{ ...adminMembership[0], role: "trainer" }]));
    renderApp("/org/org-a/import");
    expect(await screen.findByText("2 / 150")).toBeInTheDocument(); // redirected to overview
  });
});

describe("invite acceptance", () => {
  const preview = {
    status: "pending", full_name: "Kiran Rao", email: "kiran@x.in", roll_no: "K1", batch: "CSE 2026 A",
    org: { id: "org-a", name: "SVR Engineering College", type: "college", logo_url: null, is_demo: false },
    has_account: false, consent: { version: "v1", text: "I agree to share my interview data with SVR Engineering College." },
  };

  it("new student: consent + password creates the account and joins", async () => {
    auth.user = null;
    api.invitesApi.preview.mockResolvedValue(preview);
    api.invitesApi.register.mockResolvedValue({ ok: true, org_id: "org-a", email: "kiran@x.in" });
    renderApp("/invite/tok123");

    expect(await screen.findByText("Hi Kiran, join SVR Engineering College")).toBeInTheDocument();
    const submit = screen.getByRole("button", { name: /Create account & join/ });
    fireEvent.change(screen.getByLabelText("Create a password"), { target: { value: "Passw0rd" } });
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "Passw0rd" } });
    expect(submit).toBeDisabled(); // consent not ticked
    fireEvent.click(screen.getByRole("checkbox"));
    expect(submit).toBeEnabled();
    fireEvent.click(submit);

    await waitFor(() => expect(api.invitesApi.register).toHaveBeenCalledWith("tok123", "Passw0rd"));
    expect(auth.signIn).toHaveBeenCalledWith("kiran@x.in", "Passw0rd");
    expect(await screen.findByText("You're in!")).toBeInTheDocument();
  });

  it("signed-in user joins with one click after consenting", async () => {
    auth.user = { id: "u9", email: "kiran.personal@gmail.com" };
    api.invitesApi.preview.mockResolvedValue(preview);
    api.invitesApi.accept.mockResolvedValue({ ok: true, org_id: "org-a" });
    renderApp("/invite/tok123");
    const join = await screen.findByRole("button", { name: /Join SVR Engineering College/ });
    expect(screen.getByText(/different from the invited email/)).toBeInTheDocument();
    expect(join).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(join);
    await waitFor(() => expect(api.invitesApi.accept).toHaveBeenCalledWith("tok123"));
  });

  it("existing account is sent to sign in and comes back", async () => {
    auth.user = null;
    api.invitesApi.preview.mockResolvedValue({ ...preview, has_account: true });
    renderApp("/invite/tok123");
    const link = await screen.findByRole("link", { name: "Sign in to join" });
    expect(link.getAttribute("href")).toBe("/auth?redirect=%2Finvite%2Ftok123");
  });

  it("explains expired links", async () => {
    api.invitesApi.preview.mockResolvedValue({ ...preview, status: "expired" });
    renderApp("/invite/tok123");
    expect(await screen.findByText("This invite link has expired")).toBeInTheDocument();
  });
});

describe("student home", () => {
  it("shows remaining interviews", () => {
    hooks.useMyMemberships.mockReturnValue(ok(studentMembership));
    hooks.useMyQuota.mockReturnValue(ok([{
      org_id: "org-a", org_name: orgRow.name, plan_id: "pilot",
      interviews_used: 2, interviews_limit: 6, interviews_remaining: 4, plan_ends_at: orgRow.plan_ends_at,
    }]));
    renderApp("/learn");
    expect(screen.getByText("4 of 6")).toBeInTheDocument();
  });

  it("redirects non-students", () => {
    renderApp("/learn");
    expect(screen.getByText("b2c dashboard")).toBeInTheDocument();
  });
});
