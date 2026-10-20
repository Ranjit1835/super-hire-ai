// Student roster import (CSV / XLSX): header detection, column mapping, row normalisation and validation,
// and in-file duplicate detection. The server re-validates everything (b2b_import_students).
import { parseCsv } from "../../../../supabase/functions/_shared/invite-csv";
import { StudentRow } from "../../../../supabase/functions/_shared/contracts/college";
import type { z } from "zod";

export type StudentRowInput = z.input<typeof StudentRow>;
export type ImportField =
  | "roll_no" | "full_name" | "email" | "phone" | "department" | "batch_year" | "section" | "cgpa"
  | "active_backlogs" | "tenth_pct" | "twelfth_pct" | "dob";

export const FIELDS: { key: ImportField; label: string; required?: boolean }[] = [
  { key: "roll_no", label: "Roll no / Hall ticket no", required: true },
  { key: "full_name", label: "Name", required: true },
  { key: "email", label: "Email", required: true },
  { key: "phone", label: "Phone" },
  { key: "department", label: "Branch / Department" },
  { key: "batch_year", label: "Batch / Year of passing" },
  { key: "section", label: "Section" },
  { key: "cgpa", label: "CGPA" },
  { key: "active_backlogs", label: "Active backlogs" },
  { key: "tenth_pct", label: "10th %" },
  { key: "twelfth_pct", label: "12th / Diploma %" },
  { key: "dob", label: "Date of birth" },
];

