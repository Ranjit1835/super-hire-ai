import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { performanceLevel } from "./score-levels";

describe("performanceLevel", () => {
  it("uses the same bands as the analysis prompt", () => {
    expect(performanceLevel(0).label).toBe("High Risk – Immediate Fix Required");
    expect(performanceLevel(37).label).toBe("High Risk – Immediate Fix Required");
    expect(performanceLevel(49).tone).toBe("risk");
    expect(performanceLevel(50).label).toBe("Needs Strategic Improvement");
    expect(performanceLevel(64).tone).toBe("improve");
    expect(performanceLevel(65).label).toBe("Competitive but Optimizable");
    expect(performanceLevel(79).tone).toBe("competitive");
    expect(performanceLevel(80).label).toBe("Strong & Market Ready");
    expect(performanceLevel(100).tone).toBe("strong");
  });

  it("matches the thresholds analyze-resume enforces on the server", () => {
    const fn = readFileSync("supabase/functions/analyze-resume/index.ts", "utf8");
    expect(fn).toMatch(/finalScore >= 80 \? "Strong & Market Ready"/);
    expect(fn).toMatch(/finalScore >= 65 \? "Competitive but Optimizable"/);
    expect(fn).toMatch(/finalScore >= 50 \? "Needs Strategic Improvement"/);
  });
});
