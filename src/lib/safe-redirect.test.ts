import { describe, it, expect, beforeEach } from "vitest";
import { authUrlFor, rememberRedirect, safeRedirect, takeRememberedRedirect } from "./safe-redirect";
import { assertParsesAsRendered } from "../../scripts/html-structure.mjs";

describe("safeRedirect", () => {
  it("keeps same-site paths", () => {
    expect(safeRedirect("/studio")).toBe("/studio");
    expect(safeRedirect("/analysis/abc?tab=fix")).toBe("/analysis/abc?tab=fix");
  });
  it("rejects anything that could leave the site or loop", () => {
    for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)", "studio", "", null, undefined, "/auth", "/auth?redirect=/x"]) {
      expect(safeRedirect(bad as string)).toBeNull();
    }
  });
  it("builds sign-in links that come back", () => {
    expect(authUrlFor("/build-resume")).toBe("/auth?redirect=%2Fbuild-resume");
    expect(authUrlFor("/")).toBe("/auth");
    expect(authUrlFor("//evil.example")).toBe("/auth");
  });
});

describe("remembered redirect (survives Google sign-in and the sign-up code step)", () => {
  beforeEach(() => sessionStorage.clear());
  it("is read once", () => {
    rememberRedirect("/mock-interview");
    expect(takeRememberedRedirect()).toBe("/mock-interview");
    expect(takeRememberedRedirect()).toBeNull();
  });
  it("is cleared by visiting sign-in without one, and never stores unsafe values", () => {
    rememberRedirect("/studio");
    rememberRedirect(null);
    expect(takeRememberedRedirect()).toBeNull();
    rememberRedirect("https://evil.example");
    expect(takeRememberedRedirect()).toBeNull();
  });
});

describe("pre-render hydration check", () => {
  it("passes markup the browser keeps as-is", () => {
    expect(() => assertParsesAsRendered("/", '<main><div class="a"><p>Hi <span>there</span></p><svg><path d="M0"></path></svg></div></main>')).not.toThrow();
  });
  it("fails a <div> inside a <p> (the home-page bug)", () => {
    expect(() => assertParsesAsRendered("/", "<p>Starter<div>Popular</div></p>")).toThrow(/changes the page structure/);
  });
  it("fails a table without <tbody>", () => {
    expect(() => assertParsesAsRendered("/", "<table><tr><td>x</td></tr></table>")).toThrow(/changes the page structure/);
  });
});
