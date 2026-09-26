// One rule for every prompt that writes resume text for a user (fix, enhance, studio chat,
// analysis previews). Users paste this text into real applications and get asked about it in
// interviews, so the model must never invent numbers, scale or outcomes.
//
// Where a bullet would be stronger with a number the resume doesn't contain, the model writes a
// bracketed placeholder that tells the user what to measure, e.g. "cut build time by [X%]".
// The frontend highlights /\[[^\]\n]{1,40}\]/ placeholders and warns before download.

export const PLACEHOLDER_PATTERN = /\[[^\]\n]{1,40}\]/g;

export const NO_INVENTED_METRICS_RULE = `
TRUTHFULNESS — NON-NEGOTIABLE:
- Use ONLY numbers, percentages, amounts, team sizes, user counts, dates and outcomes that appear in the candidate's own resume text or messages. Never invent, estimate or "round up" figures, and never add scale (users, requests, revenue, uptime) the resume doesn't state.
- If a bullet would be stronger with a metric the resume doesn't give, write a short bracketed placeholder the candidate must fill in, naming what to measure: e.g. "Reduced page load time by [X%]", "Led a team of [N] engineers", "used by [number of users] students". Keep placeholders under 40 characters and never put a guessed number inside them.
- Do not invent employers, roles, projects, tools, certifications, awards or results.`;

export function countPlaceholders(text: string): number {
  return (text.match(PLACEHOLDER_PATTERN) ?? []).length;
}
