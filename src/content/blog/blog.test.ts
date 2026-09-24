import { describe, it, expect } from "vitest";
import { ARTICLES } from "./index";
import { ACTION_VERB_GROUPS } from "./resume-action-verbs";
import { PRERENDER_ROUTES } from "@/seo/routes";

const text = (a: (typeof ARTICLES)[number]) =>
  a.body.map((b) => ("text" in b ? b.text : "items" in b ? b.items.join(" ") : "rows" in b ? b.rows.flat().join(" ") : "good" in b ? `${b.bad} ${b.good}` : "")).join(" ");

describe("blog content", () => {
  it("has unique slugs and titles", () => {
    expect(new Set(ARTICLES.map((a) => a.slug)).size).toBe(ARTICLES.length);
    expect(new Set(ARTICLES.map((a) => a.seoTitle ?? a.title)).size).toBe(ARTICLES.length);
  });

  it.each(ARTICLES.map((a) => [a.slug, a] as const))("%s has search-ready metadata", (_slug, a) => {
    expect(a.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect((a.seoTitle ?? a.title).length + " | HiResume".length).toBeLessThanOrEqual(70);
    expect(a.description.length).toBeGreaterThanOrEqual(110);
    expect(a.description.length).toBeLessThanOrEqual(170);
    expect(a.updated >= a.published).toBe(true);
    expect(a.body.some((b) => b.type === "cta")).toBe(true);
    expect(a.body.filter((b) => b.type === "h2").length).toBeGreaterThanOrEqual(3);
  });

  it("internal links point at pages that exist", () => {
    const known = new Set([...PRERENDER_ROUTES.map((r) => r.path), "/mock-interview", "/build-resume"]);
    for (const a of ARTICLES) {
      for (const [, href] of text(a).matchAll(/\]\((\/[^)]*)\)/g)) {
        expect(known.has(href), `${a.slug} links to ${href}`).toBe(true);
      }
    }
  });

  it("titles' counts match the content", () => {
    const verbs = ACTION_VERB_GROUPS.flatMap((g) => g.verbs);
    expect(verbs.length).toBeGreaterThanOrEqual(150);
    expect(new Set(verbs.map((v) => v.toLowerCase())).size).toBe(verbs.length);
    const quantify = ARTICLES.find((a) => a.slug === "quantify-resume-achievements")!;
    const n = Number(quantify.title.match(/\((\d+) Examples\)/)![1]);
    const examples = quantify.body.filter((b) => b.type === "ul").slice(0, 7).reduce((s, b) => s + (b.type === "ul" ? b.items.length : 0), 0);
    expect(examples).toBe(n);
  });

  it("does not repeat the unsupported '75% rejected by ATS' claim as fact", () => {
    for (const a of ARTICLES) {
      const t = text(a);
      if (t.includes("75%")) expect(t).toMatch(/no reliable source/);
    }
  });

  it("every article is pre-rendered and in the sitemap", () => {
    for (const a of ARTICLES) expect(PRERENDER_ROUTES.some((r) => r.path === `/blog/${a.slug}`)).toBe(true);
  });
});
