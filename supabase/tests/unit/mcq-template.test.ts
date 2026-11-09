// @vitest-environment node
import { describe, it, expect } from "vitest";
import { evalFormula, generateVariants, parseFormula, templateErrors, type McqTemplate } from "../../functions/_shared/mcq-template";

const ev = (f: string, v: Record<string, number> = {}) => evalFormula(parseFormula(f), v);

const train: McqTemplate = {
  title: "Train speed",
  statement: "A train covers {{d}} km in {{t}} hours. What is its average speed?",
  params: [{ name: "d", min: 60, max: 600, step: 30 }, { name: "t", min: 2, max: 6 }],
  answer: "d / t", distractors: ["d * t", "d / t + 10", "d / (t + 1)"], decimals: 0, unit: "km/h",
  constraints: ["d % t == 0", "d % (t + 1) == 0"],
};

describe("formulas (R2.2)", () => {
  it("follows precedence, functions and comparisons, without eval", () => {
    expect(ev("2 + 3 * 4 ^ 2")).toBe(50);
    expect(ev("2 ^ 3 ^ 2")).toBe(512);                 // right-associative
    expect(ev("-(a - 10) % 4", { a: 3 })).toBe(3);
    expect(ev("round(10 / 3, 2) + gcd(12, 18) + lcm(4, 6)")).toBe(3.33 + 6 + 12);
    expect(ev("a >= 2 && !(a == 3) || 0", { a: 2 })).toBe(1);
    expect(ev("1 / 0")).toBeNaN();
  });

  it("refuses anything that isn't a formula", () => {
    for (const bad of ["alert(1)", "a.constructor", "process", "1 +", "(1", "a b", "x[0]", "`x`"]) {
      expect(() => ev(bad, { a: 1 })).toThrow();
    }
  });
});

describe("templates (R2.2)", () => {
  it("explains what's wrong with a template", () => {
    expect(templateErrors(train)).toEqual([]);
    const errs = templateErrors({ ...train, statement: "Speed of {{x}}?", distractors: ["d"], params: [{ name: "d", min: 5, max: 1 }] });
    expect(errs).toEqual(expect.arrayContaining([
      '"d" needs a range (min ≤ max) or a list of values.', "Add at least 3 wrong-option formulas.",
      'Answer: "t" isn\'t a parameter.', 'Question text: "x" isn\'t a parameter.',
    ]));
  });

  it("makes distinct, correct variants with the right answer in different places", () => {
    const { variants } = generateVariants(train, 12, "family-1");
    expect(variants.length).toBe(12);
    expect(new Set(variants.map((v) => JSON.stringify(v.params))).size).toBe(12);
    for (const v of variants) {
      const { d, t } = v.params;
      expect(v.statement).toBe(`A train covers ${d} km in ${t} hours. What is its average speed?`);
      expect(v.options.find((o) => o.id === v.answer[0])!.text).toBe(`${d / t} km/h`);
      expect(new Set(v.options.map((o) => o.text)).size).toBe(4);
      expect(d % t).toBe(0);
    }
    expect(new Set(variants.map((v) => v.answer[0])).size).toBeGreaterThan(1);
  });

  it("is deterministic for a seed and different across seeds", () => {
    expect(generateVariants(train, 5, "s").variants).toEqual(generateVariants(train, 5, "s").variants);
    expect(generateVariants(train, 5, "s").variants).not.toEqual(generateVariants(train, 5, "other").variants);
  });

  it("skips combinations whose options collide, and stops when the space runs out", () => {
    const tiny: McqTemplate = { ...train, params: [{ name: "d", choices: [60, 120] }, { name: "t", choices: [2] }], constraints: [] };
    const r = generateVariants(tiny, 10, "x");
    expect(r.variants.length).toBe(2);              // only two combinations exist
    const clash: McqTemplate = { ...tiny, distractors: ["d / t", "d * t", "d + t"] };   // a wrong option equals the answer
    expect(generateVariants(clash, 5, "x").variants).toEqual([]);
  });

  it("computes {{= formula}} in the text and rounds to the chosen decimals", () => {
    const t: McqTemplate = { title: "Interest", statement: "₹{{p}} at {{r}}% for {{= n}} years. Simple interest?",
      params: [{ name: "p", choices: [1000] }, { name: "r", choices: [7.5] }, { name: "n", choices: [3] }],
      answer: "p * r * n / 100", distractors: ["p * r / 100", "p * (1 + r / 100) ^ n - p", "p * r * n / 10"], decimals: 2 };
    const [v] = generateVariants(t, 1, "i").variants;
    expect(v.statement).toBe("₹1000 at 7.5% for 3 years. Simple interest?");
    expect(v.options.find((o) => o.id === v.answer[0])!.text).toBe("225");
    expect(v.options.map((o) => o.text)).toContain("242.3");   // 1000 * 1.075^3 - 1000 = 242.296875
  });
});
