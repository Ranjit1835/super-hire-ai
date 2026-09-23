// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  agreement, calibrate, formatReport, parseHumanCsv, pearson, quadraticWeightedKappa, type AiRow,
} from "../../../scripts/calibration-lib";

describe("statistics", () => {
  it("pearson and QWK are 1 for identical ratings and drop with disagreement", () => {
    expect(pearson([2, 5, 8, 6], [2, 5, 8, 6])).toBe(1);
    expect(quadraticWeightedKappa([2, 5, 8, 6], [2, 5, 8, 6])).toBe(1);
    const k = quadraticWeightedKappa([2, 5, 8, 6, 4], [3, 5, 7, 6, 5])!;
    expect(k).toBeGreaterThan(0.8);
    expect(k).toBeLessThan(1);
    expect(quadraticWeightedKappa([2, 5, 8, 6, 4], [8, 5, 2, 4, 6])!).toBeLessThan(0);
  });

  it("agreement reports bias, MAE and within-1", () => {
    expect(agreement([5, 6, 7, 8], [6, 7, 8, 9])).toMatchObject({ n: 4, bias: 1, mae: 1, within_1: 1 });
    expect(agreement([5, 5], [8, 5])).toMatchObject({ mae: 1.5, within_1: 0.5, pearson: null });
  });
});

describe("parseHumanCsv", () => {
  it("reads scores, blank cells and readiness; reports bad values by line", () => {
    const csv = "interview_id,rater,technical_knowledge,communication,readiness_level\n" +
      "a,Ravi,7,,developing\nb,Ravi,11,6,Ready\n,Ravi,5,5,\n";
    const { rows, errors } = parseHumanCsv(csv);
    expect(rows).toEqual([
      { interview_id: "a", rater: "Ravi", scores: { technical_knowledge: 7 }, readiness: "developing" },
      { interview_id: "b", rater: "Ravi", scores: { communication: 6 }, readiness: "ready" },
    ]);
    expect(errors).toEqual(["line 3: technical_knowledge must be 0–10 (got \"11\")", "line 4: missing interview_id"]);
  });
});

describe("calibrate", () => {
  const human = parseHumanCsv(
    "interview_id,rater,technical_knowledge,communication,readiness_level\n" +
    "i1,A,6,7,developing\ni1,B,7,7,developing\n" +
    "i2,A,3,4,not_ready\ni2,B,4,5,not_ready\n" +
    "i3,A,8,8,ready\ni3,B,8,7,ready\n" +
    "i4,A,5,6,developing\n" +
    "i9,A,5,5,developing\n",
  ).rows;
  const ai: AiRow[] = [
    { interview_id: "i1", scores: { technical_knowledge: 7, communication: 6 }, readiness: "developing" },
    { interview_id: "i2", scores: { technical_knowledge: 3, communication: "insufficient_data" }, readiness: "not_ready" },
    { interview_id: "i3", scores: { technical_knowledge: 9, communication: 8 }, readiness: "developing" },
    { interview_id: "i4", scores: { technical_knowledge: 5, communication: 6 }, readiness: "developing" },
  ];

  it("averages multiple trainers, skips insufficient AI scores, and computes a trainer baseline", () => {
    const r = calibrate(human, ai);
    expect(r.interviews_matched).toBe(4);
    expect(r.interviews_missing_ai).toEqual(["i9"]);
    const tech = r.dimensions.find((d) => d.dimension === "technical_knowledge")!;
    expect(tech.n).toBe(4);
    expect(tech.mean_human).toBe(5.75); // (6.5 + 3.5 + 8 + 5) / 4
    expect(tech.human_baseline).toMatchObject({ n: 3, mae: 0.667 });
    const comm = r.dimensions.find((d) => d.dimension === "communication")!;
    expect(comm.n).toBe(3);
    expect(comm.ai_insufficient).toBe(1);
    const unused = r.dimensions.find((d) => d.dimension === "language")!;
    expect(unused.n).toBe(0);
  });

  it("reports readiness agreement with a confusion matrix, and formats a readable table", () => {
    const r = calibrate(human, ai);
    expect(r.readiness).toMatchObject({ n: 4, exact: 0.75 });
    expect(r.readiness.confusion.ready.developing).toBe(1);
    const text = formatReport(r);
    expect(text).toMatch(/technical_knowledge\s+4/);
    expect(text).toMatch(/Readiness exact agreement: 75%/);
  });
});
