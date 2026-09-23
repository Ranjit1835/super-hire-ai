import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const hooks = vi.hoisted(() => ({ useIsSuperAdmin: vi.fn(), usePlans: vi.fn() }));
vi.mock("../hooks/useB2B", () => hooks);
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "sa" }, signOut: vi.fn() }) }));

const db = vi.hoisted(() => {
  const rpc = vi.fn();
  const insert = vi.fn(async (_row: unknown) => ({ error: null }));
  const update = vi.fn((_row: unknown) => ({ eq: async () => ({ error: null }) }));
  return {
    rpc, insert, update,
    from: vi.fn((table: string) => ({
      select: () => ({ order: async () => ({ data: table === "b2b_pricing" ? [{ id: "p1", provider_key: "%", input_inr_per_million: "25.2", output_inr_per_million: "210", unit_inr: "0", effective_from: "2026-09-01T00:00:00Z", notes: "Placeholder" }] : [], error: null }) }),
      insert, update,
    })),
  };
});
vi.mock("../lib/db", () => ({ b2bDb: { rpc: db.rpc, from: db.from } }));

import SuperAdminCosts from "./SuperAdminCosts";

const month = new Date().toISOString().slice(0, 7) + "-01";
beforeEach(() => {
  vi.clearAllMocks();
  hooks.useIsSuperAdmin.mockReturnValue({ data: true, isLoading: false });
  hooks.usePlans.mockReturnValue({ data: [{ id: "pilot", name: "Pilot", interviews_per_student: 6, company_packs_enabled: true, dashboard_enabled: true, max_students: 150, price_inr_per_student: 0 }] });
  db.rpc.mockImplementation(async (fn: string) => {
    if (fn === "super_cost_by_org_month") return { data: [{ month, org_id: "o1", org_name: "SVR College", is_demo: false, interviews: "20", llm_calls: "260", input_tokens: "700000", output_tokens: "210000", stt_minutes: "95.5", tts_chars: "40000", cost_inr: "62.00", cost_per_interview: "3.10" }], error: null };
    if (fn === "super_cost_vs_revenue") return { data: [{ org_id: "o1", org_name: "SVR College", is_demo: false, plan_id: "pilot", price_inr_per_student: "150", students: "120", revenue_inr: "18000.00", interviews: "20", cost_inr: "62.00", cost_per_interview: "3.10", cost_per_student: "0.52", margin_inr: "17938.00", cost_share: "0.0034" }], error: null };
    if (fn === "super_recompute_costs") return { data: 42, error: null };
    return { data: null, error: null };
  });
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter><SuperAdminCosts /></MemoryRouter></QueryClientProvider>);
}

describe("SuperAdminCosts", () => {
  it("shows cost per interview, this month, cost vs revenue and the monthly breakdown", async () => {
    renderPage();
    expect(await screen.findByText("Average cost per interview")).toBeInTheDocument();
    expect(screen.getByText("Average cost per interview").parentElement).toHaveTextContent("₹3.10");
    expect(screen.getByText("This month").parentElement).toHaveTextContent("₹62.00");
    expect(screen.getByText("₹18,000")).toBeInTheDocument();
    expect(screen.getByText("0.3%")).toBeInTheDocument();
    expect(screen.getByText("7,00,000 / 2,10,000")).toBeInTheDocument(); // Indian digit grouping
    expect(screen.getAllByText(/placeholder/i).length).toBeGreaterThan(0); // rate row + explanation
    expect(db.rpc).toHaveBeenCalledWith("super_cost_by_org_month", { _include_demo: false });
  });

  it("toggling demo orgs refetches with demo included", async () => {
    renderPage();
    await screen.findByText("Average cost per interview");
    fireEvent.click(screen.getByRole("switch"));
    await waitFor(() => expect(db.rpc).toHaveBeenCalledWith("super_cost_by_org_month", { _include_demo: true }));
  });

  it("adds a rate and recalculates", async () => {
    renderPage();
    await screen.findByText("Average cost per interview");
    fireEvent.change(screen.getByLabelText("Key"), { target: { value: "gemini-3.6-flash" } });
    fireEvent.change(screen.getByLabelText("Input ₹/1M"), { target: { value: "30" } });
    fireEvent.change(screen.getByLabelText("Output ₹/1M"), { target: { value: "250" } });
    fireEvent.click(screen.getByRole("button", { name: /Add rate/ }));
    await waitFor(() => expect(db.insert).toHaveBeenCalledWith(expect.objectContaining({ provider_key: "gemini-3.6-flash", input_inr_per_million: 30, output_inr_per_million: 250 })));
    fireEvent.click(screen.getByRole("button", { name: /Recalculate all costs/ }));
    await waitFor(() => expect(db.rpc).toHaveBeenCalledWith("super_recompute_costs"));
  });

  it("sets a plan's price per student", async () => {
    renderPage();
    await screen.findByText("Average cost per interview");
    fireEvent.change(screen.getByLabelText(/Pilot · now ₹0/), { target: { value: "150" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(db.update).toHaveBeenCalledWith({ price_inr_per_student: 150 }));
  });

  it("is super-admin only", () => {
    hooks.useIsSuperAdmin.mockReturnValue({ data: false, isLoading: false });
    renderPage();
    expect(screen.queryByText("Average cost per interview")).toBeNull();
  });
});
