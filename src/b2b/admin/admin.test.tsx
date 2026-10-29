import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { OrgRow, PlanRow } from "../types";

const state = vi.hoisted(() => ({
  isSuper: true as boolean | undefined,
  orgs: [] as unknown[],
  plans: [] as unknown[],
  invites: [] as unknown[],
  usage: [] as unknown[],
}));
const api = vi.hoisted(() => ({ adminApi: vi.fn() }));

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" }, signOut: vi.fn() }) }));
vi.mock("./queries", async (orig) => ({
  ...(await orig<typeof import("./queries")>()),
  useIsSuperAdmin: () => ({ data: state.isSuper, isLoading: false }),
  useOrgs: () => ({ data: state.orgs, isLoading: false, error: null }),
  usePlans: () => ({ data: state.plans }),
  useStaffInvites: () => ({ data: state.invites }),
  useLedger: () => ({ data: [], refetch: vi.fn() }),
  useOrgUsage: () => ({ data: state.usage, isLoading: false, error: null }),
  adjustCredits: vi.fn().mockResolvedValue(10),
}));
vi.mock("../lib/api", async (orig) => ({ ...(await orig<typeof import("../lib/api")>()), adminApi: api.adminApi }));

import AdminOrgsPage from "./AdminOrgsPage";
import AdminUsagePage from "./AdminUsagePage";

const plan = (id: string, org_type: "college" | "company", price: number, credits: number): PlanRow => ({
  id, name: id, org_type, price_inr_per_student: price, drives_included: 1, credits_per_student: credits, credits_included: 0, is_active: true,
});
const org = (over: Partial<OrgRow>): OrgRow => ({
  id: "o1", name: "SVR College", slug: "svr", type: "college", status: "active", plan_id: "college_starter", plan_starts_at: "2026-10-01T00:00:00Z",
  plan_ends_at: null, seat_limit: 300, credits_balance: "1200", contact_name: null, contact_email: null, contact_phone: null,
  address: null, logo_url: null, settings: {}, is_demo: false, created_at: "2026-10-01T00:00:00Z", ...over,
});

function renderAt(path: string) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/admin/orgs" element={<AdminOrgsPage />} />
          <Route path="/admin/usage" element={<AdminUsagePage />} />
          <Route path="/dashboard" element={<p>dashboard</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  state.isSuper = true;
  state.orgs = [org({}), org({ id: "o2", name: "Acme Labs", type: "company", plan_id: "company_v1", status: "suspended", credits_balance: 20, seat_limit: null })];
  state.plans = [plan("college_starter", "college", 399, 4), plan("college_plus", "college", 599, 5), plan("company_v1", "company", 0, 0)];
  state.invites = [{ id: "i1", org_id: "o1", email: "tpo@svr.in", full_name: "TPO", role: "org_admin", status: "pending", expires_at: "", email_sent_at: null, email_error: null, created_at: "" }];
  state.usage = [];
  api.adminApi.mockReset();
});

describe("super admin: organisations", () => {
  it("only super admins get in", () => {
    state.isSuper = false;
    renderAt("/admin/orgs");
    expect(screen.getByText("dashboard")).toBeInTheDocument();
  });

  it("lists colleges and companies with plan, credits, status and pending staff invites", () => {
    renderAt("/admin/orgs");
    const rows = screen.getAllByRole("row");
    expect(within(rows[1]).getByText("SVR College")).toBeInTheDocument();
    expect(within(rows[1]).getByText("College")).toBeInTheDocument();
    expect(within(rows[1]).getByText("1200")).toBeInTheDocument();
    expect(within(rows[1]).getByText(/tpo@svr.in · Admin/)).toBeInTheDocument();
    expect(within(rows[2]).getByText("Company")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Suspended")).toBeInTheDocument();
    expect(within(rows[2]).getByRole("button", { name: "Reactivate" })).toBeInTheDocument();
  });

  it("header counts read as English: one company, one pending invite", () => {
    renderAt("/admin/orgs");
    expect(screen.getByText("2 organisations · 1 college · 1 company · 1 pending invite")).toBeInTheDocument();
  });

  it("creates a college with a plan, seats, credits and its TPO admin, and shows the link when email is off", async () => {
    api.adminApi.mockResolvedValue({ orgId: "o9", credits: 1200, invite: { inviteId: "i9", link: "https://hiresume.in/invite/tok", emailed: false } });
    renderAt("/admin/orgs");
    fireEvent.click(screen.getByRole("button", { name: /New organisation/ }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Gokaraju College" } });
    expect(screen.getByLabelText("Link name")).toHaveValue("gokaraju-college");
    fireEvent.change(screen.getByLabelText("Students (seats)"), { target: { value: "300" } });
    expect(screen.getByLabelText("Opening credits")).toHaveAttribute("placeholder", "1200");   // 300 × 4
    fireEvent.change(screen.getByLabelText("TPO admin email"), { target: { value: "tpo@gk.in" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(api.adminApi).toHaveBeenCalled());
    expect(api.adminApi.mock.calls[0][0]).toBe("createOrg");
    expect(api.adminApi.mock.calls[0][1]).toMatchObject({
      name: "Gokaraju College", slug: "gokaraju-college", type: "college", planId: "college_starter", seatLimit: 300,
      admin: { email: "tpo@gk.in" },
    });
    expect(await screen.findByText("https://hiresume.in/invite/tok")).toBeInTheDocument();
  });

  it("company orgs offer company plans and company roles", async () => {
    renderAt("/admin/orgs");
    fireEvent.click(screen.getByRole("button", { name: /New organisation/ }));
    fireEvent.click(screen.getByRole("radio", { name: "Company" }));
    expect(screen.getByLabelText("Company admin email")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    api.adminApi.mockResolvedValue({ inviteId: "i2", link: "https://hiresume.in/invite/x", emailed: true });
    const acme = screen.getAllByRole("row")[2];
    fireEvent.click(within(acme).getByRole("button", { name: "Invite" }));
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "rec@acme.in" } });
    fireEvent.click(screen.getByRole("button", { name: "Send invite" }));
    await waitFor(() => expect(api.adminApi).toHaveBeenCalledWith("inviteStaff", { orgId: "o2", email: "rec@acme.in", fullName: undefined, role: "org_admin" }));
  });

  it("suspends and reactivates", async () => {
    api.adminApi.mockResolvedValue({ ok: true });
    renderAt("/admin/orgs");
    fireEvent.click(within(screen.getAllByRole("row")[1]).getByRole("button", { name: "Suspend" }));
    await waitFor(() => expect(api.adminApi).toHaveBeenCalledWith("updateOrg", { orgId: "o1", status: "suspended" }));
  });
});

describe("super admin: usage", () => {
  it("shows per-org AI cost, cache hit rate and credits", () => {
    state.usage = [{
      org_id: "o1", org_name: "SVR College", org_type: "college", status: "active", plan_id: "college_starter", credits_balance: 1180,
      credits_used_month: 20, students: 300, students_active: 210, candidates: 0, members: 3, ai_calls_month: 40, ai_cost_inr_month: 52.5,
      ai_cost_inr_total: 80, cache_hits_month: 10, cache_hit_rate_month: 0.25,
    }];
    renderAt("/admin/usage");
    expect(screen.getByText("210 / 300")).toBeInTheDocument();
    expect(screen.getAllByText("₹52.5").length).toBeGreaterThan(0);
    expect(screen.getAllByText("25%").length).toBeGreaterThan(0);
  });
});
