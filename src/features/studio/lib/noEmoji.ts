// Mirrors supabase/functions/_shared/no-emoji.ts. Used when displaying Studio messages and
// suggestions saved before the no-emoji rule, so old conversations render cleanly too.
const EMOJI_RE = /[ ]?(?:(?![\u00A9\u00AE\u2122])\p{Extended_Pictographic}|\p{Regional_Indicator}|[\u{1F3FB}-\u{1F3FF}]|\u200D|\uFE0F|\u20E3)+/gu;

export function stripEmoji(text: string): string {
  return text.replace(EMOJI_RE, "");
}
