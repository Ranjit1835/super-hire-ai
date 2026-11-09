import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// Each status gets its own head-only exact count; no rows are downloaded, so PostgREST's 1000-row cap can't apply.
const db = vi.hoisted(() => {
  const totals: Record<string, number> = { imported: 1500, invited: 20, active: 2400, deactivated: 3, held_minor: 1 };
  const calls: { select: unknown[]; filters: [string, string][] }[] = [];
  const from = vi.fn(() => ({
    select: (...select: unknown[]) => {
      const call = { select, filters: [] as [string, string][] };
      calls.push(call);
      const chain = {
        eq(col: string, val: string) {
          call.filters.push([col, val]);
          return col === "status" ? Promise.resolve({ count: totals[val], error: null }) : chain;
        },
      };
      return chain;
    },
  }));
  return { from, calls };
});
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
vi.mock("@/features/b2b/lib/db", () => ({ b2bDb: { from: db.from, rpc: vi.fn() } }));

import { useStudentStatusCounts } from "./queries";

const ORG = "6c8f2f3e-6c7a-4a32-9d8b-2b3f9d1c0a11";
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
);

describe("useStudentStatusCounts", () => {
  it("counts every status over the whole roster, past 1000 students", async () => {
    const { result } = renderHook(() => useStudentStatusCounts(ORG), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data).toEqual({ imported: 1500, invited: 20, active: 2400, deactivated: 3, held_minor: 1 });
    expect(db.calls).toHaveLength(5);
    for (const c of db.calls) {
      expect(c.select).toEqual(["*", { count: "exact", head: true }]);
      expect(c.filters[0]).toEqual(["org_id", ORG]);
    }
  });
});
