import { describe, it, expect } from "vitest";
import { slugify, SLUG_RE, friendlyDbError, daysLeft } from "./format";

describe("slugify", () => {
  it("produces DB-valid slugs", () => {
    for (const name of ["Sri Venkateswara College of Engg.", "A & B Institute", "  JNTU—Kakinada  ", "Ürban Tech 2026"]) {
      expect(slugify(name)).toMatch(SLUG_RE);
    }
    expect(slugify("A & B Institute")).toBe("a-and-b-institute");
  });

  it("caps length without a trailing hyphen", () => {
    const s = slugify("x".repeat(49) + " yyyy");
    expect(s.length).toBeLessThanOrEqual(50);
    expect(s.endsWith("-")).toBe(false);
  });
});

describe("friendlyDbError", () => {
  it("maps known database errors", () => {
    expect(friendlyDbError({ message: "STUDENT_LIMIT_REACHED: plan allows 150 students" })).toMatch(/allows 150 students/);
    expect(friendlyDbError({ message: 'new row violates row-level security policy for table "batches"' })).toMatch(/permission/);
    expect(friendlyDbError(new Error("weird"))).toBe("weird");
  });
});

describe("daysLeft", () => {
  it("rounds up partial days", () => {
    expect(daysLeft("2026-10-01T12:00:00Z", new Date("2026-09-30T00:00:00Z"))).toBe(2);
    expect(daysLeft(null)).toBeNull();
  });
});
