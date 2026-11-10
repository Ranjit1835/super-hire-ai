import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const state = vi.hoisted(() => ({
  have: [] as { purpose: string }[],
  memberships: [] as unknown[],
  upsert: vi.fn(),
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" }, signOut: vi.fn() }) }));
vi.mock("@/features/b2b/hooks/useB2B", () => ({
  useMyMemberships: () => ({ data: state.memberships, isLoading: false }),
  useIsSuperAdmin: () => ({ data: false, isLoading: false }),
}));
vi.mock("@/features/b2b/lib/db", () => {
  const select = () => ({ eq: () => ({ eq: async () => ({ data: state.have, error: null }) }) });
  return { b2bDb: { from: () => ({ select, upsert: state.upsert }) } };
});

import { ConsentGate } from "./ConsentGate";

function at(path = "/dashboard") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={[path]}><ConsentGate /></MemoryRouter></QueryClientProvider>);
}

beforeEach(() => {
  state.have = [];
  state.memberships = [];
  state.upsert.mockReset().mockImplementation(async () => {
    state.have = [{ purpose: "age_18_plus" }, { purpose: "privacy_notice" }];
    return { error: null };
  });
  localStorage.clear();
});

describe("DPDP consent prompt", () => {
  it("asks once for 18+ and the notice, and records both with the version", async () => {
    at();
    const go = await screen.findByRole("button", { name: "Continue" });
    expect(go).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /18 years of age or older/ }));
    expect(go).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /privacy notice/ }));
    fireEvent.click(go);
    await waitFor(() => expect(state.upsert).toHaveBeenCalled());
    const rows = state.upsert.mock.calls[0][0] as { purpose: string; notice_version: string; consent_text: string }[];
    expect(rows.map((r) => r.purpose).sort()).toEqual(["age_18_plus", "privacy_notice"]);
    expect(rows.every((r) => r.notice_version && r.consent_text.length > 10)).toBe(true);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Continue" })).toBeNull());
  });

  it("stays out of the way when consent is recorded, on the notice itself, and for college/company members", async () => {
    state.have = [{ purpose: "age_18_plus" }, { purpose: "privacy_notice" }];
    const a = at();
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("dialog")).toBeNull();
    a.unmount();

    state.have = [];
    const b = at("/privacy");
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("dialog")).toBeNull();
    b.unmount();

    state.memberships = [{ role: "student" }];
    at();
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
