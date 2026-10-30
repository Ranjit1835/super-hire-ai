// R2.7 code playback: rebuild a coding answer from its edit log (edit_history, see runner/CodeEditor.tsx) and point
// out where code appeared in a way people don't type. Flags are prompts to watch that moment, never a verdict.
//
// Log events: { t: epoch ms, op: "ins", at, text } | { op: "del", at, len } | { op: "lang", text } | { op: "paste_blocked", len }.
// Each language has its own buffer starting at the question's starter code, as in the runner.

export interface ReplayEvent { t: number; op: string; at?: number; text?: string; len?: number }
export interface ReplayQuestion {
  question_id: string; title: string; languages: string[]; starter_code: Record<string, string> | null;
  final_language: string | null; final_code: string | null; events: ReplayEvent[]; truncated: boolean;
}
export interface ReplayData {
  attempt_id: string; status: string; started_at: string | null; submitted_at: string | null; questions: ReplayQuestion[];
}

export type FlagKind = "large_insert" | "fast_typing" | "little_typing" | "paste_blocked";
export interface ReplayFlag { kind: FlagKind; index: number; t: number; severity: "low" | "medium" | "high"; detail: string }

/** A single insertion at least this long, not copied from the student's own code, is flagged. */
export const LARGE_INSERT = 80;
/** Typed (small) insertions adding up to this many characters inside FAST_WINDOW_MS is faster than people type. */
export const FAST_CHARS = 300;
export const FAST_WINDOW_MS = 10_000;
/** Gaps longer than this play back as this long, so a 10-minute pause doesn't stall the replay. */
export const MAX_GAP_MS = 3_000;
const CHECKPOINT_EVERY = 200;

interface State { lang: string; buffers: Record<string, string> }

export interface Replay {
  question: ReplayQuestion;
  /** Number of steps; position p shows the code after the first p events. */
  length: number;
  /** Playback clock (ms from the first event, long gaps shortened) at each position 0..length. */
  playT: number[];
  t0: number | null;
  /** Code and language after the first p events. */
  at: (p: number) => { lang: string; code: string };
  /** True when replaying the whole log gives exactly the saved answer. */
  exact: boolean;
  flags: ReplayFlag[];
  stats: { typedChars: number; insertedChars: number; deletedChars: number; durationMs: number };
}

function startState(q: ReplayQuestion): State {
  const buffers: Record<string, string> = {};
  for (const l of q.languages) buffers[l] = q.starter_code?.[l] ?? "";
  const switches = q.events.some((e) => e.op === "lang");
  const lang = (switches ? q.languages[0] : q.final_language) ?? q.final_language ?? q.languages[0] ?? "python";
  if (!(lang in buffers)) buffers[lang] = q.starter_code?.[lang] ?? "";
  return { lang, buffers };
}

/** Applies one event in place. Returns false when the event didn't fit the buffer (log and code disagree). */
function apply(s: State, e: ReplayEvent): boolean {
  if (e.op === "lang") {
    if (typeof e.text === "string" && e.text) {
      s.lang = e.text;
      if (!(e.text in s.buffers)) s.buffers[e.text] = "";
    }
    return true;
  }
  if (e.op !== "ins" && e.op !== "del") return true;
  const buf = s.buffers[s.lang] ?? "";
  const at = Math.max(0, Math.floor(Number(e.at ?? 0)));
  let fits = at <= buf.length;
  const pos = Math.min(at, buf.length);
  if (e.op === "ins") {
    s.buffers[s.lang] = buf.slice(0, pos) + (e.text ?? "") + buf.slice(pos);
  } else {
    const len = Math.max(0, Math.floor(Number(e.len ?? 0)));
    fits = fits && pos + len <= buf.length;
    s.buffers[s.lang] = buf.slice(0, pos) + buf.slice(pos + len);
  }
  return fits;
}

const clone = (s: State): State => ({ lang: s.lang, buffers: { ...s.buffers } });

