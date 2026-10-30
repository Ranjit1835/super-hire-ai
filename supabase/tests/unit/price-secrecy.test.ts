// @vitest-environment node
// R3.1: the source half of scripts/check-b2b-price-secrecy.mjs (the bundle half runs in CI after `vite build`).
import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error plain .mjs script without types
import { bundleViolations, sourceViolations } from "../../../scripts/check-b2b-price-secrecy.mjs";

function fakeRepo(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "price-"));
  for (const [p, body] of Object.entries(files)) {
    mkdirSync(join(root, p, ".."), { recursive: true });
    writeFileSync(join(root, p), body);
  }
  return root;
}

describe("pricing secrecy check (R3.1)", () => {
  it("the real B2B source is clean", () => {
    expect(sourceViolations()).toEqual([]);
  });

  it("flags prices in TPO/student code, allows super-admin code and type declarations", () => {
    const root = fakeRepo({
      "src/b2b/college/Plan.tsx": "export const x = <p>Only ₹299 per student</p>;",
      "src/b2b/student/Home.tsx": "const p = row.price_inr_per_student;",
      "src/b2b/admin/Costs.tsx": "const p = row.price_inr_per_student; // ₹299 ok here",
      "src/features/b2b/pages/SuperAdminCosts.tsx": "₹149",
      "src/b2b/types.ts": "price_inr_per_student: number;",
    });
    const bad = sourceViolations(root);
    expect(bad).toHaveLength(2);
    expect(bad.join("\n")).toMatch(/college\/Plan\.tsx:1/);
    expect(bad.join("\n")).toMatch(/student\/Home\.tsx:1/);
  });

  it("flags price fields in any chunk that isn't a super-admin page", () => {
    const root = fakeRepo({
      "dist/assets/StudentHome-abc.js": "x.price_inr_per_student",
      "dist/assets/SuperAdminCosts-def.js": "x.price_inr_per_student",
      "dist/assets/index-ghi.js": "nothing here",
    });
    expect(bundleViolations(root)).toEqual(["dist/assets/StudentHome-abc.js: contains price_inr"]);
  });
});
