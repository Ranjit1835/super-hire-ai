import { Fragment, type ReactNode } from "react";

// AI-written resume text uses bracketed placeholders like "[X%]" or "[number of users]" where
// the candidate's resume didn't state a number (see supabase/functions/_shared/resume-honesty.ts).
// Same pattern as the backend: short, single-line, bracketed.
export const PLACEHOLDER_RE = /\[[^\]\n]{1,40}\]/g;

export const hasPlaceholder = (text: string | null | undefined) => !!text && new RegExp(PLACEHOLDER_RE.source).test(text);

/** Count placeholders anywhere in a (nested) resume content object. */
export function countPlaceholders(content: unknown): number {
  let n = 0;
  const walk = (v: unknown) => {
    if (typeof v === "string") n += (v.match(PLACEHOLDER_RE) ?? []).length;
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(content);
  return n;
}

/** Renders text with each placeholder highlighted so the candidate notices and fills it in. */
export function Placeholders({ text }: { text: string | null | undefined }) {
  if (!text) return null;
  const parts: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(PLACEHOLDER_RE)) {
    if (m.index! > last) parts.push(text.slice(last, m.index));
    parts.push(
      <mark key={m.index} title="Replace with your real number before downloading" className="rounded px-0.5 bg-amber-400/25 text-amber-200 font-medium">
        {m[0]}
      </mark>,
    );
    last = m.index! + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts.map((p, i) => <Fragment key={i}>{p}</Fragment>)}</>;
}
