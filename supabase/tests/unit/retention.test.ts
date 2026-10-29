// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { sweepRetention } from "../../functions/b2b-retention/sweep";

const due = (paths: string[], ids: number[]) => ({ paths, event_ids: ids });

describe("retention sweep (R5.5)", () => {
  it("removes files in chunks of 100, then clears the events, then purges transcripts", async () => {
    const paths = Array.from({ length: 250 }, (_, i) => `org/o/sessions/s/${i}.jpg`);
    let dueCalls = 0;
    const rpc = vi.fn(async (fn: string) => {
      if (fn === "b2b_retention_due") return ++dueCalls === 1 ? due(paths, [1, 2, 3]) : due([], []);
      if (fn === "b2b_retention_clear_evidence") return 3;
      if (fn === "b2b_retention_purge_transcripts") return 7;
      throw new Error(fn);
    });
    const removeFiles = vi.fn(async (_p: string[]) => undefined);
    const out = await sweepRetention({ rpc, removeFiles });
    expect(removeFiles.mock.calls.map((c) => c[0].length)).toEqual([100, 100, 50]);
    expect(rpc).toHaveBeenCalledWith("b2b_retention_clear_evidence", { _event_ids: [1, 2, 3] });
    expect(out).toEqual({ files_deleted: 250, events_cleared: 3, transcript_turns_deleted: 7, errors: [] });
  });

  it("a failed file delete keeps the evidence links (retried next run) and still purges transcripts", async () => {
    const rpc = vi.fn(async (fn: string) => (fn === "b2b_retention_due" ? due(["a.jpg"], [9]) : fn === "b2b_retention_purge_transcripts" ? 0 : 1));
    const out = await sweepRetention({ rpc, removeFiles: async () => { throw new Error("storage down"); } });
    expect(rpc).not.toHaveBeenCalledWith("b2b_retention_clear_evidence", expect.anything());
    expect(out.errors).toEqual(["storage down"]);
    expect(rpc).toHaveBeenCalledWith("b2b_retention_purge_transcripts", {});
  });

  it("never runs more than the batch limit", async () => {
    const rpc = vi.fn(async (fn: string) => (fn === "b2b_retention_due" ? due(["x.jpg"], []) : 0));
    await sweepRetention({ rpc, removeFiles: async () => undefined }, 3);
    expect(rpc.mock.calls.filter((c) => c[0] === "b2b_retention_due")).toHaveLength(3);
  });
});
