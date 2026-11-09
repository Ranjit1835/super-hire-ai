// Candidate invite lists from CSV / XLSX (email, name, phone): header detection, row validation and in-file
// duplicates. File reading reuses the college importer (readTable); the server dedupes again per role.
import { CandidateInput } from "../../../../supabase/functions/_shared/contracts/company";
import { normHeader } from "../../college/lib/import";

export { readTable } from "../../college/lib/import";

export type CandidateField = "email" | "full_name" | "phone";
export type CandidateMapping = Partial<Record<CandidateField, number>>;
export interface CandidateRowIn { row: number; email: string; fullName: string; phone?: string }
export interface CandidateRowError { row: number; message: string }
export const MAX_INVITE_ROWS = 500;

const ALIASES: Record<CandidateField, string[]> = {
  email: ["email", "email id", "e mail", "email address", "mail", "mail id", "emailid", "candidate email"],
  full_name: ["name", "full name", "candidate name", "candidate", "applicant", "applicant name", "fullname"],
  phone: ["phone", "phone no", "phone number", "mobile", "mobile no", "mobile number", "contact", "contact number", "whatsapp"],
};

export function detectCandidateMapping(headers: string[]): CandidateMapping {
  const norm = headers.map(normHeader);
  const m: CandidateMapping = {};
  (Object.keys(ALIASES) as CandidateField[]).forEach((f) => {
    const exact = norm.findIndex((h) => ALIASES[f].includes(h));
    const loose = exact >= 0 ? exact : norm.findIndex((h, i) => !Object.values(m).includes(i) &&
      (f === "email" ? /\be ?mail\b/.test(h) : f === "phone" ? /\b(phone|mobile|contact)\b/.test(h) : /\bname\b/.test(h)));
    if (loose >= 0) m[f] = loose;
  });
  return m;
}

/** Rows (header first) → valid invite rows + errors + in-file duplicates (later rows lose). */
export function buildCandidateRows(table: string[][], m: CandidateMapping): { rows: CandidateRowIn[]; errors: CandidateRowError[]; duplicates: number[] } {
  const rows: CandidateRowIn[] = [];
  const errors: CandidateRowError[] = [];
  const duplicates: number[] = [];
  const seen = new Set<string>();
  if (m.email === undefined || m.full_name === undefined) {
    return { rows, errors: [{ row: 1, message: "The file needs an email column and a name column." }], duplicates };
  }
  table.slice(1).forEach((cells, i) => {
    const line = i + 2;
    const get = (f: CandidateField) => (m[f] === undefined ? "" : (cells[m[f]!] ?? "").replace(/\s+/g, " ").trim());
    if (!get("email") && !get("full_name") && !get("phone")) return;
    const input = { email: get("email").replace(/^mailto:/i, ""), fullName: get("full_name"), ...(get("phone") ? { phone: get("phone") } : {}) };
    const parsed = CandidateInput.safeParse(input);
    if (!parsed.success) {
      const field = String(parsed.error.issues[0]?.path[0] ?? "");
      errors.push({ row: line, message: field === "email" ? `Email "${input.email}" isn't valid` : field === "fullName" ? "Name is missing" : "Phone is too long" });
      return;
    }
    if (seen.has(parsed.data.email)) { duplicates.push(line); return; }
    seen.add(parsed.data.email);
    rows.push({ row: line, email: parsed.data.email, fullName: parsed.data.fullName, ...(parsed.data.phone ? { phone: parsed.data.phone } : {}) });
  });
  return { rows, errors, duplicates };
}

/** CSV of invite links (for WhatsApp / mail-merge when email isn't configured). */
export const LINK_COLUMNS = ["Name", "Email", "Link", "Emailed"] as const;
export const linkRows = (invited: Array<{ fullName: string; email: string; link: string; emailed: boolean }>) =>
  invited.map((i) => [i.fullName, i.email, i.link, i.emailed ? "yes" : "no"]);

export const SKIP_REASON: Record<string, string> = {
  already_invited: "Already invited to this role (use Resend on their row)",
  duplicate_in_list: "Listed twice",
  invalid_email: "Email isn't valid",
  missing_name: "Name is missing",
};
