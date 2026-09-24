// Public, indexable pages. Each is pre-rendered to static HTML at build time and listed in
// sitemap.xml. Everything else is served the app shell, which carries noindex.
import { ARTICLES } from "@/content/blog";

export interface PublicRoute {
  path: string;
  priority: number;
  changefreq: "daily" | "weekly" | "monthly";
  lastmod?: string;
}

export const PRERENDER_ROUTES: PublicRoute[] = [
  { path: "/", priority: 1.0, changefreq: "weekly" },
  { path: "/ats-checker", priority: 0.9, changefreq: "weekly" },
  { path: "/pricing", priority: 0.8, changefreq: "monthly" },
  { path: "/college-placement", priority: 0.8, changefreq: "monthly" },
  { path: "/blog", priority: 0.8, changefreq: "weekly" },
  { path: "/about", priority: 0.5, changefreq: "monthly" },
  ...ARTICLES.map((a) => ({ path: `/blog/${a.slug}`, priority: 0.7, changefreq: "monthly" as const, lastmod: a.updated })),
];
