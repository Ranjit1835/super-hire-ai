// @vitest-environment node
// Guards against re-introducing marketing claims we can't substantiate (removed 2026-09-24):
// invented testimonials/ratings/usage numbers, and statistics with no reliable source.
// If a figure becomes real and verifiable, add it with its source and adjust this list.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["src/pages", "src/components", "index.html"];
const BANNED: [RegExp, string][] = [
  [/75\s?% of (all )?resumes/i, "unsourced '75% of resumes rejected' statistic"],
  [/98\s?% of Fortune/i, "unsourced Fortune 500 statistic"],
  [/aggregateRating|4\.8\s?\/\s?5|User Rating/i, "rating without real, displayed reviews"],
  [/(10,000|12,000|1,200)\+?\s*(resumes|students)/i, "unverified usage count"],
  [/Colleges Onboarded|2\.4x more/i, "unverified institutional claim"],
  [/eye-tracking/i, "claims eye-tracking research we don't do"],
  [/Real people, real scores/i, "fabricated social proof"],
  [/never stored permanently/i, "false privacy claim (resumes are stored in the account)"],
];

function files(p: string): string[] {
  if (statSync(p).isFile()) return [p];
  return readdirSync(p).flatMap((n) => files(join(p, n))).filter((f) => /\.(tsx|ts|html)$/.test(f) && !/\.test\./.test(f));
}

describe("public copy", () => {
  it("contains no unsubstantiated claims", () => {
    const hits: string[] = [];
    for (const f of ROOTS.flatMap(files)) {
      const text = readFileSync(f, "utf8");
      for (const [re, why] of BANNED) if (re.test(text)) hits.push(`${f}: ${why}`);
    }
    expect(hits).toEqual([]);
  });
});
