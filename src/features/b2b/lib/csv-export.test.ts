import { describe, it, expect } from "vitest";
import { toCsv } from "./csv-export";

describe("toCsv", () => {
  it("quotes cells, escapes quotes and defuses formulas", () => {
    expect(toCsv(["a", "b"], [['He said "hi"', "=HYPERLINK(\"x\")"], ["-5", null], ["@SUM", 3]])).toBe(
      '"a","b"\r\n"He said ""hi""","\'=HYPERLINK(""x"")"\r\n"\'-5",""\r\n"\'@SUM","3"',
    );
  });
});
