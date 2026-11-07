// Real Dolos on real code. Needs the native tree-sitter parsers (built in the Docker image; DOLOS_REQUIRED=1 there
// makes a missing parser a failure instead of a skip).
import { test } from "node:test";
import assert from "node:assert/strict";

let analyze = null;
try { ({ analyze } = await import("../src/analyze.mjs")); } catch (e) {
  if (process.env.DOLOS_REQUIRED) throw e;
}
const opts = { skip: analyze ? false : "Dolos native parsers not available here (run in the Docker image)" };

const original = `def solve(nums, target):
    seen = {}
    for i, n in enumerate(nums):
        if target - n in seen:
            return [seen[target - n], i]
        seen[n] = i
    return []
`;
// Same program with renamed variables and a comment: what copying usually looks like.
const renamed = `def solve(nums, target):
    # find the pair
    lookup = {}
    for idx, val in enumerate(nums):
        if target - val in lookup:
            return [lookup[target - val], idx]
        lookup[val] = idx
    return []
`;
// A different approach to the same task.
const different = `def solve(nums, target):
    order = sorted(range(len(nums)), key=lambda k: nums[k])
    lo, hi = 0, len(nums) - 1
    while lo < hi:
        s = nums[order[lo]] + nums[order[hi]]
        if s == target:
            return sorted([order[lo], order[hi]])
        if s < target:
            lo += 1
        else:
            hi -= 1
    return []
`;

test("renamed copies score high; a different solution doesn't; starter code is ignored", opts, async () => {
  const pairs = await analyze({
    language: "python", starter_code: "def solve(nums, target):\n",
    submissions: [{ attempt_id: "A", code: original }, { attempt_id: "B", code: renamed }, { attempt_id: "C", code: different }],
  }, {});
  const ab = pairs.find((p) => [p.attempt_a, p.attempt_b].sort().join() === "A,B");
  assert.ok(ab, "the renamed copy is reported");
  assert.ok(ab.similarity >= 0.6, `similarity ${ab.similarity}`);
  assert.ok(ab.fragments.length > 0);
  const ac = pairs.find((p) => [p.attempt_a, p.attempt_b].sort().join() === "A,C");
  assert.ok(!ac || ac.similarity < ab.similarity, "a different approach scores lower");
});
