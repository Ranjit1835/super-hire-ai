// ─── Student roster CSV: parse + validate ─────────────────────────────────────
// Pure TypeScript (no Deno / DOM APIs): imported by the b2b-invites edge function
// AND by the admin import screen, so the preview and the server apply identical rules.

export const MAX_ROWS = 2000;

export interface RosterRow {
  row: number; // 1-based line in the file (header = 1)
  full_name: string;
  email: string;
  roll_no: string;
  department: string;
  batch: string;
}

export interface RowError {
  row: number;
  errors: string[];
  raw: Record<string, string>;
}

export interface RosterParseResult {
  rows: RosterRow[];
  errors: RowError[];
  /** Problems with the file itself (missing columns, empty, too large). */
  fileErrors: string[];
}

type Field = "full_name" | "email" | "roll_no" | "department" | "batch";

const HEADER_ALIASES: Record<Field, string[]> = {
  full_name: ["name", "full name", "fullname", "student name", "student", "full_name"],
  email: ["email", "email id", "e-mail", "email address", "mail", "mail id", "emailid"],
  roll_no: ["roll no", "roll_no", "rollno", "roll number", "roll", "reg no", "registration no", "register no",
    "regd no", "hall ticket no", "htno", "usn", "enrollment no", "enrolment no", "admission no", "pin"],
  department: ["department", "dept", "branch", "stream"],
  batch: ["batch", "section", "class", "group", "batch name"],
};
const REQUIRED: Field[] = ["full_name", "email", "roll_no", "batch"];

const EMAIL_RE = /^[a-z0-9._%+'-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/;
const ROLL_RE = /^[A-Za-z0-9][A-Za-z0-9/_.-]{0,29}$/;
const BOM_RE = new RegExp("^" + String.fromCharCode(0xfeff)); // Excel "CSV UTF-8" prefix

function normHeader(h: string): string {
  return h.replace(BOM_RE, "").trim().toLowerCase().replace(/[._]+/g, " ").replace(/\s+/g, " ");
}

/** RFC 4180-ish: quoted fields, "" escapes, CRLF/LF, BOM. Auto-detects `,` `;` or tab. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(BOM_RE, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const delim = [",", ";", "\t"].reduce((best, d) =>
    firstLine.split(d).length > firstLine.split(best).length ? d : best, ",");

  const out: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"' && field === "") quoted = true;
    else if (c === delim) { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field); field = "";
      out.push(row); row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); out.push(row); }
  return out.filter((r) => r.some((v) => v.trim() !== ""));
}

function clean(v: string | undefined): string {
  // Strip control characters Excel sometimes leaves in cells.
  // eslint-disable-next-line no-control-regex
  return (v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
}

export function validateRoster(text: string): RosterParseResult {
  const fileErrors: string[] = [];
  const table = parseCsv(text);
  if (table.length === 0) return { rows: [], errors: [], fileErrors: ["The file is empty."] };

  const header = table[0].map(normHeader);
  const col: Partial<Record<Field, number>> = {};
  for (const f of Object.keys(HEADER_ALIASES) as Field[]) {
    const idx = header.findIndex((h) => HEADER_ALIASES[f].includes(h));
    if (idx >= 0) col[f] = idx;
  }
  const missing = REQUIRED.filter((f) => col[f] === undefined);
  if (missing.length) {
    fileErrors.push(
      `Missing column(s): ${missing.map((m) => m.replace("_", " ")).join(", ")}. ` +
      "Expected headers: name, email, roll_no, department, batch.",
    );
    return { rows: [], errors: [], fileErrors };
  }
  const body = table.slice(1);
  if (body.length === 0) fileErrors.push("The file has a header but no students.");
  if (body.length > MAX_ROWS) {
    fileErrors.push(`Too many rows (${body.length}). Upload at most ${MAX_ROWS} students per file.`);
    return { rows: [], errors: [], fileErrors };
  }

  const rows: RosterRow[] = [];
  const errors: RowError[] = [];
  body.forEach((cells, i) => {
    const line = i + 2;
    const get = (f: Field) => (col[f] === undefined ? "" : clean(cells[col[f]!]));
    const raw = {
      full_name: get("full_name"), email: get("email"), roll_no: get("roll_no"),
      department: get("department"), batch: get("batch"),
    };
    const errs: string[] = [];
    const email = raw.email.toLowerCase().replace(/^mailto:/, "");

    if (raw.full_name.length < 2) errs.push("Name is missing");
    else if (raw.full_name.length > 100) errs.push("Name is longer than 100 characters");
    if (!email) errs.push("Email is missing");
    else if (!EMAIL_RE.test(email) || email.length > 254) errs.push(`"${raw.email}" is not a valid email`);
    if (!raw.roll_no) errs.push("Roll number is missing");
    else if (!ROLL_RE.test(raw.roll_no)) errs.push("Roll number may only contain letters, numbers, / _ . - (max 30)");
    if (!raw.batch) errs.push("Batch is missing");
    else if (raw.batch.length > 120) errs.push("Batch name is longer than 120 characters");
    if (raw.department.length > 80) errs.push("Department is longer than 80 characters");

    if (errs.length) errors.push({ row: line, errors: errs, raw });
    else rows.push({
      row: line,
      full_name: raw.full_name,
      email,
      roll_no: raw.roll_no,
      department: raw.department,
      batch: raw.batch,
    });
  });

  return { rows, errors, fileErrors };
}

/** Re-validate rows that arrive as JSON (server side): never trust the browser's parse. */
export function validateRosterRows(input: unknown): RosterParseResult {
  if (!Array.isArray(input)) return { rows: [], errors: [], fileErrors: ["rows must be an array"] };
  if (input.length > MAX_ROWS) return { rows: [], errors: [], fileErrors: [`At most ${MAX_ROWS} rows`] };
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = ["name,email,roll_no,department,batch",
    ...input.map((r: Record<string, unknown>) =>
      [r?.full_name, r?.email, r?.roll_no, r?.department, r?.batch].map(esc).join(","))].join("\n");
  const res = validateRoster(csv);
  // Map line numbers back to the caller's row numbers.
  const back = (line: number) => Number((input[line - 2] as Record<string, unknown>)?.row) || line;
  return {
    rows: res.rows.map((r) => ({ ...r, row: back(r.row) })),
    errors: res.errors.map((e) => ({ ...e, row: back(e.row) })),
    fileErrors: res.fileErrors.filter((e) => !e.startsWith("The file has a header")),
  };
}

export const ROSTER_TEMPLATE_CSV =
  "name,email,roll_no,department,batch\n" +
  "Anil Kumar,anil.kumar@example.com,21A91A0501,CSE,CSE 2026 A\n" +
  "Divya Reddy,divya.r@example.com,21A91A0502,CSE,CSE 2026 A\n";
