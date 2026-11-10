// No repeated questions (owner, 2026-11-10). Two questions are the same when their wording, ignoring case,
// punctuation and filler words, shares most of its words; numbers count, so "120 km in 2 hours" and "150 km in
// 3 hours" stay different questions. Used by AI generation (b2b-assess) and the bank seed. No Deno or browser APIs.

const FILLER = new Set(["a", "an", "the", "of", "in", "on", "to", "is", "are", "was", "be", "and", "or", "for", "by", "with",
  "what", "which", "who", "how", "its", "it", "this", "that", "at", "as", "from", "if", "then", "find", "choose", "select"]);

/** The words that carry meaning, lowercased; numbers kept as written (60 and 60.0 differ on purpose). */
export function wordsOf(text: string): Set<string> {
  return new Set(text.toLowerCase().replace(/[^a-z0-9.%₹\s]/g, " ").split(/\s+/)
    .map((w) => w.replace(/^\.+|\.+$/g, "")).filter((w) => w.length > 0 && !FILLER.has(w)));
}

/** Jaccard overlap of the meaningful words, 0..1. */
export function overlap(a: string, b: string): number {
  const x = wordsOf(a), y = wordsOf(b);
  if (!x.size || !y.size) return 0;
  let both = 0;
  for (const w of x) if (y.has(w)) both++;
  return both / (x.size + y.size - both);
}

export const SAME_QUESTION = 0.8;

/** Same options and this much of the wording: a reworded copy ("Which is NOT a deadlock condition?" twice). */
export const SAME_WITH_OPTIONS = 0.4;

export interface QuestionText { title: string; statement: string; options?: { text: string }[] | null }

/** MCQ options as one comparable key, ignoring order, case and punctuation. Null when there are none. */
function optionKey(q: QuestionText): string | null {
  if (!q.options?.length) return null;
  return q.options.map((o) => [...wordsOf(o.text)].join(" ")).sort().join("|");
}

/**
 * The existing question this one repeats, if any: the same title; statements at least SAME_QUESTION alike; or the
 * same set of options with statements at least SAME_WITH_OPTIONS alike.
 */
export function repeats(q: QuestionText, existing: QuestionText[]): QuestionText | null {
  const title = q.title.trim().toLowerCase();
  const opts = optionKey(q);
  return existing.find((e) => {
    if (e.title.trim().toLowerCase() === title) return true;
    const o = overlap(e.statement, q.statement);
    return o >= SAME_QUESTION || (opts !== null && o >= SAME_WITH_OPTIONS && optionKey(e) === opts);
  }) ?? null;
}

/** A compact list for the model: "write something different from these". Newest first, capped so the prompt stays small. */
export function avoidList(existing: QuestionText[], max = 40): string {
  if (!existing.length) return "";
  const lines = existing.slice(0, max).map((e) => `- ${e.title}: ${e.statement.replace(/\s+/g, " ").slice(0, 160)}`);
  return `Already in the bank. Write a question that is clearly different from every one of these (different scenario, numbers and wording):\n${lines.join("\n")}`;
}
