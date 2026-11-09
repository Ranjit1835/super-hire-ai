import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// 2,345 verified questions: the pool must read every one, in 1000-row chunks, not stop at PostgREST's max_rows.
const db = vi.hoisted(() => {
  const TOTAL = 2345;
  const ranges: [number, number][] = [];
  const rpc = vi.fn().mockResolvedValue({ data: { total: 0, rows: [], counts: {} }, error: null });
  const from = vi.fn(() => {
    const chain = {
      select: () => chain, eq: () => chain, is: () => chain, or: () => chain, order: () => chain,
      range: (a: number, b: number) => {
        ranges.push([a, b]);
        const n = Math.max(0, Math.min(b, TOTAL - 1) - a + 1);
        return Promise.resolve({ data: Array.from({ length: n }, (_, i) => ({ id: `q${a + i}` })), error: null });
      },
    };
    return chain;
  });
  return { from, rpc, ranges, TOTAL };
});
vi.mock("@/features/b2b/lib/db", () => ({ b2bDb: { from: db.from, rpc: db.rpc } }));

import { BANK_PAGE, useBankPage, useVerifiedPool } from "./queries";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
);

describe("bank queries", () => {
  it("the builder's verified pool reads past 1000 questions", async () => {
    const { result } = renderHook(() => useVerifiedPool(ORG), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data).toHaveLength(db.TOTAL);
    expect(db.ranges).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it("the bank page asks the database for one filtered page", async () => {
    const { result } = renderHook(() => useBankPage(ORG, { type: "mcq", owner: "ours", search: " arrays ", page: 3 }), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(db.rpc).toHaveBeenCalledWith("b2b_bank_page", {
      _org_id: ORG, _owner: "ours", _type: "mcq", _search: "arrays", _page: 3, _page_size: BANK_PAGE,
    });
  });

  it("never sends a malformed org id into a filter", () => {
    db.rpc.mockClear();
    db.from.mockClear();
    renderHook(() => useBankPage("x),org_id.not.is.null", { type: "all", owner: "all", search: "", page: 1 }), { wrapper });
    renderHook(() => useVerifiedPool("x),org_id.not.is.null"), { wrapper });
    expect(db.rpc).not.toHaveBeenCalled();
    expect(db.from).not.toHaveBeenCalled();
  });
});
