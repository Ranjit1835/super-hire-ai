// Offline-tolerant autosave queue for the test runner.
// - One pending save per question: a newer save replaces an older one (edit batches are kept and merged).
// - Saves are sent one at a time; a network or server error keeps them queued and retries with backoff
//   (1 s, 2 s, 4 s … 30 s). A refusal (the test ended, another tab took over) drops the queue and is reported.
// - The queue is mirrored to localStorage, so a crash or refresh doesn't lose unsent answers.

export interface EditEvent { t: number; op: string; at?: number; text?: string; len?: number }

export interface SaveItem {
  questionId: string;
  seq: number;
  language?: string;
  code?: string;
  mcq_choice?: string[];
  edits?: EditEvent[];
}

/** The server takes at most this many edit events per save. */
export const MAX_EDITS = 2000;

export type SaveStatus = "saved" | "saving" | "offline";

export interface SendError { status: number; code: string }

export interface AutosaveOptions {
  send: (item: SaveItem) => Promise<void>;
  onStatus?: (status: SaveStatus, pending: number) => void;
  /** A save the server refused for good (e.g. ENDED, OTHER_SESSION, DEADLINE_PASSED). */
  onFatal?: (code: string) => void;
  storageKey?: string;
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
  maxBackoffMs?: number;
}

/** Network failures (status 0), timeouts, rate limits and 5xx are retried; other errors are final. */
export function isRetryable(e: unknown): boolean {
  const status = (e as SendError | undefined)?.status;
  if (typeof status !== "number") return true;
  return status === 0 || status === 408 || status === 429 || status >= 500;
}

export class AutosaveQueue {
  private pending = new Map<string, SaveItem>();
  private flushing: Promise<void> | null = null;
  private retryHandle: unknown = null;
  private failures = 0;
  private stopped = false;
  private status: SaveStatus = "saved";

  constructor(private opts: AutosaveOptions) {
    const saved = this.read();
    for (const item of saved) this.pending.set(item.questionId, item);
    if (this.pending.size > 0) this.setStatus("saving");
  }

  get size(): number { return this.pending.size; }
  get current(): SaveStatus { return this.status; }

  /** Queue a save. Returns immediately; call flush() (the runner does on a timer and on blur). */
  put(item: SaveItem): void {
    if (this.stopped) return;
    const prev = this.pending.get(item.questionId);
    if (prev && prev.seq > item.seq) return;   // older than what's queued
    const edits = [...(prev?.edits ?? []), ...(item.edits ?? [])].slice(-MAX_EDITS);
    this.pending.set(item.questionId, { ...prev, ...item, edits: edits.length ? edits : undefined });
    this.write();
    if (this.status === "saved") this.setStatus("saving");
  }

  /** Send everything queued. Concurrent calls share one flush. */
  flush(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (!this.flushing) this.flushing = this.run().finally(() => { this.flushing = null; });
    return this.flushing;
  }

  stop(): void {
    this.stopped = true;
    if (this.retryHandle !== null) (this.opts.clearTimer ?? clearTimeout)(this.retryHandle as ReturnType<typeof setTimeout>);
    this.retryHandle = null;
  }

  private async run(): Promise<void> {
    if (this.retryHandle !== null) {
      (this.opts.clearTimer ?? clearTimeout)(this.retryHandle as ReturnType<typeof setTimeout>);
      this.retryHandle = null;
    }
    while (this.pending.size > 0 && !this.stopped) {
      const [qid, item] = this.pending.entries().next().value as [string, SaveItem];
      this.setStatus(this.failures > 0 ? "offline" : "saving");
      try {
        await this.opts.send(item);
      } catch (e) {
        if (isRetryable(e)) {
          this.failures++;
          this.setStatus("offline");
          const delay = Math.min(1000 * 2 ** (this.failures - 1), this.opts.maxBackoffMs ?? 30_000);
          this.retryHandle = (this.opts.setTimer ?? setTimeout)(() => { this.retryHandle = null; void this.flush(); }, delay);
          return;
        }
        this.pending.clear();
        this.write();
        this.stop();
        this.opts.onFatal?.((e as SendError).code ?? "ERROR");
        return;
      }
      // Only drop it if nothing newer arrived while it was in flight.
      if (this.pending.get(qid) === item) this.pending.delete(qid);
      else {
        const newer = this.pending.get(qid);
        if (newer && item.edits) newer.edits = newer.edits?.filter((ev) => !item.edits!.includes(ev));
      }
      this.failures = 0;
      this.write();
    }
    if (!this.stopped) this.setStatus("saved");
  }

  private setStatus(s: SaveStatus) {
    this.status = s;
    this.opts.onStatus?.(s, this.pending.size);
  }

  private read(): SaveItem[] {
    if (!this.opts.storage || !this.opts.storageKey) return [];
    try {
      const raw = this.opts.storage.getItem(this.opts.storageKey);
      const v = raw ? JSON.parse(raw) : [];
      return Array.isArray(v) ? (v as SaveItem[]).filter((x) => x && typeof x.questionId === "string" && typeof x.seq === "number") : [];
    } catch { return []; }
  }

  private write() {
    if (!this.opts.storage || !this.opts.storageKey) return;
    try {
      if (this.pending.size === 0) this.opts.storage.removeItem(this.opts.storageKey);
      else this.opts.storage.setItem(this.opts.storageKey, JSON.stringify([...this.pending.values()]));
    } catch { /* storage full or blocked: the in-memory queue still works */ }
  }
}

/** Saved items left in storage for an attempt (to restore unsent answers over the server copy). */
export function storedSaves(storage: Pick<Storage, "getItem"> | null, key: string): SaveItem[] {
  if (!storage) return [];
  try {
    const v = JSON.parse(storage.getItem(key) ?? "[]");
    return Array.isArray(v) ? v as SaveItem[] : [];
  } catch { return []; }
}
