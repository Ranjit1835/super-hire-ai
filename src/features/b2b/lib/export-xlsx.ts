// Batch Excel export (.xlsx). exceljs is loaded on demand so it never touches the
// B2C bundle. Cell values are written as plain values (never formulas), so names that
// start with "=" can't execute in Excel.
import type { BatchSummary, StudentSummary } from "./dashboard";
import { GAP_LABEL } from "./dashboard";
import { DIMENSIONS, DIMENSION_LABEL } from "./shared";

const READINESS_TEXT = { ready: "Ready", developing: "Developing", not_ready: "Not ready" } as const;

export interface WorkbookInput {
  orgName: string;
  scopeLabel: string; // e.g. "All modules · CSE 2026 A"
  isDemo?: boolean;
  rows: StudentSummary[];
  summary: BatchSummary;
  generatedAt?: Date;
}

function fill(score: number | null, pass = 6) {
  if (score === null) return undefined;
  const argb = score >= pass + 2 ? "FF9AE6B4" : score >= pass ? "FFC6F6D5" : score >= pass - 2 ? "FFFEEBC8" : "FFFED7D7";
  return { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb } };
}

export async function buildBatchWorkbook(input: WorkbookInput): Promise<ArrayBuffer> {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  wb.creator = "HiResume";
  wb.created = input.generatedAt ?? new Date();
  const s = input.summary;

  // ── Summary ──
  const sum = wb.addWorksheet("Summary");
  sum.columns = [{ width: 34 }, { width: 18 }, { width: 18 }];
  sum.addRow([input.orgName]).font = { bold: true, size: 14 };
  sum.addRow([`Interview readiness report · ${input.scopeLabel}`]);
  sum.addRow([`Generated ${(input.generatedAt ?? new Date()).toLocaleString("en-IN")}`]);
  if (input.isDemo) {
    const demo = sum.addRow(["DEMO INSTITUTION - all students and scores are fictional"]);
    demo.font = { bold: true, color: { argb: "FFB45309" } };
  }
  sum.addRow([]);
  const kv = (k: string, v: string | number | null) => sum.addRow([k, v ?? "—"]);
  kv("Students", s.students);
  kv("Students with at least one scored interview", s.attempted);
  kv("Scored interviews", s.interviews);
  kv("Average overall score (latest)", s.avg_overall);
  sum.addRow([]);
  sum.addRow(["Readiness", "Students"]).font = { bold: true };
  kv("Ready", s.readiness.ready);
  kv("Developing", s.readiness.developing);
  kv("Not ready", s.readiness.not_ready);
  kv("Not attempted", s.readiness.not_attempted);
  sum.addRow([]);
  sum.addRow(["Improvement (students with 2+ interviews)", "Value"]).font = { bold: true };
  kv("Students", s.improvement.students);
  kv("Average first score", s.improvement.first_avg);
  kv("Average latest score", s.improvement.latest_avg);
  kv("Average change", s.improvement.delta);
  kv("Improved / declined", `${s.improvement.improved} / ${s.improvement.declined}`);
  sum.addRow([]);
  sum.addRow(["Skill", "Batch average", "Average change"]).font = { bold: true };
  for (const d of DIMENSIONS) {
    const r = sum.addRow([DIMENSION_LABEL[d], s.dimension_avg[d] ?? "—", s.dimension_delta[d] ?? "—"]);
    const f = fill(s.dimension_avg[d]);
    if (f) r.getCell(2).fill = f;
  }
  sum.addRow([]);
  sum.addRow(["Scores are AI-assisted and indicative. Evidence for every score is available in each student's report."]).font = { italic: true, color: { argb: "FF666666" } };

  // ── Students ──
  const st = wb.addWorksheet(input.isDemo ? "Students (DEMO)" : "Students", { views: [{ state: "frozen", xSplit: 2, ySplit: 1 }] });
  const header = [
    "Roll no", "Name", "Email", "Batch", "Department", "Scored interviews", "Latest module", "Latest date",
    "Overall (latest)", "Readiness", "Focus area", "Main gap (AI)", ...DIMENSIONS.map((d) => DIMENSION_LABEL[d]),
    "First overall", "Change",
  ];
  st.addRow(header).font = { bold: true };
  st.getRow(1).alignment = { wrapText: true, vertical: "middle" };
  st.columns = header.map((h, i) => ({ width: i === 11 ? 48 : i <= 1 ? 22 : Math.max(10, Math.min(18, h.length + 2)) }));
  const firstDimCol = 13;
  for (const r of input.rows) {
    const row = st.addRow([
      r.student.roll_no ?? "", r.student.full_name ?? "", r.student.email ?? "", r.student.batch_name ?? "", r.student.department ?? "",
      r.interviews.length, r.latest?.module_name ?? "", r.latest ? new Date(r.latest.started_at) : "",
      r.overall_latest ?? "", r.readiness ? READINESS_TEXT[r.readiness] : "Not attempted", GAP_LABEL[r.gap], r.primary_gap ?? "",
      ...DIMENSIONS.map((d) => r.dims[d] ?? ""), r.overall_first ?? "", r.delta ?? "",
    ]);
    const pass = r.latest?.pass_threshold ?? 6;
    const of = fill(r.overall_latest, pass);
    if (of) row.getCell(9).fill = of;
    DIMENSIONS.forEach((d, i) => {
      const f = fill(r.dims[d], pass);
      if (f) row.getCell(firstDimCol + i).fill = f;
    });
    if (r.latest) row.getCell(8).numFmt = "dd-mmm-yyyy";
  }
  st.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: header.length } };

  // ── Topics ──
  const tp = wb.addWorksheet("Topics");
  tp.columns = [{ header: "Topic", width: 44 }, { header: "Batch average", width: 16 }, { header: "Students scored", width: 16 }];
  tp.getRow(1).font = { bold: true };
  const topicAgg = new Map<string, number[]>();
  for (const r of input.rows) for (const [t, v] of Object.entries(r.topics)) if (typeof v === "number") topicAgg.set(t, [...(topicAgg.get(t) ?? []), v]);
  [...topicAgg.entries()]
    .map(([t, xs]) => ({ t, avg: Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10, n: xs.length }))
    .sort((a, b) => a.avg - b.avg)
    .forEach(({ t, avg, n }) => {
      const row = tp.addRow([t, avg, n]);
      const f = fill(avg);
      if (f) row.getCell(2).fill = f;
    });

  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

export function downloadBlob(filename: string, data: ArrayBuffer | Uint8Array, type: string) {
  const blob = new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
