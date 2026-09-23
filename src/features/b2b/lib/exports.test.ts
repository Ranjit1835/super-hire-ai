// @vitest-environment node
import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { PDFDocument } from "pdf-lib";
import { batchSummary, summarize, type DashEval, type RosterStudent } from "./dashboard";
import { buildBatchWorkbook } from "./export-xlsx";
import { buildStudentPdf, pdfSafe } from "./export-pdf";
import { DIMENSIONS, type EvaluationResult } from "./shared";

const roster: RosterStudent[] = [
  { user_id: "a", full_name: "=HYPERLINK(\"http://evil\")", roll_no: "21A01", email: "a@x.in", batch_id: "b", batch_name: "CSE A", department: "CSE" },
  { user_id: "b", full_name: "Divya Reddy", roll_no: "21A02", email: "b@x.in", batch_id: "b", batch_name: "CSE A", department: "CSE" },
];
const dims = (v: number) => Object.fromEntries(DIMENSIONS.map((d) => [d, v])) as DashEval["dimensions"];
const evals: DashEval[] = [
  { interview_id: "i1", user_id: "a", module_id: "m", module_name: "SQL", module_type: "skill", pass_threshold: 6, started_at: "2026-09-01T10:00:00Z", completed_at: "", overall_score: 4, readiness_level: "not_ready", primary_gap: "Joins", dimensions: dims(4), per_topic: { Joins: 3 } },
  { interview_id: "i2", user_id: "a", module_id: "m", module_name: "SQL", module_type: "skill", pass_threshold: 6, started_at: "2026-09-08T10:00:00Z", completed_at: "", overall_score: 6.5, readiness_level: "developing", primary_gap: "Indexes", dimensions: dims(6.5), per_topic: { Joins: 6, Indexes: 5 } },
];

describe("buildBatchWorkbook", () => {
  it("writes Summary, Students and Topics sheets with values (never formulas)", async () => {
    const rows = summarize(roster, evals);
    const buf = await buildBatchWorkbook({ orgName: "SVR College", scopeLabel: "All modules", rows, summary: batchSummary(rows, 1), generatedAt: new Date("2026-09-20") });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Summary", "Students", "Topics"]);
    const st = wb.getWorksheet("Students")!;
    expect(st.getRow(1).getCell(1).value).toBe("Roll no");
    const a = st.getRow(2);
    expect(a.getCell(1).value).toBe("21A01");
    expect(a.getCell(2).value).toBe('=HYPERLINK("http://evil")'); // stored as text
    expect(a.getCell(2).formula).toBeUndefined();
    expect(a.getCell(9).value).toBe(6.5);
    expect(a.getCell(10).value).toBe("Developing");
    expect(st.getRow(3).getCell(10).value).toBe("Not attempted");
    const tp = wb.getWorksheet("Topics")!;
    expect(tp.getRow(2).values).toEqual([undefined, "Indexes", 5, 1]);
    expect(wb.getWorksheet("Summary")!.getRow(1).getCell(1).value).toBe("SVR College");
  });

  it("labels demo exports", async () => {
    const rows = summarize(roster, evals);
    const buf = await buildBatchWorkbook({ orgName: "Demo Engineering College", scopeLabel: "All", rows, summary: batchSummary(rows), isDemo: true });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    expect(wb.worksheets.map((w) => w.name)).toContain("Students (DEMO)");
    expect(wb.getWorksheet("Summary")!.getRow(4).getCell(1).value).toMatch(/DEMO INSTITUTION/);
  });
});

describe("buildStudentPdf", () => {
  const result: EvaluationResult = {
    dimensions: Object.fromEntries(DIMENSIONS.map((d) => [d, { score: 6.5, evidence: ["an inner join returns matching rows"], reason: "Solid basics — needs depth." }])) as EvaluationResult["dimensions"],
    per_topic: { Joins: { score: 6, evidence: ["x y z"], reason: "r" }, Indexes: { score: "insufficient_data", evidence: [], reason: "r" } },
    primary_gap: "Explaining indexes “with trade-offs”.", readiness_level: "developing", recommended_focus: ["Indexes", "ACID"],
    overall_score: 6.5, passed: true, model_readiness_level: "developing", dropped_evidence: 0,
  };

  it("produces a valid multi-section PDF", async () => {
    const bytes = await buildStudentPdf({
      orgName: "SVR Engineering College", logo: null,
      student: { full_name: "Divya Reddy", roll_no: "21A02", batch_name: "CSE A", department: "CSE" },
      interviews: evals,
      latest: { result, metrics: null, module_name: "SQL", date: "8 Sept 2026", pass: 6 },
    });
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
    expect(doc.getTitle()).toBe("Divya Reddy - interview report");
  });

  it("never throws on names in other scripts and embeds a PNG logo", async () => {
    const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
    const bytes = await buildStudentPdf({
      orgName: "శ్రీ కాలేజ్ College", logo: { bytes: png, type: "png" },
      student: { full_name: "రవి Kumar", roll_no: null, batch_name: null, department: null },
      interviews: [], latest: null,
    });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });

  it("watermarks demo reports", async () => {
    const bytes = await buildStudentPdf({
      orgName: "Demo Engineering College", isDemo: true, student: { full_name: "Demo Student", roll_no: null, batch_name: null, department: null },
      interviews: [], latest: null,
    });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });

  it("pdfSafe keeps Latin text, maps smart punctuation and replaces other scripts", () => {
    expect(pdfSafe("José — “fine” … రవి")).toBe('Jose - "fine" ... ???');
  });
});
