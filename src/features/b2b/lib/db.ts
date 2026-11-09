import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

// B2B tables aren't in the generated types.ts yet (regenerate after deploying the
// b2b migrations). Until then, use an untyped view of the same client — same
// session, same RLS — and type rows via ../types.
export const b2bDb = supabase as unknown as SupabaseClient;

/** PostgREST returns at most this many rows per request (Supabase's default max_rows). */
export const MAX_ROWS = 1000;

/**
 * Every row of a list, read in MAX_ROWS chunks until a short chunk. A single select (or a set-returning rpc) stops
 * at MAX_ROWS without an error, which silently truncates rosters and dashboards past 1000 rows. `page` must build a
 * fresh, stably ordered query for the given range.
 */
export async function selectAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += MAX_ROWS) {
    const { data, error } = await page(from, from + MAX_ROWS - 1);
    if (error) throw error;
    const chunk = (data ?? []) as T[];
    out.push(...chunk);
    if (chunk.length < MAX_ROWS) return out;
  }
}
