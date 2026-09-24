// @vitest-environment node
import { describe, it, expect } from "vitest";
import { normalizeIndianMobile, validateLead, publicTestConsentText } from "../../functions/_shared/lead";

describe("normalizeIndianMobile", () => {
  it.each([
    ["98765 43210", "+919876543210"], ["+91-98765-43210", "+919876543210"], ["09876543210", "+919876543210"],
    ["919876543210", "+919876543210"], ["(+91) 6123456789", "+916123456789"],
  ])("%s → %s", (i, o) => expect(normalizeIndianMobile(i)).toBe(o));
  it.each(["12345 67890", "98765", "+1 415 555 0100", "abcdefghij"])("rejects %s", (i) => expect(normalizeIndianMobile(i)).toBeNull());
});

describe("validateLead", () => {
  it("cleans a valid lead", () => {
    expect(validateLead({ full_name: "  Ravi   Kumar ", phone: "98765 43210", email: "Ravi@Gmail.com", target_course: " Java Full Stack " }))
      .toEqual({ lead: { full_name: "Ravi Kumar", phone: "+919876543210", email: "ravi@gmail.com", target_course: "Java Full Stack" }, errors: {} });
  });
  it("reports each problem", () => {
    const { lead, errors } = validateLead({ full_name: "R", phone: "123", email: "nope" });
    expect(lead).toBeNull();
    expect(Object.keys(errors).sort()).toEqual(["email", "full_name", "phone"]);
  });
  it("consent names the institution", () => {
    expect(publicTestConsentText("Java Academy")).toMatch(/Java Academy may contact me/);
  });
});
