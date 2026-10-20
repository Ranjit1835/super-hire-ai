// One structured log line per voice-interview turn, sent by the browser with the next request
// (src/lib/turn-latency.ts). Logging only: never throws, never changes the response.
// Query in Supabase → Edge Functions → Logs: search "[VOICE-LATENCY]".

const FIELDS = ["turn_end_to_first_audio_ms", "silence_wait_ms", "request_ms", "audio_start_ms"] as const;

/** Whole milliseconds in 0..5 min, else null. */
function ms(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 300_000 ? Math.round(v) : null;
}

export function logTurnLatency(source: string, sessionId: unknown, raw: unknown): void {
  try {
    if (!raw || typeof raw !== "object") return;
    const r = raw as Record<string, unknown>;
    const out: Record<string, number | null> = {};
    for (const f of FIELDS) out[f] = ms(r[f]);
    if (out.turn_end_to_first_audio_ms === null) return;
    const id = typeof sessionId === "string" ? sessionId.slice(0, 64) : null;
    console.log(`[VOICE-LATENCY] ${JSON.stringify({ source, session: id, ...out })}`);
  } catch { /* logging must never break a turn */ }
}
