import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const state = vi.hoisted(() => ({
  user: { id: "u1" } as { id: string } | null,
  result: { ok: true } as { ok: boolean; reason?: string },
  rpc: vi.fn(),
  signOut: vi.fn(async () => undefined),
}));
vi.mock("@/lib/config", async (orig) => ({ ...(await orig<typeof import("@/lib/config")>()), B2B_ENABLED: true }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: state.user, signOut: state.signOut }) }));
vi.mock("@/features/b2b/lib/db", () => ({ b2bDb: { rpc: state.rpc } }));
vi.mock("../session", () => ({ endServerSession: vi.fn(async () => undefined) }));

import { AccessGate, BLOCK_MESSAGE } from "./AccessGate";

function at(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <AccessGate />
        <Routes>
          <Route path="/learn/v1" element={<p>student home</p>} />
          <Route path="/invite/:token" element={<p>accept invite</p>} />
          <Route path="/auth" element={<p>sign-in page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  state.user = { id: "u1" };
  state.result = { ok: true };
  state.rpc.mockReset().mockImplementation(async () => ({ data: state.result, error: null }));
  state.signOut.mockClear();
});

describe("sign-in access (owner decisions 2026-11-09)", () => {
  it("leaves allowed users alone", async () => {
    at("/learn/v1");
    await waitFor(() => expect(state.rpc).toHaveBeenCalledWith("b2b_access_check"));
    expect(screen.getByText("student home")).toBeInTheDocument();
    expect(state.signOut).not.toHaveBeenCalled();
  });

  it("signs out a student with no drive and says why", async () => {
    state.result = { ok: false, reason: "NO_DRIVE" };
    at("/learn/v1");
    expect(await screen.findByText("sign-in page")).toBeInTheDocument();
    expect(state.signOut).toHaveBeenCalled();
    expect(BLOCK_MESSAGE.NO_DRIVE).toMatch(/No drive has been assigned/);
  });

  it("signs out members of a deactivated organisation", async () => {
    state.result = { ok: false, reason: "ORG_DEACTIVATED" };
    at("/learn/v1");
    expect(await screen.findByText("sign-in page")).toBeInTheDocument();
  });

  it("lets an invite finish before checking, and never checks signed-out visitors", async () => {
    state.result = { ok: false, reason: "NO_DRIVE" };
    at("/invite/abc");
    expect(screen.getByText("accept invite")).toBeInTheDocument();
    state.user = null;
    at("/learn/v1");
    await new Promise((r) => setTimeout(r, 20));
    expect(state.rpc).not.toHaveBeenCalled();
  });
});