/** Lower-case, "%" → "pct", every other separator → one space. */
export function normHeader(h: string): string {
  return h.replace(/^﻿/, "").toLowerCase().replace(/%/g, " pct ").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

const ALIASES: Record<ImportField, string[]> = {
  roll_no: ["roll no", "roll number", "rollno", "roll", "hall ticket no", "hall ticket number", "hall ticket", "ht no", "htno",
    "reg no", "regd no", "registration no", "registration number", "register no", "register number", "usn", "enrollment no",
    "enrolment no", "enrollment number", "admission no", "admission number", "pin", "pin no", "student id", "roll no hall ticket no"],
  full_name: ["name", "full name", "student name", "name of the student", "candidate name", "student", "name of student"],
  email: ["email", "email id", "e mail", "e mail id", "email address", "mail id", "mail", "personal email", "college email",
    "emailid", "official email", "student email"],
  phone: ["phone", "phone no", "phone number", "mobile", "mobile no", "mobile number", "contact", "contact no",
    "contact number", "whatsapp", "whatsapp no", "student mobile", "cell"],
  department: ["department", "dept", "branch", "stream", "discipline", "specialization", "specialisation", "programme", "course branch"],
  batch_year: ["batch", "year of passing", "yop", "passing year", "passout year", "pass out year", "graduation year",
    "batch year", "year of graduation", "passed out year"],
  section: ["section", "sec", "class section", "class"],
  cgpa: ["cgpa", "cgpa 10", "cgpa out of 10", "aggregate cgpa", "btech cgpa", "b tech cgpa", "gpa", "current cgpa", "be cgpa", "overall cgpa"],
  active_backlogs: ["active backlogs", "backlogs", "current backlogs", "no of backlogs", "number of backlogs", "arrears",
    "active arrears", "standing arrears", "backlog", "no of active backlogs", "current arrears"],
  tenth_pct: ["10th pct", "10th", "10th percentage", "10th marks", "ssc", "ssc pct", "ssc percentage", "x pct", "class 10",
    "class x", "tenth", "tenth pct", "secondary", "10th aggregate"],
  twelfth_pct: ["12th pct", "12th", "12th percentage", "12th marks", "inter", "intermediate", "inter pct", "intermediate pct",
    "hsc", "hsc pct", "xii pct", "class 12", "class xii", "twelfth", "twelfth pct", "12th diploma pct", "inter diploma pct",
    "12th diploma", "inter diploma", "diploma pct", "puc", "puc pct"],
  dob: ["dob", "date of birth", "birth date", "d o b", "birthdate", "dob dd mm yyyy", "date of birth dd mm yyyy"],
};
const ALIAS_INDEX = new Map<string, ImportField>();
for (const [field, list] of Object.entries(ALIASES) as [ImportField, string[]][]) {
  for (const a of list) ALIAS_INDEX.set(normHeader(a), field);
}

/** Keyword fallbacks for headers that don't match exactly, in priority order. */
const KEYWORDS: [ImportField, RegExp][] = [
  ["email", /\be ?mail\b/],
  ["roll_no", /\b(hall ticket|roll|regd?|registration|usn|enrol?ment|admission)\b/],
  ["dob", /\b(birth|dob)\b/],
  ["phone", /\b(phone|mobile|contact|whatsapp)\b/],
  ["cgpa", /\b(cgpa|gpa)\b/],
  ["active_backlogs", /\b(backlogs?|arrears?)\b/],
  ["tenth_pct", /\b(10th|ssc|tenth)\b/],
  ["twelfth_pct", /\b(12th|inter|intermediate|hsc|diploma|twelfth|puc)\b/],
  ["batch_year", /\b(passing|passout|pass out|batch|graduation)\b/],
  ["department", /\b(branch|dept|department|stream)\b/],
  ["section", /\bsection\b/],
  ["full_name", /\bname\b/],
];

export type Mapping = Partial<Record<ImportField, number>>;

/** Map each field to at most one column (exact aliases first, then keywords; history-of-backlogs columns ignored). */
export function detectMapping(headers: string[]): Mapping {
  const norm = headers.map(normHeader);
  const mapping: Mapping = {};
  const used = new Set<number>();
  norm.forEach((h, i) => {
    const f = ALIAS_INDEX.get(h);
    if (f && mapping[f] === undefined) { mapping[f] = i; used.add(i); }
  });
  for (const [field, re] of KEYWORDS) {
    if (mapping[field] !== undefined) continue;
    const i = norm.findIndex((h, idx) => !used.has(idx) && re.test(h) && !/\bhistory\b|\btotal\b|\bfather|\bmother|\bparent/.test(h));
    if (i >= 0) { mapping[field] = i; used.add(i); }
  }
  return mapping;
}

export function missingRequired(mapping: Mapping): ImportField[] {
  return FIELDS.filter((f) => f.required && mapping[f.key] === undefined).map((f) => f.key);
}

// ── Cell normalisation ────────────────────────────────────────────────────────────────────────────────────
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const pad = (n: number) => String(n).padStart(2, "0");
function isoDate(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  if (y < 1950 || y > 2100) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** Indian sheets: dd-mm-yyyy / dd/mm/yyyy / dd.mm.yyyy, dd-Mon-yyyy, ISO yyyy-mm-dd, or an Excel serial number. */
export function parseDob(v: string): string | null {
  const s = v.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(s);
  if (m) return isoDate(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s);
  if (m) return isoDate(+m[3], +m[2], +m[1]);
  m = /^(\d{1,2})[-/ .]([A-Za-z]{3,9})[-/ .,]*(\d{4})$/.exec(s);
  if (m) {
    const mon = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase());
    return mon >= 0 ? isoDate(+m[3], mon + 1, +m[1]) : null;
  }
  if (/^\d{4,5}(\.\d+)?$/.test(s)) {           // Excel serial (days since 1899-12-30)
    const dt = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(s)) * 86_400_000);
    return isoDate(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
  }
  return null;
}

/** "2027", "2023-2027", "2023-27", "Batch 2027" → 2027. */
export function parseBatchYear(v: string): number | null {
  const s = v.trim();
  const short = /(20\d{2})\s*[-–/]\s*(\d{2})$/.exec(s);
  if (short) return 2000 + Number(short[2]);
  const years = s.match(/(19|20)\d{2}/g);
  if (!years) return null;
  return Math.max(...years.map(Number));
}

const num = (v: string) => {
  const s = v.replace(/%/g, "").replace(/,/g, "").trim();
  return s !== "" && Number.isFinite(Number(s)) ? Number(s) : null;
};

export interface RowError { row: number; message: string }
export interface BuildResult { rows: StudentRowInput[]; errors: RowError[] }

/**
 * Turn a parsed table (header row first) into contract rows. Row numbers are spreadsheet lines (header = 1).
 * Rows with every mapped cell empty are dropped silently.
 */
