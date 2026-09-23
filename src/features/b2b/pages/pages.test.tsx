import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const hooks = vi.hoisted(() => ({
  useIsSuperAdmin: vi.fn(),
  useMyMemberships: vi.fn(),
  useMyQuota: vi.fn(),
  useOrgUsageSummary: vi.fn(),
  useOrgStudents: vi.fn(),
  useAllOrgs: vi.fn(),
  usePlans: vi.fn(),
}));
vi.mock("../hooks/useB2B", () => hooks);
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1", email: "tpo@college.edu" }, signOut: vi.fn() }),
}));
const orgRow = {
  id: "org-a", name: "SVR Engineering College", slug: "svr", type: "college", logo_url: null, is_demo: false,
  plan_id: "pilot", plan_starts_at: "2026-09-01T00:00:00Z", plan_ends_at: "2099-10-13T00:00:00Z", created_at: "",
};
vi.mock("../lib/db", () => ({
  b2bDb: {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: orgRow, error: null }) }) }) }),
  },
}));

import OrgHome from "./OrgHome";
import LearnHome from "./LearnHome";

const ok = <T,>(data: T) => ({ data, isLoading: false, error: null });

function renderAt(path: string, element: ReactNode, routePath = path) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={routePath} element={element} />
          <Route path="/learn" element={<p>learn page</p>} />
          <Route path="/dashboard" element={<p>b2c dashboard</p>} />
          <Route path="/admin/orgs" element={<p>super admin</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  hooks.useIsSuperAdmin.mockReturnValue(ok(false));
  hooks.useMyMemberships.mockReturnValue(ok([]));
  hooks.useMyQuota.mockReturnValue(ok([]));
});

describe("OrgHome", () => {
  it("shows usage against the plan and each student's remaining interviews", async () => {
    hooks.useMyMemberships.mockReturnValue(ok([{ org_id: "org-a", role: "org_admin" }]));
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

    renderAt("/org", <OrgHome />);
    expect(await screen.findByText("SVR Engineering College")).toBeInTheDocument();
    expect(screen.getByText("2 / 150")).toBeInTheDocument();
    expect(screen.getByText("7 / 12")).toBeInTheDocument();
    const anil = screen.getByText("Anil Kumar").closest("tr")!;
    expect(anil.textContent).toContain("0"); // remaining
    expect(screen.getByText("Divya R").closest("tr")!.textContent).toContain("5");
  });

  it("sends students to /learn and B2C users back to their dashboard", () => {
    hooks.useMyMemberships.mockReturnValue(ok([{ org_id: "org-a", role: "student" }]));
    const { unmount } = renderAt("/org", <OrgHome />);
    expect(screen.getByText("learn page")).toBeInTheDocument();
    unmount();

    hooks.useMyMemberships.mockReturnValue(ok([]));
    renderAt("/org", <OrgHome />);
    expect(screen.getByText("b2c dashboard")).toBeInTheDocument();
  });
});

describe("LearnHome", () => {
  it("shows remaining interviews", () => {
    hooks.useMyMemberships.mockReturnValue(ok([{
      org_id: "org-a", role: "student",
      organizations: { id: "org-a", name: "SVR Engineering College", slug: "svr", type: "college", logo_url: null, is_demo: false },
    }]));
    hooks.useMyQuota.mockReturnValue(ok([{
      org_id: "org-a", org_name: "SVR Engineering College", plan_id: "pilot",
      interviews_used: 2, interviews_limit: 6, interviews_remaining: 4, plan_ends_at: orgRow.plan_ends_at,
    }]));
    renderAt("/learn", <LearnHome />);
    expect(screen.getByText("4 of 6")).toBeInTheDocument();
  });

  it("redirects non-students", () => {
    renderAt("/learn", <LearnHome />);
    expect(screen.getByText("b2c dashboard")).toBeInTheDocument();
  });
});
