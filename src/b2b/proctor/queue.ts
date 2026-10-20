// Client event queue: batches proctoring events to b2b-proctor `events`, retries with backoff, and keeps
// unsent events in sessionStorage so a reload re-sends them. Every event carries a clientEventId; the server
// ignores ids it has already stored, so retries and re-sends are safe (idempotent).

export interface QueuedEvent {
  clientEventId: string;
  type: string;
  severity: "info" | "low" | "medium" | "high";
  confidence: number;
  startedAt: string;
  endedAt?: string;
  evidencePath?: string;
  meta?: Record<string, unknown>;
}

export interface SendResult { accepted: number; violations: number; action: "none" | "warn" | "pause" | "resume" | "submit" }

export interface QueueOptions {
  send: (events: QueuedEvent[]) => Promise<SendResult>;
  onResult?: (r: SendResult) => void;
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
  storageKey?: string;
  batchMs?: number;
  maxBatch?: number;
  maxBackoffMs?: number;
}

export function uuid(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  const b = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(b); else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export class EventQueue {
  private pending: QueuedEvent[] = [];
  private inflight: Promise<boolean> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private failures = 0;
  private stopped = false;
  private readonly o: Required<Omit<QueueOptions, "onResult" | "storage" | "storageKey">> & QueueOptions;

  constructor(opts: QueueOptions) {
    this.o = { batchMs: 5000, maxBatch: 200, maxBackoffMs: 30000, ...opts };
    this.restore();
  }

  get size() { return this.pending.length; }
  get queued(): readonly QueuedEvent[] { return this.pending; }

  /** Add an event; `urgent` sends now (hard violations: the server may need to pause or submit). */
  add(e: Omit<QueuedEvent, "clientEventId"> & { clientEventId?: string }, urgent = false): string {
    const ev: QueuedEvent = { ...e, clientEventId: e.clientEventId ?? uuid() };
    if (this.pending.some((p) => p.clientEventId === ev.clientEventId)) return ev.clientEventId;
    this.pending.push(ev);
    this.persist();
    if (urgent) void this.flush();
    else this.schedule(this.o.batchMs);
    return ev.clientEventId;
  }

  /** Send one batch now. Resolves true when the batch was acknowledged (or there was nothing to send). */
  flush(): Promise<boolean> {
    if (this.inflight) return this.inflight;
    if (!this.pending.length) return Promise.resolve(true);
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    const batch = this.pending.slice(0, this.o.maxBatch);
    this.inflight = (async () => {
      try {
        const r = await this.o.send(batch);
        const sent = new Set(batch.map((b) => b.clientEventId));
        this.pending = this.pending.filter((p) => !sent.has(p.clientEventId));
        this.persist();
        this.failures = 0;
        this.o.onResult?.(r);
        if (this.pending.length) this.schedule(0);
        return true;
      } catch {
        this.failures++;
        this.schedule(Math.min(this.o.maxBackoffMs, 1000 * 2 ** this.failures));
        return false;
      } finally {
        this.inflight = null;
      }
    })();
    return this.inflight;
  }

  /** Send everything that's queued (session end). Gives up after `attempts` failed batches. */
  async drain(attempts = 3): Promise<boolean> {
    let fails = 0;
    while (this.pending.length || this.inflight) {
      const ok = await this.flush();
      if (!ok && ++fails >= attempts) return false;
    }
    return true;
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(ms: number) {
    if (this.stopped) return;
    if (this.timer) {
      if (ms > 0) return; // a flush is already scheduled
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => { this.timer = null; void this.flush(); }, ms);
  }

  private persist() {
    const { storage, storageKey } = this.o;
    if (!storage || !storageKey) return;
    try {
      if (this.pending.length) storage.setItem(storageKey, JSON.stringify(this.pending.slice(-500)));
      else storage.removeItem(storageKey);
    } catch { /* storage full or blocked: in-memory only */ }
  }

  private restore() {
    const { storage, storageKey } = this.o;
    if (!storage || !storageKey) return;
    try {
      const raw = storage.getItem(storageKey);
      const list = raw ? (JSON.parse(raw) as QueuedEvent[]) : [];
      if (Array.isArray(list)) this.pending = list.filter((e) => e && typeof e.clientEventId === "string");
      if (this.pending.length) this.schedule(0);
    } catch { /* ignore a corrupt entry */ }
  }
}
