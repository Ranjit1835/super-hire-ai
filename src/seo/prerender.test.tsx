// @vitest-environment node
// Renders every public route the way scripts/prerender.mjs does at build time.
import { describe, it, expect, beforeAll } from "vitest";

type Mod = typeof import("../entry-server");
let mod: Mod;

beforeAll(async () => {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
  mod = await import("../entry-server");
}, 120_000);

describe("pre-rendered public pages", () => {
  it("each route renders content with its own title, description and canonical", async () => {
    const titles = new Set<string>();
    for (const route of mod.PRERENDER_ROUTES) {
      const { html, head } = await mod.render(route.path);
      const title = head.match(/<title[^>]*>([^<]+)<\/title>/)?.[1];
      expect(title, route.path).toBeTruthy();
      expect(titles.has(title!), `duplicate title on ${route.path}`).toBe(false);
      titles.add(title!);
      expect(head).toMatch(/name="description" content="[^"]{50,}"/);
      const canonical = route.path === "/" ? "https://hiresume.in/" : `https://hiresume.in${route.path}`;
      expect(head).toContain(`rel="canonical" href="${canonical}"`);
      expect(head).not.toMatch(/noindex/);
      expect(html).toMatch(/<h1[\s>]/);
      expect(html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").length, route.path).toBeGreaterThan(500);
    }
  }, 120_000);

  it("article pages carry Article + FAQ structured data and no fake ratings", async () => {
    const { head, html } = await mod.render("/blog/what-is-ats-resume");
    expect(head).toContain('"@type":"Article"');
    expect(head).toContain('"@type":"FAQPage"');
    expect(head + html).not.toMatch(/aggregateRating/i);
    expect(html).toContain('href="/blog/ats-friendly-resume-format"');
  });

  it("unknown article slugs render the noindex 404", async () => {
    const { head } = await mod.render("/blog/does-not-exist");
    expect(head).toMatch(/noindex/);
  });
});
