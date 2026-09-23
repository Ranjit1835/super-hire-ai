// @vitest-environment node
import { describe, it, expect } from "vitest";
import { parseCsv, validateRoster, validateRosterRows, ROSTER_TEMPLATE_CSV, MAX_ROWS } from "../../functions/_shared/invite-csv";

describe("parseCsv", () => {
  it("handles quotes, escaped quotes, CRLF, BOM and blank lines", () => {
    const t = '﻿name,email\r\n"Rao, K. ""Bunny""",k@x.in\r\n\r\nSita,s@x.in';
    expect(parseCsv(t)).toEqual([["name", "email"], ['Rao, K. "Bunny"', "k@x.in"], ["Sita", "s@x.in"]]);
  });

  it("detects semicolon and tab delimited files (Excel in some locales)", () => {
    expect(parseCsv("name;email\nA B;a@x.in")[1]).toEqual(["A B", "a@x.in"]);
    expect(parseCsv("name\temail\nA B\ta@x.in")[1]).toEqual(["A B", "a@x.in"]);
  });

  it("keeps newlines inside quoted fields", () => {
    expect(parseCsv('a,b\n"line1\nline2",x')[1]).toEqual(["line1\nline2", "x"]);
  });
});

describe("validateRoster", () => {
  it("accepts the downloadable template", () => {
    const r = validateRoster(ROSTER_TEMPLATE_CSV);
    expect(r.fileErrors).toEqual([]);
    expect(r.errors).toEqual([]);
    expect(r.rows).toHaveLength(2);
  });

  it("recognises common Indian college header variants in any order", () => {
    const csv = "Sl No,Hall Ticket No,Student Name,Branch,Section,Email ID\n1,21A91A0501,Anil Kumar,CSE,A,ANIL@Gmail.com ";
    const r = validateRoster(csv);
    expect(r.fileErrors).toEqual([]);
    expect(r.rows[0]).toEqual({
      row: 2, full_name: "Anil Kumar", email: "anil@gmail.com", roll_no: "21A91A0501", department: "CSE", batch: "A",
    });
  });

  it("reports every problem per row with its line number", () => {
    const csv = [
      "name,email,roll_no,department,batch",
      "Good Student,good@x.in,R1,CSE,B1",
      ",bad-email,,CSE,",
      "Ok Name,ok@x.in,R 3 has spaces,CSE,B1",
    ].join("\n");
    const r = validateRoster(csv);
    expect(r.rows.map((x) => x.row)).toEqual([2]);
    expect(r.errors).toEqual([
      expect.objectContaining({ row: 3, errors: ["Name is missing", '"bad-email" is not a valid email', "Roll number is missing", "Batch is missing"] }),
      expect.objectContaining({ row: 4, errors: [expect.stringMatching(/Roll number may only/)] }),
    ]);
  });

  it("explains missing required columns", () => {
    const r = validateRoster("name,email\nA,a@x.in");
    expect(r.fileErrors[0]).toMatch(/Missing column\(s\): roll no, batch/);
  });

  it("rejects empty and oversized files", () => {
    expect(validateRoster("").fileErrors).toEqual(["The file is empty."]);
    const big = "name,email,roll_no,batch\n" + Array.from({ length: MAX_ROWS + 1 }, (_, i) => `N ${i},n${i}@x.in,R${i},B`).join("\n");
    expect(validateRoster(big).fileErrors[0]).toMatch(/Too many rows/);
  });
});

describe("validateRosterRows (server re-validation)", () => {
  it("re-checks JSON rows and keeps the caller's row numbers", () => {
    const r = validateRosterRows([
      { row: 7, full_name: "A B", email: "A@X.IN", roll_no: "R1", department: "", batch: "B" },
      { row: 9, full_name: "C D", email: "not-an-email", roll_no: "R2", batch: "B" },
      { row: 10, full_name: 'Quote "Q" Name', email: "q@x.in", roll_no: "R3", batch: "B" },
    ]);
    expect(r.rows.map((x) => [x.row, x.email, x.full_name])).toEqual([[7, "a@x.in", "A B"], [10, "q@x.in", 'Quote "Q" Name']]);
    expect(r.errors.map((e) => e.row)).toEqual([9]);
  });

  it("rejects non-arrays", () => {
    expect(validateRosterRows({}).fileErrors).toEqual(["rows must be an array"]);
  });
});
