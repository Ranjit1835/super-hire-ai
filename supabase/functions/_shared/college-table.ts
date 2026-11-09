// The TPO analytics table as an export (columns + plain rows). Pure TypeScript, shared by the b2b-college edge
// function (exportTable) and the browser (which builds the CSV / XLSX file from it).

export interface AnalyticsRow {
  student_id: string; drive_id: string; drive_name: string; full_name: string; roll_no: string; email: string;
  department: string | null; batch_year: number | null; section: string | null; cgpa: number | null;
  active_backlogs: number | null; status: string; coding: number | null; mcq: number | null; interview: number | null;
  overall: number | null; integrity_band: string | null; integrity_score: number | null;
}

export const STATUS_LABEL: Record<string, string> = {
  assigned: "Not started", in_progress: "In progress", completed: "Completed", absent: "Absent",
};
export const BAND_LABEL: Record<string, string> = { high: "High", medium: "Medium", low: "Low" };

export const EXPORT_COLUMNS = [
  "Roll no", "Name", "Email", "Department", "Batch", "Section", "CGPA", "Active backlogs", "Drive", "Status",
  "Coding %", "MCQ %", "Interview %", "Overall %", "Integrity score", "Integrity band",
] as const;

export type Cell = string | number | null;

export function toExportRows(rows: AnalyticsRow[]): Cell[][] {
  return rows.map((r) => [
    r.roll_no, r.full_name, r.email, r.department, r.batch_year, r.section, r.cgpa, r.active_backlogs, r.drive_name,
    STATUS_LABEL[r.status] ?? r.status, r.coding, r.mcq, r.interview, r.overall, r.integrity_score,
    r.integrity_band ? BAND_LABEL[r.integrity_band] ?? r.integrity_band : null,
  ]);
}

/** Largest export in one go (the analytics function caps a page at 10 000 rows). */
export const MAX_EXPORT_ROWS = 10000;
