import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const state = vi.hoisted(() => ({
  user: { id: "u1" } as { id: string } | null,
  memberships: { data: [] as unknown[], isLoading: false },
  isSuper: { data: false as boolean | undefined, isLoading: false },
}));
vi.mock("@/lib/config", async (orig) => ({ ...(await orig<typeof import("@/lib/config")>()), B2B_ENABLED: true }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: state.user }) }));
vi.mock("../hooks/useB2B", () => ({ useMyMemberships: () => state.memberships, useIsSuperAdmin: () => state.isSuper }));

import { B2CGuard, b2bHomeFor } from "./B2CGuard";

const m = (role: string, type = "college") => ({ role, organizations: { type } }) as never;
function at(path = "/pricing") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/pricing" element={<B2CGuard><p>B2C pricing ₹299</p></B2CGuard>} />
        <Route path="/learn/v1" element={<p>student home</p>} />
        <Route path="/c" element={<p>college portal</p>} />
        <Route path="/co" element={<p>company portal</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  state.user = { id: "u1" };
  state.memberships = { data: [], isLoading: false };
  state.isSuper = { data: false, isLoading: false };
});

describe("B2C pages for B2B users (R3.2)", () => {
  it("routes each B2B role to its own portal", () => {
    expect(b2bHomeFor([])).toBeNull();
    expect(b2bHomeFor([m("student")])).toBe("/learn/v1");
    expect(b2bHomeFor([m("org_admin")])).toBe("/c");
    expect(b2bHomeFor([m("trainer")])).toBe("/c");
    expect(b2bHomeFor([m("recruiter", "company")])).toBe("/co");
  });

  it("a student, a TPO and a recruiter never see a B2C page with prices", () => {
    for (const [mem, home] of [[[m("student")], "student home"], [[m("org_admin")], "college portal"], [[m("recruiter", "company")], "company portal"]] as const) {
      state.memberships = { data: [...mem], isLoading: false };
      const { unmount } = at();
      expect(screen.getByText(home)).toBeInTheDocument();
      expect(screen.queryByText(/₹/)).toBeNull();
      unmount();
    }
  });

  it("nothing is shown while membership is loading (no flash of prices)", () => {
    state.memberships = { data: [], isLoading: true };
    at();
    expect(screen.queryByText(/₹/)).toBeNull();
  });

  it("B2C users, signed-out visitors and super admins see the B2C page as before", () => {
    at();
    expect(screen.getByText("B2C pricing ₹299")).toBeInTheDocument();
    state.user = null;
    at();
    expect(screen.getAllByText("B2C pricing ₹299")).toHaveLength(2);
    state.user = { id: "sa" };
    state.isSuper = { data: true, isLoading: false };
    state.memberships = { data: [m("org_admin")], isLoading: false };
    at();
    expect(screen.getAllByText("B2C pricing ₹299")).toHaveLength(3);
  });
});
