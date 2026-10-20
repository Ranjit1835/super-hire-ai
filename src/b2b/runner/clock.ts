// Server-synced countdown. The deadline lives on the server; the browser only knows how far its own
// clock is from the server's (offset), measured from server_now on every state/heartbeat/autosave reply.
import { useEffect, useRef, useState } from "react";

export interface ServerTime { deadlineAt: string | null; serverNow: string; receivedAt: number }

/** Server clock minus local clock, in ms. */
export function clockOffset(serverNow: string, receivedAt: number): number {
  const s = Date.parse(serverNow);
  return Number.isFinite(s) ? s - receivedAt : 0;
}

/** Milliseconds left (never negative); null when there is no deadline. */
export function remainingMs(t: ServerTime, localNow: number): number | null {
  if (!t.deadlineAt) return null;
  const d = Date.parse(t.deadlineAt);
  if (!Number.isFinite(d)) return null;
  return Math.max(0, d - (localNow + clockOffset(t.serverNow, t.receivedAt)));
}

export function formatRemaining(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * Ticking countdown. Calls onExpire once when the remaining time reaches zero (not while paused).
 */
export function useCountdown(t: ServerTime | null, opts: { paused?: boolean; onExpire?: () => void; now?: () => number } = {}) {
  const now = opts.now ?? Date.now;
  const [left, setLeft] = useState<number | null>(() => (t ? remainingMs(t, now()) : null));
  const fired = useRef(false);
  const onExpire = useRef(opts.onExpire);
  onExpire.current = opts.onExpire;

  useEffect(() => {
    if (!t) return;
    const tick = () => {
      const ms = remainingMs(t, now());
      setLeft(ms);
      if (ms === 0 && !opts.paused && !fired.current) {
        fired.current = true;
        onExpire.current?.();
      }
    };
    tick();
    const h = setInterval(tick, 1000);
    return () => clearInterval(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t?.deadlineAt, t?.serverNow, t?.receivedAt, opts.paused]);

  return left;
}
