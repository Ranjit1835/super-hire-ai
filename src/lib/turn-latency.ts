// Voice-interview turn latency: from the moment the candidate stops speaking to the moment the
// interviewer's next question becomes audible. Measured in the browser and sent with the next
// request; the edge function writes one "[VOICE-LATENCY]" log line per turn. Logging only: nothing
// here changes what the interview does.
//
//   heard ─ silence wait ─ closed ─ (client) ─ sent ─ request ─ replied ─ audio start ─ audible
//
// The silence wait is the fixed "you've stopped talking" timeout; request is network + edge
// function + model; audio start is the browser's text-to-speech warm-up.

export interface TurnLatency {
  /** Candidate's last recognised speech → first audio of the next interviewer turn. */
  turn_end_to_first_audio_ms: number;
  silence_wait_ms: number | null;
  request_ms: number | null;
  audio_start_ms: number | null;
}

/** Anything longer is not a turn (tab in the background, laptop asleep): drop it. */
const MAX_MS = 5 * 60 * 1000;

export function createTurnTimer(clock: () => number = () => performance.now()) {
  let heard: number | null = null;
  let closed: number | null = null;
  let sent: number | null = null;
  let replied: number | null = null;
  let pending: TurnLatency | null = null;
  const clear = () => { heard = closed = sent = replied = null; };
  const ms = (a: number | null, b: number | null) => (a !== null && b !== null && b >= a ? Math.round(b - a) : null);

  return {
    /** A new answer is starting: forget a turn that never reached a reply (re-prompts, retries). */
    reset: clear,
    /** Speech was recognised (call on every result; the last one wins). `at` defaults to now. */
    heard(at?: number) { heard = at ?? clock(); },
    /** The answer was closed and is about to be submitted. */
    closed() { closed = clock(); if (heard === null) heard = closed; },
    sent() { sent = clock(); },
    replied() { replied = clock(); },
    /** The next interviewer turn started playing. Completes the turn if it had a reply. */
    audible() {
      if (replied === null || heard === null) return;
      const now = clock();
      const total = Math.round(now - heard);
      if (total >= 0 && total <= MAX_MS) {
        pending = {
          turn_end_to_first_audio_ms: total,
          silence_wait_ms: ms(heard, closed),
          request_ms: ms(sent, replied),
          audio_start_ms: ms(replied, now),
        };
      }
      clear();
    },
    /** The finished measurement, once; send it with the next request. */
    take(): TurnLatency | null { const p = pending; pending = null; return p; },
  };
}

export type TurnTimer = ReturnType<typeof createTurnTimer>;
