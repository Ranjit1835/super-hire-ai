// @vitest-environment node
import { describe, it, expect } from "vitest";
import { buildRows, detectMapping, findInFileDuplicates, missingRequired, parseBatchYear, parseDob, parseXlsx } from "./import";
import { describeEligibility, emptyAnalytics, emptyEligibility, fromEligibility, toAnalyticsFilters, toEligibility } from "./filters";
import { tableToCsv, tableToXlsx } from "./exports";
import { EXPORT_COLUMNS, toExportRows, type AnalyticsRow } from "../../../../supabase/functions/_shared/college-table";
import { Eligibility, collegeContract } from "../../../../supabase/functions/_shared/contracts/college";

describe("header detection", () => {
  it("maps typical Indian college sheet headers", () => {
    const headers = ["S.No", "Hall Ticket No.", "Student Name", "Father Name", "Branch", "Year of Passing", "Sec", "Email ID",
      "Mobile No", "B.Tech CGPA", "Active Backlogs", "History of Backlogs", "SSC %", "Inter/Diploma %", "D.O.B"];
    const m = detectMapping(headers);
    expect(m).toEqual({
      roll_no: 1, full_name: 2, department: 4, batch_year: 5, section: 6, email: 7, phone: 8, cgpa: 9,
      active_backlogs: 10, tenth_pct: 12, twelfth_pct: 13, dob: 14,
    });
    expect(missingRequired(m)).toEqual([]);
  });

  it("handles other spellings and keyword fallbacks", () => {
    expect(detectMapping(["Roll No", "Name", "E-mail", "Dept", "Batch", "CGPA", "10th %", "12th %", "Date of Birth"])).toEqual({
      roll_no: 0, full_name: 1, email: 2, department: 3, batch_year: 4, cgpa: 5, tenth_pct: 6, twelfth_pct: 7, dob: 8,
    });
    expect(detectMapping(["Regd. No", "Name of the Student", "Personal Email Address", "No. of Arrears"])).toMatchObject({
      roll_no: 0, full_name: 1, email: 2, active_backlogs: 3,
    });
    expect(missingRequired(detectMapping(["Name", "Phone"]))).toEqual(["roll_no", "email"]);
  });
});

describe("cell parsing", () => {
  it("dates of birth in Indian formats", () => {
    expect(parseDob("05-01-2004")).toBe("2004-01-05");
    expect(parseDob("5/1/2004")).toBe("2004-01-05");
    expect(parseDob("05.01.2004")).toBe("2004-01-05");
    expect(parseDob("05-Jan-2004")).toBe("2004-01-05");
    expect(parseDob("2004-01-05")).toBe("2004-01-05");
    expect(parseDob("37991")).toBe("2004-01-05");      // Excel serial
    expect(parseDob("31-02-2004")).toBeNull();
    expect(parseDob("tomorrow")).toBeNull();
  });
  it("batch years", () => {
    expect(parseBatchYear("2027")).toBe(2027);
    expect(parseBatchYear("2023-2027")).toBe(2027);
    expect(parseBatchYear("2023-27")).toBe(2027);
    expect(parseBatchYear("Batch 2026")).toBe(2026);
    expect(parseBatchYear("final")).toBeNull();
  });
});

describe("row building", () => {
  const table = [
    ["Roll No", "Name", "Email", "Branch", "Batch", "CGPA", "Backlogs", "10th %", "DOB"],
    ["21A01", " Asha  K ", "ASHA@A.IN", "CSE", "2023-27", "8.2", "Nil", "92.5%", "05/01/2004"],
    ["", "", "", "", "", "", "", "", ""],                                // blank line: dropped
    ["21A02", "Bala", "bala@a", "CSE", "2027", "82", "1", "9.1", "31-02-2004"],
    ["21A03", "", "c@a.in", "ECE", "2027", "", "", "", ""],
  ];
  it("normalises values and reports per-row errors with spreadsheet line numbers", () => {
    const r = buildRows(table, detectMapping(table[0]));
    expect(r.rows).toEqual([{
      row: 2, roll_no: "21A01", full_name: "Asha K", email: "asha@a.in", department: "CSE", batch_year: 2027, cgpa: 8.2,
      active_backlogs: 0, tenth_pct: 92.5, dob: "2004-01-05",
    }]);
    expect(r.errors).toHaveLength(2);
    expect(r.errors[0].row).toBe(4);
    expect(r.errors[0].message).toMatch(/CGPA 82 must be on a 10-point scale/);
    expect(r.errors[0].message).toMatch(/10th % 9.1 looks like a CGPA/);
    expect(r.errors[0].message).toMatch(/Date of birth "31-02-2004"/);
    expect(r.errors[0].message).toMatch(/Email/);
    expect(r.errors[1]).toEqual({ row: 5, message: "Name is missing" });
  });

  it("finds in-file duplicates the same way the server does", () => {
    expect(findInFileDuplicates([
      { row: 2, roll_no: "21A01", email: "a@x.in" },
      { row: 3, roll_no: "21a01", email: "b@x.in" },
      { row: 4, roll_no: "21A05", email: "A@x.in" },
      { row: 5, roll_no: "21A06", email: "c@x.in" },
    ])).toEqual([3, 4]);
  });

  it("reads an .xlsx (dates, numbers, rich text)", async () => {
    const { default: ExcelJS } = await import("exceljs");
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Students");
    ws.addRow(["Hall Ticket No", "Student Name", "Email", "DOB", "CGPA"]);
    ws.addRow(["21A01", { richText: [{ text: "Asha " }, { text: "K" }] }, "asha@a.in", new Date(Date.UTC(2004, 0, 5)), 8.25]);
    const buf = (await wb.xlsx.writeBuffer()) as ArrayBuffer;
    const t = await parseXlsx(buf);
    expect(t).toEqual([["Hall Ticket No", "Student Name", "Email", "DOB", "CGPA"], ["21A01", "Asha K", "asha@a.in", "2004-01-05", "8.25"]]);
    expect(buildRows(t, detectMapping(t[0])).rows[0]).toMatchObject({ dob: "2004-01-05", cgpa: 8.25 });
  });
});

