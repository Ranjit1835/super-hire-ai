import { describe, it, expect, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { MAX_ROWS, selectAll } from "./db";

describe("selectAll", () => {
  it("reads every row in MAX_ROWS chunks until a short chunk", async () => {
    const total = 2 * MAX_ROWS + 17;
    const page = vi.fn(async (from: number, to: number) => ({
      data: Array.from({ length: Math.max(0, Math.min(to, total - 1) - from + 1) }, (_, i) => from + i), error: null,
    }));
    const rows = await selectAll<number>(page);
    expect(rows).toHaveLength(total);
    expect(rows.at(-1)).toBe(total - 1);
    expect(page.mock.calls).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it("an exact multiple of MAX_ROWS ends with one empty read", async () => {
    const page = vi.fn(async (from: number) => ({ data: from < MAX_ROWS ? Array(MAX_ROWS).fill(0) : [], error: null }));
    expect(await selectAll(page)).toHaveLength(MAX_ROWS);
    expect(page).toHaveBeenCalledTimes(2);
  });

  it("throws the query's error", async () => {
    await expect(selectAll(async () => ({ data: null, error: new Error("boom") }))).rejects.toThrow("boom");
  });
});
