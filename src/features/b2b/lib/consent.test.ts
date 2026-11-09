import { describe, it, expect } from "vitest";
import { B2B_CONSENT_VERSION, B2B_STAFF_CONSENT_VERSION, inviteConsent } from "../../../../supabase/functions/_shared/b2b-consent";

describe("invite consent", () => {
  it("staff accept a confidentiality undertaking; students and candidates the assessment consent", () => {
    const college = { name: "SVR College", type: "college" };
    const tpo = inviteConsent("org_admin", college);
    expect(tpo.version).toBe(B2B_STAFF_CONSENT_VERSION);
    expect(tpo.text).toContain("student information");
    expect(tpo.text).toContain("placement work");
    expect(inviteConsent("recruiter", { name: "Acme", type: "company" }).text).toContain("candidate information");
    expect(inviteConsent("student", college).version).toBe(B2B_CONSENT_VERSION);
    expect(inviteConsent(null, college).version).toBe(B2B_CONSENT_VERSION);
  });
});
