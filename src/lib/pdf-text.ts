// Text for PDFs drawn with pdf-lib's standard fonts (Helvetica, Times). They only support the
// WinAnsi character set; anything else makes pdf-lib throw ("WinAnsi cannot encode ..."), which
// used to fail the whole download — e.g. a "Rs" sign, a Hindi name, or a line break in a bullet.

// WinAnsi (Windows-1252) = printable ASCII, Latin-1 (A0–FF) and these extras.
const WIN_ANSI_EXTRAS = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152,
  0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a,
  0x0153, 0x017e, 0x0178,
]);

const isWinAnsi = (cp: number) => (cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff) || WIN_ANSI_EXTRAS.has(cp);

// Common characters with a readable WinAnsi equivalent.
const REPLACEMENTS: Record<number, string> = {
  0x20b9: "Rs.", // Indian rupee sign
  0x2192: "->", 0x2190: "<-", 0x2194: "<->", 0x21d2: "=>",
  0x2212: "-", 0x2010: "-", 0x2011: "-", 0x2012: "-", 0x2015: "-",
  0x2032: "'", 0x2033: '"', 0x2248: "~", 0x2264: "<=", 0x2265: ">=", 0x2260: "!=",
  0x2713: "", 0x2714: "", 0x2715: "", 0x25cf: String.fromCodePoint(0x2022), 0x25aa: String.fromCodePoint(0x2022), 0x25e6: String.fromCodePoint(0x2022), 0x2023: String.fromCodePoint(0x2022), 0x2043: "-",
  0x00a0: " ", 0x2002: " ", 0x2003: " ", 0x2009: " ", 0x200a: " ", 0x202f: " ", 0x2007: " ",
  0x200b: "", 0x200c: "", 0x200d: "", 0xfe0f: "", 0xfeff: "",
};

export interface SafeText { text: string; dropped: number }

/**
 * Make one line of text drawable with standard fonts. Line breaks and tabs become spaces
 * (split into lines first if you need them). Unsupported characters are replaced when there is
 * a sensible equivalent, reduced to their base letter when accented, otherwise dropped and counted.
 */
export function toWinAnsi(input: string | null | undefined): SafeText {
  if (!input) return { text: "", dropped: 0 };
  let out = "";
  let dropped = 0;
  for (const ch of input.replace(/[\r\n\t\f\v]+/g, " ")) {
    const cp = ch.codePointAt(0)!;
    if (isWinAnsi(cp)) { out += ch; continue; }
    if (cp in REPLACEMENTS) { out += REPLACEMENTS[cp]; continue; }
    // Accented letters outside Latin-1 (e.g. Polish, Czech): keep the base letter.
    const base = ch.normalize("NFKD").replace(/\p{M}+/gu, "");
    if (base && [...base].every((c) => isWinAnsi(c.codePointAt(0)!))) { out += base; continue; }
    if (cp < 0x20) continue; // control characters
    dropped++;
  }
  return { text: out.replace(/ {2,}/g, " ").trim(), dropped };
}

export const safe = (s: string | null | undefined) => toWinAnsi(s).text;

/** Count characters anywhere in a content object that can't appear in the PDF (e.g. Devanagari). */
export function countUnsupportedChars(content: unknown): number {
  let n = 0;
  const walk = (v: unknown) => {
    if (typeof v === "string") n += toWinAnsi(v).dropped;
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(content);
  return n;
}

/** Deep-sanitise every string in a content object (for exporters that take structured content). */
export function sanitizeDeep<T>(content: T): T {
  if (typeof content === "string") return safe(content) as unknown as T;
  if (Array.isArray(content)) return content.map((v) => sanitizeDeep(v)) as unknown as T;
  if (content && typeof content === "object") {
    return Object.fromEntries(Object.entries(content).map(([k, v]) => [k, sanitizeDeep(v)])) as T;
  }
  return content;
}

/**
 * Split free text into bullet items: one per line, or per "•"/"-"/"*" marker. Returns a single
 * item when the text is one paragraph.
 */
export function toBullets(text: string | null | undefined): string[] {
  if (!text) return [];
  const bullet = String.fromCodePoint(0x2022);
  return text
    .split(/\r?\n/)
    .flatMap((line) => line.split(new RegExp(`\\s*${bullet}\\s*`)))
    .map((l) => l.replace(/^\s*(?:[-*]|\d+[.)])\s+/, "").trim())
    .filter(Boolean);
}
