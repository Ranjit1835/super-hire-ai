import { describe, it, expect } from "vitest";
import { addSkill, emptyMatrix, fromMatrix, matrixErrors, removeSkill, toMatrix, updateSkill } from "./matrix";
import { buildCandidateRows, detectCandidateMapping, linkRows } from "./candidates";
import { activeFilterCount, emptyPipeline, expiresText, shareState, toPipelineFilters } from "./pipeline";

describe("skills matrix helpers", () => {
  it("round-trips, edits, clamps weights and validates", () => {
    let f = fromMatrix({ must_have: [{ skill: "Python", weight: 5 }], nice_to_have: [{ skill: "Docker", weight: 2 }], seniority: "junior" });
    expect(toMatrix(f)).toEqual({ must_have: [{ skill: "Python", weight: 5 }], nice_to_have: [{ skill: "Docker", weight: 2 }], seniority: "junior" });
    f = addSkill(f, "must", "SQL");
    const sql = f.rows.find((r) => r.skill === "SQL")!;
    f = updateSkill(f, sql.key, { weight: 9 });
    expect(f.rows.find((r) => r.key === sql.key)!.weight).toBe(5);
    f = updateSkill(f, sql.key, { kind: "nice" });
    expect(toMatrix(f).nice_to_have.map((s) => s.skill)).toEqual(["Docker", "SQL"]);
    expect(matrixErrors(f)).toEqual([]);
    f = addSkill(f, "nice", " python ");
    expect(matrixErrors(f)).toEqual(['"python" is listed twice.']);
    const py = f.rows.find((r) => r.skill === "Python")!;
    expect(matrixErrors(removeSkill(removeSkill(f, py.key), f.rows.at(-1)!.key))).toEqual(["Add at least one must-have skill."]);
  });

  it("empty rows are ignored; an empty matrix needs a must-have", () => {
    const f = addSkill(emptyMatrix(), "must");
    expect(toMatrix(f).must_have).toEqual([]);
    expect(matrixErrors(f)).toContain("Add at least one must-have skill.");
    expect(fromMatrix(null)).toMatchObject({ rows: [], seniority: "mid" });
  });
});

describe("candidate CSV mapping", () => {
  it("detects headers, validates rows and flags in-file duplicates", () => {
    const table = [
      ["Candidate Name", "E-mail ID", "Mobile No"],
      ["Asha", "Asha@X.in", "98480"],
      ["Bala", "not-an-email", ""],
      ["", "c@x.in", ""],
      ["Asha again", "asha@x.in", ""],
      ["", "", ""],
    ];
    const m = detectCandidateMapping(table[0]);
    expect(m).toEqual({ full_name: 0, email: 1, phone: 2 });
    const r = buildCandidateRows(table, m);
    expect(r.rows).toEqual([{ row: 2, email: "asha@x.in", fullName: "Asha", phone: "98480" }]);
    expect(r.errors).toEqual([{ row: 3, message: 'Email "not-an-email" isn\'t valid' }, { row: 4, message: "Name is missing" }]);
    expect(r.duplicates).toEqual([5]);
  });

  it("needs email and name columns", () => {
    expect(buildCandidateRows([["phone"], ["1"]], detectCandidateMapping(["phone"])).errors[0].message).toMatch(/email column and a name column/);
  });

  it("link rows for the CSV download", () => {
    expect(linkRows([{ fullName: "A", email: "a@x.in", link: "https://h/t/x", emailed: false }])).toEqual([["A", "a@x.in", "https://h/t/x", "no"]]);
  });
});

describe("pipeline filters → params", () => {
  it("sends only set fields, swaps a reversed range, clamps scores", () => {
    expect(toPipelineFilters(emptyPipeline)).toEqual({});
    expect(toPipelineFilters({ stages: ["completed"], bands: ["low"], scoreMin: "90", scoreMax: "40", search: "  asha " }))
      .toEqual({ stages: ["completed"], integrityBands: ["low"], scoreMin: 40, scoreMax: 90, search: "asha" });
    expect(toPipelineFilters({ ...emptyPipeline, scoreMin: "150", scoreMax: "abc" })).toEqual({ scoreMin: 100 });
    expect(activeFilterCount({ ...emptyPipeline, stages: ["hired"], search: "x" })).toBe(2);
  });
});

describe("share expiry", () => {
  const now = Date.parse("2026-10-21T12:00:00Z");
  it("states and text", () => {
    expect(shareState({ expires_at: "2026-10-28T12:00:00Z", revoked_at: null }, now)).toBe("active");
    expect(shareState({ expires_at: "2026-10-20T12:00:00Z", revoked_at: null }, now)).toBe("expired");
    expect(shareState({ expires_at: "2026-10-28T12:00:00Z", revoked_at: "2026-10-21T00:00:00Z" }, now)).toBe("revoked");
    expect(expiresText("2026-10-28T12:00:01Z", now)).toBe("Expires in 7 days");
    expect(expiresText("2026-10-22T13:00:00Z", now)).toBe("Expires in 1 day");
    expect(expiresText("2026-10-21T18:00:00Z", now)).toBe("Expires today");
    expect(expiresText("2026-10-21T11:00:00Z", now)).toBe("Expired");
  });
});
