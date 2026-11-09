// @vitest-environment node
// No dead internal links: every path the app links or navigates to (header, footer, pages, blog
// articles, config objects) must match a route in src/App.tsx or a B2B V1 area's routes.tsx.
import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { FEATURES, FOOTER_COLUMNS, PUBLIC_NAV, APP_NAV, ACCOUNT_NAV } from "./site-nav";
import { PRERENDER_ROUTES } from "@/seo/routes";
import { ARTICLES } from "@/content/blog";

/** Stands in for a ${...} expression in a template-literal link. */
const DYNAMIC = "__dynamic__";

function routePatterns(): RegExp[] {
  const app = readFileSync("src/App.tsx", "utf8");
  const patterns: RegExp[] = [];
  // Nested routes are relative to their parent; App.tsx has one nested block (/org/:orgId).
  const nestedParent = "/org/:orgId";
  for (const m of app.matchAll(/<Route\s+(index\s+)?(?:path="([^"]+)")?/g)) {
    const [, index, path] = m;
    if (path === "*") continue;
    patterns.push(toPattern(index ? nestedParent : path.startsWith("/") ? path : `${nestedParent}/${path}`));
  }
  // B2B V1 routes live in one routes.tsx per area (src/b2b/<area>/routes.tsx) as absolute `path: "..."` objects.
  for (const area of readdirSync("src/b2b")) {
    const file = join("src/b2b", area, "routes.tsx");
    if (!existsSync(file)) continue;
    for (const m of readFileSync(file, "utf8").matchAll(/\bpath:\s*"(\/[^"]*)"/g)) patterns.push(toPattern(m[1]));
  }
  return patterns;
}

function toPattern(full: string): RegExp {
  const re = full
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\/\*$/, "(?:/.*)?")
    .replace(/:[A-Za-z]+/g, "[^/]+");
  return new RegExp(`^${re}/?$`);
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? sourceFiles(p) : /\.(tsx?|md)$/.test(n) && !/\.test\./.test(n) ? [p] : [];
  });
}

/** Internal link targets written in the code, with ${...} replaced by a sample segment. */
function linkTargets(): { file: string; path: string }[] {
  const out: { file: string; path: string }[] = [];
  const re = /(?:\bto=\{?|\bhref=\{?|\bnavigate\(|\b(?:href|to|link|path):\s*)\s*["'`](\/[^"'`\s)]*)["'`)]/g;
  for (const file of sourceFiles("src")) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(re)) {
      const path = m[1].replace(/\$\{[^}]*\}/g, DYNAMIC).split(/[?#]/)[0];
      if (/\.[a-z0-9]{2,5}$/i.test(path)) continue; // static files (/logo.svg, /og.png)
      out.push({ file, path });
    }
  }
  return out;
}

const patterns = routePatterns();
const slugs = new Set(ARTICLES.map((a) => a.slug));
// /blog/:slug accepts any slug, but only real articles render (links inside articles: blog.test.ts).
// A slug computed at runtime (`/blog/${a.slug}`) can't be checked here.
const resolves = (path: string) =>
  patterns.some((re) => re.test(path)) &&
  (!/^\/blog\/[^/]+\/?$/.test(path) || path.includes(DYNAMIC) || slugs.has(path.split("/")[2]));

describe("internal links", () => {
  it("the route matcher itself works", () => {
    expect(patterns.length).toBeGreaterThan(30);
    expect(resolves("/")).toBe(true);
    expect(resolves("/analysis/abc-123")).toBe(true);
    expect(resolves("/org/1/students/2")).toBe(true);
    expect(resolves("/no-such-page")).toBe(false);
    expect(resolves("/analysis")).toBe(false);
    expect(resolves("/blog/what-is-ats-resume")).toBe(true);
    expect(resolves("/blog/no-such-article")).toBe(false);
  });

  it("header, footer and home-page feature links all resolve", () => {
    const all = [...PUBLIC_NAV, ...APP_NAV, ...ACCOUNT_NAV, ...FOOTER_COLUMNS.flatMap((c) => c.links), ...FEATURES];
    expect(all.filter((l) => !resolves(l.href)).map((l) => l.href)).toEqual([]);
  });

  it("every pre-rendered (sitemap) page is a real route", () => {
    expect(PRERENDER_ROUTES.filter((r) => !resolves(r.path)).map((r) => r.path)).toEqual([]);
  });

  it("every link and navigate() target in the code resolves to a route", () => {
    const targets = linkTargets();
    expect(targets.length).toBeGreaterThan(50); // the scan is finding links
    const dead = targets.filter((t) => !resolves(t.path)).map((t) => `${t.file}: ${t.path}`);
    expect(dead).toEqual([]);
  });

  it("every product feature has a home-page entry", () => {
    const featureRoutes = ["/ats-checker", "/build-resume", "/studio", "/voice-interview", "/leaderboard", "/college-placement"];
    const onHome = new Set(FEATURES.map((f) => f.href));
    expect(featureRoutes.filter((r) => !onHome.has(r))).toEqual([]);
  });
});
