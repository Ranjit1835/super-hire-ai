import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const state = vi.hoisted(() => ({
  invites: [] as unknown[],
  accept: { ok: true } as { ok: boolean; reason?: string },
  rpc: vi.fn(),
}));
vi.mock("@/lib/config", async (orig) => ({ ...(await orig<typeof import("@/lib/config")>()), B2B_ENABLED: true }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
vi.mock("@/features/b2b/lib/db", () => ({ b2bDb: { rpc: state.rpc } }));

import { PendingInvites } from "./PendingInvites";

const manora = { id: "inv-1", role: "org_admin", expires_at: "2026-11-24T17:04:15Z", org: { id: "org-1", name: "Manora College", type: "college" } };

function at(path = "/dashboard") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <PendingInvites />
        <Routes>
          <Route path="/dashboard" element={<p>dashboard</p>} />
          <Route path="/c/:orgId/students" element={<p>college portal</p>} />
          <Route path="/invite/:token" element={<p>invite page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  state.invites = [manora];
  state.accept = { ok: true };
  state.rpc.mockReset().mockImplementation(async (fn: string) =>
    ({ data: fn === "b2b_my_staff_invites" ? state.invites : state.accept, error: null }));
});

describe("staff invites after sign-in (owner, 2026-11-10)", () => {
  it("shows the invite and accepting opens the college portal", async () => {
    at();
    expect(await screen.findByText("Manora College")).toBeInTheDocument();
    expect(screen.getByText(/as TPO admin/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(await screen.findByText("college portal")).toBeInTheDocument();
    expect(state.rpc).toHaveBeenCalledWith("b2b_accept_my_invite", { _invite_id: "inv-1" });
  });

  it("explains a refused invite, and stays quiet without invites or on the invite link page", async () => {
    state.accept = { ok: false, reason: "EXPIRED" };
    const a = at();
    fireEvent.click(await screen.findByRole("button", { name: "Accept" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/expired/);
    a.unmount();

    state.invites = [];
    const b = at();
    await waitFor(() => expect(state.rpc).toHaveBeenCalledWith("b2b_my_staff_invites"));
    expect(screen.queryByRole("dialog")).toBeNull();
    b.unmount();

    state.invites = [manora];
    at("/invite/abc");
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
