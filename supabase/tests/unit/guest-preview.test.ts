import { describe, it, expect } from "vitest";
import { guestPreview } from "../../functions/_shared/guest-preview";

const issue = (name: string) => ({ issue: name, whyItMatters: `${name} why`, fixRecommendation: `${name} fix` });

describe("guestPreview", () => {
  it("shows the top critical issue without its fix", () => {
    const { topIssue } = guestPreview({ criticalIssues: [issue("a"), issue("b")], warnings: [issue("c")] });
    expect(topIssue).toEqual({ issue: "a", whyItMatters: "a why" });
    expect(JSON.stringify(topIssue)).not.toContain("fix");
  });

  it("falls back to a warning, then an optimization, for strong resumes", () => {
    expect(guestPreview({ criticalIssues: [], warnings: [issue("c")] }).topIssue?.issue).toBe("c");
    expect(guestPreview({ optimizationOpportunities: [issue("d")] }).topIssue?.issue).toBe("d");
  });

  it("shows three keywords and the real total", () => {
    const preview = guestPreview({ missingHighImpactKeywords: ["k1", "k2", "k3", "k4", "k5"] });
    expect(preview.missingKeywords).toEqual(["k1", "k2", "k3"]);
    expect(preview.missingKeywordsCount).toBe(5);
  });

  it("copes with an old result that has none of this", () => {
    expect(guestPreview(null)).toEqual({ topIssue: null, missingKeywords: [], missingKeywordsCount: 0 });
    expect(guestPreview({ criticalIssues: [{ whyItMatters: "no title" }] }).topIssue).toBeNull();
  });
});
