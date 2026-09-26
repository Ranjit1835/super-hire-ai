// Studio text is professional resume content: no emojis in AI replies, suggestions or saved text.
// Keeps the copyright, registered and trademark signs (they appear in company/product names). Keycaps like 1+U+20E3 become 1.
// Mirrors src/features/studio/lib/noEmoji.ts.
const EMOJI_RE = /[ ]?(?:(?![\u00A9\u00AE\u2122])\p{Extended_Pictographic}|\p{Regional_Indicator}|[\u{1F3FB}-\u{1F3FF}]|\u200D|\uFE0F|\u20E3)+/gu;

export function stripEmoji(text: string): string {
  return text.replace(EMOJI_RE, "");
}

export const NO_EMOJI_RULE = `
STYLE: Never use emojis, emoticons or decorative symbols in any text you write — replies, explanations, suggestions or resume content. Write plain, professional text.`;