describe("eligibility form → contract", () => {
  it("drops empty inputs and keeps the CSE 2027 CGPA ≥ 7, zero backlogs rule", () => {
    expect(toEligibility(emptyEligibility)).toEqual({});
    const e = toEligibility({ ...emptyEligibility, departments: ["CSE"], batchYears: [2027], minCgpa: "7", maxBacklogs: "0", sections: "A, B ," });
    expect(e).toEqual({ departments: ["CSE"], batch_years: [2027], sections: ["A", "B"], min_cgpa: 7, max_backlogs: 0 });
    expect(Eligibility.parse(e)).toEqual(e);
    expect(describeEligibility(e)).toBe("CSE · 2027 · Section A, B · CGPA ≥ 7 · no backlogs");
    expect(fromEligibility(e)).toMatchObject({ minCgpa: "7", maxBacklogs: "0", sections: "A, B" });
    expect(describeEligibility({})).toBe("All students");
  });
});

describe("analytics form → API params", () => {
  it("builds the filter object the contract accepts", () => {
    expect(toAnalyticsFilters(emptyAnalytics)).toEqual({});
    const f = toAnalyticsFilters({
      ...emptyAnalytics, driveId: "6c8f2f3e-6c7a-4a32-9d8b-2b3f9d1c0a11", from: "2026-11-01", to: "2026-11-30", departments: ["CSE"],
      cgpaMin: "7", bands: ["low"], scoreMax: "60", statuses: ["completed"], search: "  asha ", maxBacklogs: "0",
    });
    expect(f).toEqual({
      driveId: "6c8f2f3e-6c7a-4a32-9d8b-2b3f9d1c0a11", from: "2026-10-31T18:30:00.000Z", to: "2026-11-30T18:29:59.000Z",
      departments: ["CSE"], cgpa: [7, 10], maxBacklogs: 0, integrityBands: ["low"], scoreRange: [0, 60], status: ["completed"], search: "asha",
    });
    expect(collegeContract.analytics.input.safeParse({ orgId: "6c8f2f3e-6c7a-4a32-9d8b-2b3f9d1c0a11", filters: f }).success).toBe(true);
  });
});

describe("exports", () => {
  const row: AnalyticsRow = {
    student_id: "s", drive_id: "d", drive_name: "CSE drive", full_name: "=HYPERLINK(\"x\")", roll_no: "21A01", email: "a@a.in",
    department: "CSE", batch_year: 2027, section: null, cgpa: 8.2, active_backlogs: 0, status: "completed", coding: 60, mcq: 100,
    interview: null, overall: 80, integrity_band: "low", integrity_score: 55,
  };
  it("maps analytics rows to labelled columns", () => {
    const rows = toExportRows([row]);
    expect(rows[0]).toHaveLength(EXPORT_COLUMNS.length);
    expect(rows[0]).toEqual(["21A01", "=HYPERLINK(\"x\")", "a@a.in", "CSE", 2027, null, 8.2, 0, "CSE drive", "Completed", 60, 100, null, 80, 55, "Low"]);
  });
  it("CSV neutralises formulas; XLSX keeps plain values", async () => {
    const csv = tableToCsv(EXPORT_COLUMNS, toExportRows([row]));
    expect(csv.split("\r\n")[0]).toMatch(/^"Roll no","Name"/);
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    const buf = await tableToXlsx("Results", EXPORT_COLUMNS, toExportRows([row]));
    const { default: ExcelJS } = await import("exceljs");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ws = wb.worksheets[0];
    expect(ws.getRow(1).getCell(1).value).toBe("Roll no");
    expect(ws.getRow(2).getCell(2).value).toBe("=HYPERLINK(\"x\")");     // a string, not a formula
    expect(ws.getRow(2).getCell(7).value).toBe(8.2);
  });
});
