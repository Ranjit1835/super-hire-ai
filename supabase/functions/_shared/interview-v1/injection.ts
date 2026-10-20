// ─── Prompt-injection defence for candidate speech ────────────────────────────
// Pure TS (Deno + browser). Candidate speech is untrusted data: it is always wrapped in delimiters that it can't
// close, and attempts to steer the interviewer or the scorer are detected, ignored and logged as integrity events
// (browser: useProctor().report("prompt_injection"); server: a staff-only note on the interview).
// The detector is deliberately narrow (instructions aimed at the AI or at the score), so a candidate who talks
// about "instructions" in an ordinary technical answer isn't flagged.

export interface InjectionResult { detected: boolean; patterns: string[] }

const RULES: { id: string; re: RegExp }[] = [
  { id: "ignore_instructions", re: /\b(ignore|disregard|forget|override|bypass)\b[^.?!]{0,40}\b(previous|prior|above|earlier|your|all|the|system)\b[^.?!]{0,30}\b(instructions?|prompts?|rules?|guidelines?|directions?)\b/i },
  { id: "new_instructions", re: /\b(new|updated|real)\s+(instructions?|rules?|system prompt)\b|\byour (new )?(instructions?|task) (is|are) (now|to)\b/i },
  { id: "role_override", re: /\b(you are now|act as|pretend (to be|you are)|from now on,? you|you('| a)re no longer)\b/i },
  { id: "system_prompt", re: /\b(system prompt|developer (message|mode)|jailbreak|reveal (your|the) (prompt|instructions))\b/i },
  { id: "score_request", re: /\b(give|award|grant|assign|mark|rate|score)\s+(me|this( answer)?|my answers?|the candidate)\b[^.?!]{0,30}\b(full|maximum|max|perfect|highest|top|10|ten|five|5|100)\b[^.?!]{0,15}\b(marks?|scores?|points?|rating|out of)\b/i },
  { id: "score_request", re: /\b(full|maximum|perfect)\s+(marks?|score|points)\b[^.?!]{0,30}\b(please|for me|to me)\b/i },
  { id: "verdict_request", re: /\b(mark|rate|recommend|pass|select|hire)\s+(me|this candidate)\s+(as\s+)?(strong|excellent|selected|hired|a strong hire|passed)\b/i },
  { id: "skip_request", re: /\b(skip|end|stop)\s+(the\s+)?(rest of the |remaining )?(questions?|interview|evaluation)\b[^.?!]{0,20}\b(and|then)\b[^.?!]{0,20}\b(pass|score|mark|rate)\b/i },
  { id: "delimiter_attack", re: /<\/?\s*(candidate_answer|transcript|submitted_code|system|assistant|instructions?)\b/i },
];

export function detectInjection(text: string): InjectionResult {
  const t = (text ?? "").slice(0, 8000);
  const patterns = [...new Set(RULES.filter((r) => r.re.test(t)).map((r) => r.id))];
  return { detected: patterns.length > 0, patterns };
}

const TAGS = "candidate_answer|transcript|submitted_code|system|assistant|instructions?|code_statement";

/** Neutralise anything that could close or open our delimiters. */
export function neutralize(text: string, max = 4000): string {
  return (text ?? "")
    .replace(new RegExp(`<\\/?\\s*(${TAGS})[^>]*>`, "gi"), " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/** Wrap untrusted text in a data delimiter it can't escape. Code keeps its newlines. */
export function wrapUntrusted(tag: "candidate_answer" | "submitted_code" | "code_statement", text: string, max = 4000, attrs = ""): string {
  const body = tag === "submitted_code"
    ? (text ?? "").replace(new RegExp(`<\\/?\\s*(${TAGS})[^>]*>`, "gi"), " ").slice(0, max)
    : neutralize(text, max);
  return `<${tag}${attrs ? ` ${attrs}` : ""}>\n${body}\n</${tag}>`;
}
