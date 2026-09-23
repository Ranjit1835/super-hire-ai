// @vitest-environment node
import { describe, it, expect } from "vitest";
import { normalizeModuleSpec, emptyModuleSpec } from "../../functions/_shared/module-spec";

describe("normalizeModuleSpec", () => {
  it("trims, drops empty topics and omits empty optional fields", () => {
    const { spec, errors } = normalizeModuleSpec({
      name: "  SQL   Joins ", type: "skill", topics: [" Inner join ", "", "Left  join"],
      pass_threshold: "6.25", max_turns: 8, max_minutes: 10, description: "  ", style_notes: "",
    });
    expect(errors).toEqual({});
    expect(spec).toEqual({ name: "SQL Joins", type: "skill", topics: ["Inner join", "Left join"], pass_threshold: 6.3, max_turns: 8, max_minutes: 10 });
  });

  it("reports field-level errors", () => {
    const { spec, errors } = normalizeModuleSpec({ ...emptyModuleSpec(), topics: ["A b", "a B"], max_turns: 40, pass_threshold: -1 });
    expect(spec).toBeNull();
    expect(errors).toMatchObject({
      name: expect.any(String), topics: "Topics must be unique", max_turns: expect.stringMatching(/3 to 30/),
      pass_threshold: expect.any(String),
    });
  });

  it("rejects unrealistic pacing", () => {
    expect(normalizeModuleSpec({ ...emptyModuleSpec(), name: "Fast", topics: ["x y"], max_turns: 30, max_minutes: 10 }).errors.max_turns)
      .toMatch(/under 30 seconds/);
  });
});
