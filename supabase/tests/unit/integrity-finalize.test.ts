// @vitest-environment node
// B35: ended proctoring sessions with no score get one, with the same rules as the browser's `end`.
import { describe, it, expect, vi } from "vitest";
import { finalizeIntegrity } from "../../functions/b2b-retention/finalize";
import { integrityScore } from "../../functions/_shared/contracts/proctor-rules";

const ev = (type: string) => ({ type, severity: "high" as const, confidence: 1, started_at: "2026-11-03T10:00:00Z" });

describe("integrity finalizer (B35)", () => {
  it("scores each unscored session from its events and stores it", async () => {
    const events = { s1: [ev("tab_hidden"), ev("fullscreen_exit")], s2: [] };
    const rpc = vi.fn(async (fn: string, _args: Record<string, unknown>) => (fn === "b2b_proctor_unscored_sessions" ? ["s1", "s2"] : true));
    const out = await finalizeIntegrity({ rpc, events: async (id) => events[id as "s1" | "s2"] });
    expect(out).toEqual({ scored: 2, errors: [] });
    const s1 = rpc.mock.calls.find((c) => c[0] === "b2b_proctor_store_score" && c[1]._session_id === "s1")![1];
    const expected = integrityScore(events.s1);
    expect(s1).toMatchObject({ _score: expected.score, _band: expected.band });
    expect(rpc).toHaveBeenCalledWith("b2b_proctor_store_score", expect.objectContaining({ _session_id: "s2", _score: 100, _band: "high" }));
  });

  it("one failing session doesn't stop the others; an already-scored one isn't counted", async () => {
    const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
      if (fn === "b2b_proctor_unscored_sessions") return ["bad", "done", "ok"];
      return args._session_id !== "done";
    });
    const out = await finalizeIntegrity({ rpc, events: async (id) => { if (id === "bad") throw new Error("db down"); return []; } });
    expect(out.scored).toBe(1);
    expect(out.errors).toEqual(["bad: db down"]);
  });
});
