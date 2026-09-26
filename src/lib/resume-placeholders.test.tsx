import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { Placeholders, countPlaceholders, hasPlaceholder } from "./resume-placeholders";

describe("resume placeholders", () => {
  it("counts placeholders anywhere in resume content", () => {
    const content = {
      summary: "Backend engineer who cut latency by [X%].",
      experience: [{ title: "SDE", bullets: ["Led a team of [N] engineers", "Built REST APIs in Spring Boot", "Served [number of users] users"] }],
      skills: ["Java [basic]"],
    };
    expect(countPlaceholders(content)).toBe(4);
    expect(countPlaceholders({ summary: "No placeholders, 40% faster" })).toBe(0);
    expect(hasPlaceholder("Reduced cost by [X%]")).toBe(true);
    expect(hasPlaceholder("Array access a[i] is O(1)")).toBe(true); // short bracket text is flagged too — conservative
    expect(hasPlaceholder("plain text")).toBe(false);
  });

  it("highlights each placeholder", () => {
    const { container } = render(<p><Placeholders text="Cut build time by [X%] for [N] teams" /></p>);
    const marks = [...container.querySelectorAll("mark")].map((m) => m.textContent);
    expect(marks).toEqual(["[X%]", "[N]"]);
    expect(container.textContent).toBe("Cut build time by [X%] for [N] teams");
  });
});

describe("resume-writing prompts", () => {
  const read = (fn: string) => readFileSync(`supabase/functions/${fn}/index.ts`, "utf8");

  it("every prompt that writes resume text carries the no-invented-metrics rule", () => {
    for (const fn of ["fix-resume", "enhance-resume", "studio-chat", "analyze-resume"]) {
      expect(read(fn), fn).toContain("NO_INVENTED_METRICS_RULE");
    }
    expect(readFileSync("supabase/functions/_shared/resume-honesty.ts", "utf8")).toMatch(/Never invent, estimate or "round up" figures/);
  });

  it("no longer instructs the model to add metrics to every bullet or to use invented scale", () => {
    expect(read("fix-resume")).not.toMatch(/Add or enhance metrics in every bullet/);
    expect(read("enhance-resume")).not.toMatch(/Led a team of 5\+/);
    expect(read("studio-chat")).not.toMatch(/millions of users, petabytes, 99\.99% uptime/);
  });
});
