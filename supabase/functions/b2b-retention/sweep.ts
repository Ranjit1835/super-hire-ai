// The retention sweep with its I/O injected, so it runs in Node tests with fakes (supabase/tests/unit/retention.test.ts).
export interface RetentionDeps {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<unknown>;
  removeFiles: (paths: string[]) => Promise<void>;
}
export interface RetentionResult { files_deleted: number; events_cleared: number; transcript_turns_deleted: number; errors: string[] }

const CHUNK = 100;   // Storage API remove() limit per call

export async function sweepRetention(deps: RetentionDeps, batches = 5): Promise<RetentionResult> {
  const out: RetentionResult = { files_deleted: 0, events_cleared: 0, transcript_turns_deleted: 0, errors: [] };
  for (let b = 0; b < batches; b++) {
    const due = await deps.rpc("b2b_retention_due", { _limit: 500 }) as { paths: string[]; event_ids: number[] };
    if (!due.paths.length && !due.event_ids.length) break;
    let ok = true;
    for (let i = 0; i < due.paths.length; i += CHUNK) {
      try {
        await deps.removeFiles(due.paths.slice(i, i + CHUNK));
        out.files_deleted += Math.min(CHUNK, due.paths.length - i);
      } catch (e) {
        ok = false;
        out.errors.push((e as Error).message.slice(0, 200));
      }
    }
    // Clear links only when every file in the batch is gone, so a failed delete is retried next run.
    if (!ok) break;
    if (due.event_ids.length) out.events_cleared += Number(await deps.rpc("b2b_retention_clear_evidence", { _event_ids: due.event_ids }));
  }
  try {
    out.transcript_turns_deleted = Number(await deps.rpc("b2b_retention_purge_transcripts", {}));
  } catch (e) {
    out.errors.push((e as Error).message.slice(0, 200));
  }
  return out;
}
