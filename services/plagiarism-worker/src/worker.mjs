// Drains the similarity queue: claim a run (b2b_similarity_claim), compare its submissions, report the pairs
// (b2b_similarity_complete). The database is the queue; this process holds no state between requests.
import { timingSafeEqual } from "node:crypto";

export const ENGINE = "dolos-lib 3.6.0";

/** Constant-time check of "Authorization: Bearer <token>". */
export function authorized(header, token) {
  const given = Buffer.from(String(header ?? "").replace(/^Bearer\s+/i, ""));
  const want = Buffer.from(token);
  return want.length > 0 && given.length === want.length && timingSafeEqual(given, want);
}

export function supabaseRpc({ url, serviceKey, fetchImpl = fetch }) {
  return async (fn, args) => {
    const res = await fetchImpl(`${url}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });
    if (!res.ok) throw new Error(`${fn} failed: HTTP ${res.status}`);
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  };
}

/**
 * Processes queued runs until the queue is empty or the time budget is spent.
 * A run that throws is reported as an error (the database retries it, 3 tries in all); the loop carries on.
 */
export async function drain({ rpc, analyze, budgetMs = 8 * 60_000, now = Date.now, log = console.log }) {
  const started = now();
  const done = { runs: 0, failed: 0, pairs: 0 };
  while (now() - started < budgetMs) {
    const job = await rpc("b2b_similarity_claim", { _engine: ENGINE });
    if (!job) break;
    try {
      const pairs = await analyze(job);
      await rpc("b2b_similarity_complete", { _run_id: job.run_id, _pairs: pairs, _error: null });
      done.runs++;
      done.pairs += pairs.length;
      log(JSON.stringify({ msg: "run done", run: job.run_id, submissions: job.submissions.length, pairs: pairs.length }));
    } catch (e) {
      done.failed++;
      const error = e instanceof Error ? e.message : String(e);
      log(JSON.stringify({ msg: "run failed", run: job.run_id, error }));
      await rpc("b2b_similarity_complete", { _run_id: job.run_id, _pairs: null, _error: error }).catch(() => {});
    }
  }
  return done;
}