export function buildRows(table: string[][], mapping: Mapping): BuildResult {
  const rows: StudentRowInput[] = [];
  const errors: RowError[] = [];
  table.slice(1).forEach((cells, i) => {
    const line = i + 2;
    const get = (f: ImportField) => {
      const idx = mapping[f];
      // eslint-disable-next-line no-control-regex
      return idx === undefined ? "" : (cells[idx] ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
    };
    if ((Object.keys(mapping) as ImportField[]).every((f) => get(f) === "")) return;
    const problems: string[] = [];
    const out: Record<string, unknown> = {
      row: line,
      roll_no: get("roll_no"),
      full_name: get("full_name"),
      email: get("email").toLowerCase().replace(/^mailto:/, ""),
    };
    const text = (f: ImportField) => { const v = get(f); if (v) out[f] = v; };
    text("phone"); text("department"); text("section");

    const by = get("batch_year");
    if (by) { const y = parseBatchYear(by); if (y === null) problems.push(`Batch "${by}" isn't a year`); else out.batch_year = y; }

    const cg = get("cgpa");
    if (cg) {
      const n = num(cg);
      if (n === null) problems.push(`CGPA "${cg}" isn't a number`);
      else if (n > 10) problems.push(`CGPA ${n} must be on a 10-point scale`);
      else out.cgpa = n;
    }
    const bl = get("active_backlogs");
    if (bl) {
      if (/^(nil|none|no|na|n\/a|-|–)$/i.test(bl)) out.active_backlogs = 0;
      else { const n = num(bl); if (n === null || !Number.isInteger(n) || n < 0) problems.push(`Backlogs "${bl}" isn't a whole number`); else out.active_backlogs = n; }
    }
    for (const f of ["tenth_pct", "twelfth_pct"] as const) {
      const v = get(f);
      if (!v) continue;
      const n = num(v);
      const label = f === "tenth_pct" ? "10th %" : "12th %";
      if (n === null) problems.push(`${label} "${v}" isn't a number`);
      else if (n <= 10) problems.push(`${label} ${n} looks like a CGPA; enter a percentage`);
      else if (n > 100) problems.push(`${label} ${n} is over 100`);
      else out[f] = n;
    }
    const dob = get("dob");
    if (dob) { const d = parseDob(dob); if (!d) problems.push(`Date of birth "${dob}" isn't a date (use DD-MM-YYYY)`); else out.dob = d; }

    const parsed = StudentRow.safeParse(out);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = FIELDS.find((f) => f.key === issue.path[0])?.label ?? String(issue.path[0] ?? "Row");
        problems.push(issue.code === "too_small" ? `${field} is missing` : `${field}: ${issue.message.toLowerCase()}`);
      }
    }
    if (problems.length) errors.push({ row: line, message: problems.join("; ") });
    else rows.push(out as StudentRowInput);
  });
  return { rows, errors };
}

/** Same rule as the server: a later row repeating an earlier roll no (any case) or email is an in-file duplicate. */
export function findInFileDuplicates(rows: Pick<StudentRowInput, "row" | "roll_no" | "email">[]): number[] {
  const rolls = new Set<string>();
  const emails = new Set<string>();
  const dups: number[] = [];
  for (const r of rows) {
    const roll = r.roll_no.trim().toLowerCase();
    const email = r.email.trim().toLowerCase();
    if (rolls.has(roll) || emails.has(email)) { dups.push(r.row); continue; }
    rolls.add(roll);
    emails.add(email);
  }
  return dups;
}

// ── File reading ──────────────────────────────────────────────────────────────────────────────────────────
export const MAX_IMPORT_ROWS = 5000;

function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`;
  if (typeof v === "object") {
    const o = v as { text?: unknown; result?: unknown; richText?: { text: string }[]; hyperlink?: string };
    if (Array.isArray(o.richText)) return o.richText.map((r) => r.text).join("");
    if (o.result !== undefined) return cellText(o.result);
    if (typeof o.text === "string") return o.text;
    if (typeof o.hyperlink === "string") return o.hyperlink;
    return "";
  }
  return String(v);
}

/** First worksheet of an .xlsx as a table of strings (dates as yyyy-mm-dd). exceljs loads on demand. */
export async function parseXlsx(data: ArrayBuffer): Promise<string[][]> {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data);
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const out: string[][] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const values = row.values as unknown[];          // 1-based
    const cells: string[] = [];
    for (let c = 1; c < values.length; c++) cells.push(cellText(values[c]).trim());
    if (cells.some((x) => x !== "")) out.push(cells);
  });
  return out;
}

export async function readTable(file: File): Promise<string[][]> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".xlsx")) return parseXlsx(await file.arrayBuffer());
  if (name.endsWith(".xls")) throw new Error("Old .xls files aren't supported. In Excel choose File → Save As → .xlsx or CSV.");
  return parseCsv(await file.text());
}
