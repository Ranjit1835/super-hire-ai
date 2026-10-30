// Runs anywhere (no native modules): report mapping, the queue loop, auth.
import { test } from "node:test";
import assert from "node:assert/strict";
import { filesFor, pairsFromReport, FLOOR } from "../src/pairs.mjs";
import { authorized, drain, supabaseRpc } from "../src/worker.mjs";

const sel = (r) => ({ startRow: r, startCol: 0, endRow: r + 2, endCol: 5 });
const fakePair = (l, r, similarity) => ({
  leftFile: { path: l }, rightFile: { path: r }, similarity, longest: 9, overlap: 20,
  buildFragments: () => [{ leftSelection: sel(1), rightSelection: sel(4) }],
});

test("maps Dolos pairs back to attempts, most similar first, above the floor only", () => {
  const { attemptByPath } = filesFor([{ attempt_id: "A", code: "x" }, { attempt_id: "B", code: "y" }, { attempt_id: "C", code: "z" }], "python");
  const report = { allPairs: () => [fakePair("s0.py", "s2.py", 0.55), fakePair("s0.py", "s1.py", 0.912345), fakePair("s1.py", "s2.py", FLOOR - 0.01),
                                    fakePair("starter.py", "s1.py", 0.99)] };
  assert.deepEqual(pairsFromReport(report, attemptByPath), [
    { attempt_a: "A", attempt_b: "B", similarity: 0.9123, longest: 9, overlap: 20, fragments: [{ a: [1, 0, 3, 5], b: [4, 0, 6, 5] }] },
    { attempt_a: "A", attempt_b: "C", similarity: 0.55, longest: 9, overlap: 20, fragments: [{ a: [1, 0, 3, 5], b: [4, 0, 6, 5] }] },
  ]);
});

test("refuses languages it can't parse", () => {
  assert.throws(() => filesFor([], "brainfuck"), /unsupported language/);
});

test("drains the queue, reports failures for retry, and stops when empty", async () => {
  const jobs = [{ run_id: "r1", language: "python", submissions: [1, 2] }, { run_id: "r2", language: "python", submissions: [1, 2] }];
  const calls = [];
  const rpc = async (fn, args) => {
    calls.push([fn, args]);
    return fn === "b2b_similarity_claim" ? jobs.shift() ?? null : { ok: true };
  };
  const analyze = async (job) => { if (job.run_id === "r2") throw new Error("parser crashed"); return [{ attempt_a: "A" }]; };
  const done = await drain({ rpc, analyze, log: () => {} });
  assert.deepEqual(done, { runs: 1, failed: 1, pairs: 1 });
  const completes = calls.filter(([fn]) => fn === "b2b_similarity_complete").map(([, a]) => a);
  assert.deepEqual(completes, [
    { _run_id: "r1", _pairs: [{ attempt_a: "A" }], _error: null },
    { _run_id: "r2", _pairs: null, _error: "parser crashed" },
  ]);
});

test("stops at the time budget", async () => {
  let t = 0;
  const rpc = async (fn) => (fn === "b2b_similarity_claim" ? { run_id: "r", submissions: [] } : { ok: true });
  const done = await drain({ rpc, analyze: async () => { t += 60_000; return []; }, budgetMs: 120_000, now: () => t, log: () => {} });
  assert.equal(done.runs, 2);
});

test("calls Supabase RPCs with the service key and surfaces HTTP errors", async () => {
  const seen = [];
  const fetchImpl = async (url, init) => { seen.push({ url, init }); return { ok: url.endsWith("claim"), status: 500, text: async () => "null" }; };
  const rpc = supabaseRpc({ url: "https://x.supabase.co", serviceKey: "svc", fetchImpl });
  assert.equal(await rpc("b2b_similarity_claim", { _engine: "e" }), null);
  assert.equal(seen[0].init.headers.Authorization, "Bearer svc");
  await assert.rejects(rpc("b2b_similarity_complete", {}), /HTTP 500/);
});

test("bearer token check", () => {
  assert.equal(authorized("Bearer s3cret", "s3cret"), true);
  assert.equal(authorized("Bearer s3cre", "s3cret"), false);
  assert.equal(authorized(undefined, "s3cret"), false);
  assert.equal(authorized("Bearer ", ""), false);
});
