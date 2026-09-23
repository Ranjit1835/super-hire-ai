import { describe, it, expect } from "vitest";
import { isB2BPath } from "./paths";

describe("isB2BPath", () => {
  it("matches institution routes only", () => {
    for (const p of ["/org", "/org/abc", "/admin/orgs", "/learn", "/invite/tok", "/test/svr-college"]) expect(isB2BPath(p)).toBe(true);
    for (const p of ["/", "/dashboard", "/voice-interview", "/organic", "/testimonials", "/studio/x"]) expect(isB2BPath(p)).toBe(false);
  });
});
