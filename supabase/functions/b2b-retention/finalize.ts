// B35: scores proctoring sessions that ended without one (the tab closed before the browser's `end`, or the test or
// interview ended on the server). Same rules as b2b-proctor `end` (integrityScore). Until a session is scored, result
// pages show integrity as not scored yet, never the best of the other sessions. I/O is injected for Node tests.
import { integrityScore, type ScoreEvent } from "../_shared/contracts/proctor-rules.ts";

export interface FinalizeDeps {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<unknown>;
  events: (sessionId: string) => Promise<ScoreEvent[]>;
}
export interface FinalizeResult { scored: number; errors: string[] }

export async function finalizeIntegrity(deps: FinalizeDeps, limit = 50): Promise<FinalizeResult> {
  const out: FinalizeResult = { scored: 0, errors: [] };
  const ids = (await deps.rpc("b2b_proctor_unscored_sessions", { _limit: limit }) as string[] | null) ?? [];
  for (const id of ids) {
    try {
      const detail = integrityScore(await deps.events(id));
      const stored = await deps.rpc("b2b_proctor_store_score", {
        _session_id: id, _score: detail.score, _band: detail.band, _detail: detail,
      });
      if (stored) out.scored++;
    } catch (e) {
      out.errors.push(`${id}: ${(e as Error).message}`.slice(0, 200));
    }
  }
  return out;
}
