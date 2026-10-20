// Editor integrity signals: external paste blocked (copying within the test is fine), large single
// insertions and typing bursts reported. Pure helpers + a DOM guard, so they are tested without Monaco.

export interface PasteGuardOptions {
  /** Text currently selected inside the test (what a copy/cut inside it would put on the clipboard). */
  getSelectionText: () => string;
  onBlocked: (info: { length: number }) => void;
  /** An internal paste went through (so the size monitor doesn't flag it). */
  onAllowed?: () => void;
}

/**
 * Attach capture-phase listeners to the editor container. Copy/cut inside the container remember the copied
 * text; a paste is allowed only if the clipboard holds exactly that text. Returns a detach function.
 */
export function attachPasteGuard(el: HTMLElement, opts: PasteGuardOptions): () => void {
  let internal: string | null = null;
  const remember = () => { internal = opts.getSelectionText(); };
  const onPaste = (e: ClipboardEvent) => {
    const text = e.clipboardData?.getData("text/plain") ?? e.clipboardData?.getData("text") ?? "";
    if (internal !== null && text === internal) { opts.onAllowed?.(); return; }
    e.preventDefault();
    e.stopPropagation();
    opts.onBlocked({ length: text.length });
  };
  const onDrop = (e: DragEvent) => {   // dragging text in from outside is a paste too
    e.preventDefault();
    e.stopPropagation();
    opts.onBlocked({ length: e.dataTransfer?.getData("text/plain")?.length ?? 0 });
  };
  el.addEventListener("copy", remember, true);
  el.addEventListener("cut", remember, true);
  el.addEventListener("paste", onPaste as EventListener, true);
  el.addEventListener("drop", onDrop as EventListener, true);
  return () => {
    el.removeEventListener("copy", remember, true);
    el.removeEventListener("cut", remember, true);
    el.removeEventListener("paste", onPaste as EventListener, true);
    el.removeEventListener("drop", onDrop as EventListener, true);
  };
}

export const LARGE_INSERT_CHARS = 120;
export const BURST_CHARS_PER_10S = 250;

/**
 * Watches insertions: one insertion of LARGE_INSERT_CHARS+ characters (that wasn't an allowed internal paste,
 * e.g. an autocomplete expansion or a sneaked-in paste) → "large_paste"; more than BURST_CHARS_PER_10S characters
 * typed within 10 s → "typing_burst" (at most once a minute).
 */
export function createTypingMonitor(report: (type: "large_paste" | "typing_burst", meta: Record<string, unknown>) => void,
                                    now: () => number = Date.now) {
  const window: { t: number; n: number }[] = [];
  let lastBurst = -Infinity;
  let allowNext = false;
  return {
    /** The next insertion is an allowed internal paste. */
    allowNextInsert() { allowNext = true; },
    onInsert(chars: number) {
      const t = now();
      if (allowNext) { allowNext = false; return; }
      if (chars >= LARGE_INSERT_CHARS) { report("large_paste", { chars }); return; }
      window.push({ t, n: chars });
      while (window.length && window[0].t < t - 10_000) window.shift();
      const sum = window.reduce((s, x) => s + x.n, 0);
      if (sum > BURST_CHARS_PER_10S && t - lastBurst > 60_000) {
        lastBurst = t;
        report("typing_burst", { chars_in_10s: sum });
      }
    },
  };
}