export function buildReplay(q: ReplayQuestion): Replay {
  const events = q.events.filter((e) => e && typeof e === "object" && typeof e.op === "string");
  const state = startState(q);
  const checkpoints: State[] = [clone(state)];
  const flags: ReplayFlag[] = [];
  let fits = true, typedChars = 0, insertedChars = 0, deletedChars = 0, blocked = 0;
  const typed: { t: number; n: number }[] = [];   // small insertions, for the speed check
  let lastFast = -Infinity;

  events.forEach((e, i) => {
    if (e.op === "ins" && typeof e.text === "string") {
      const n = e.text.length;
      insertedChars += n;
      if (n <= 2) typedChars += n;
      const body = e.text.trim();
      if (n >= LARGE_INSERT && body.length >= LARGE_INSERT / 2) {
        // Copying the student's own code (allowed by the paste guard) is fine; code that wasn't there before isn't.
        const own = Object.values(state.buffers).some((b) => b.includes(body));
        if (!own) flags.push({ kind: "large_insert", index: i, t: e.t, severity: "high",
          detail: `${n} characters appeared at once` });
      } else if (n < LARGE_INSERT) {
        typed.push({ t: e.t, n });
        let sum = 0;
        for (let j = typed.length - 1; j >= 0 && e.t - typed[j].t <= FAST_WINDOW_MS; j--) sum += typed[j].n;
        if (sum >= FAST_CHARS && e.t - lastFast > FAST_WINDOW_MS) {
          lastFast = e.t;
          flags.push({ kind: "fast_typing", index: i, t: e.t, severity: "high",
            detail: `${sum} characters typed in under ${FAST_WINDOW_MS / 1000} seconds` });
        }
      }
    } else if (e.op === "del") {
      deletedChars += Math.max(0, Number(e.len ?? 0));
    } else if (e.op === "paste_blocked") {
      blocked++;
    }
    if (!apply(state, e)) fits = false;
    if ((i + 1) % CHECKPOINT_EVERY === 0) checkpoints.push(clone(state));
  });

  const finalLang = q.final_language ?? state.lang;
  const exact = fits && !q.truncated && q.final_code != null && (state.buffers[finalLang] ?? "") === q.final_code;
  const written = (q.final_code ?? "").length - (q.starter_code?.[finalLang] ?? "").length;
  if (written >= 200 && typedChars < written * 0.25) {
    flags.push({ kind: "little_typing", index: Math.max(0, events.length - 1), t: events.at(-1)?.t ?? 0, severity: "medium",
      detail: `Only ${typedChars} of about ${written} characters were typed key by key` });
  }
  if (blocked > 0) {
    const first = events.findIndex((e) => e.op === "paste_blocked");
    flags.push({ kind: "paste_blocked", index: first, t: events[first].t, severity: "low",
      detail: `${blocked} paste${blocked === 1 ? "" : "s"} from outside the editor blocked` });
  }
  flags.sort((a, b) => a.index - b.index);

  const t0 = events.length ? events[0].t : null;
  const playT = [0];
  for (let i = 0; i < events.length; i++) {
    const gap = i === 0 ? 0 : Math.max(0, events[i].t - events[i - 1].t);
    playT.push(playT[i] + Math.min(gap, MAX_GAP_MS));
  }

  const at = (p: number) => {
    const pos = Math.max(0, Math.min(events.length, Math.floor(p)));
    const s = clone(checkpoints[Math.floor(pos / CHECKPOINT_EVERY)]);
    for (let i = Math.floor(pos / CHECKPOINT_EVERY) * CHECKPOINT_EVERY; i < pos; i++) apply(s, events[i]);
    return { lang: s.lang, code: s.buffers[s.lang] ?? "" };
  };

  return {
    question: q, length: events.length, playT, t0, at, exact, flags,
    stats: { typedChars, insertedChars, deletedChars, durationMs: t0 == null ? 0 : (events.at(-1)!.t - t0) },
  };
}

/** The last position whose playback time is at or before `ms`. */
export function positionAt(playT: number[], ms: number): number {
  let lo = 0, hi = playT.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (playT[mid] <= ms) lo = mid; else hi = mid - 1;
  }
  return lo;
}

export function clock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
