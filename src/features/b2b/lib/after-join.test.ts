import { describe, expect, it } from "vitest";
import { afterJoin } from "./after-join";

const org = (type: string) => ({ id: "o1", name: "Org", type, logo_url: null, is_demo: false });

describe("afterJoin", () => {
  it("sends college staff to the placement portal and company staff to the hiring portal", () => {
    expect(afterJoin({ role: "org_admin", org: org("college") }).to).toBe("/c/o1");
    expect(afterJoin({ role: "trainer", org: org("college") }).to).toBe("/c/o1");
    expect(afterJoin({ role: "recruiter", org: org("company") }).to).toBe("/co/o1");
    expect(afterJoin({ role: "org_admin", org: org("company") }).to).toBe("/co/o1");
  });
  it("sends V1 college students to /learn/v1 and pilot students to /learn", () => {
    expect(afterJoin({ role: "student", org: org("college") }).to).toBe("/learn/v1");
    expect(afterJoin({ role: undefined, org: org("coaching_institute") }).to).toBe("/learn");
  });
});
