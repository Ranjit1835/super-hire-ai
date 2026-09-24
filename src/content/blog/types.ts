// Blog articles are plain data so they pre-render to HTML and stay type-checked.
// Inline text supports **bold** and [link text](/path) — see renderInline in BlogPost.tsx.
export type Block =
  | { type: "p"; text: string }
  | { type: "h2"; text: string }
  | { type: "h3"; text: string }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] }
  | { type: "tip"; title: string; text: string }
  | { type: "example"; bad: string; good: string; note?: string }
  | { type: "table"; head: string[]; rows: string[][] }
  | { type: "cta"; kind: "ats" | "interview" | "builder" };

export interface Article {
  slug: string;
  category: "ATS Basics" | "Resume Tips" | "Keywords" | "Interviews" | "Common Mistakes" | "For Students";
  title: string;
  /** <title> tag; defaults to title. Keep under ~60 characters. */
  seoTitle?: string;
  /** Meta description, 140–160 characters. */
  description: string;
  published: string; // YYYY-MM-DD
  updated: string; // YYYY-MM-DD
  readMinutes: number;
  keywords: string[];
  body: Block[];
  faq?: { q: string; a: string }[];
}
