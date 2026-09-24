// Pre-render public pages to static HTML after `vite build` + `vite build --ssr src/entry-server.tsx`.
//
//   dist/index.html            → "/" pre-rendered
//   dist/<path>.html           → each other public route (served at /<path> via cleanUrls)
//   dist/app.html              → empty app shell with noindex, served for every other route (vercel.json
//                                rewrites to "/app": with cleanUrls a ".html" destination 404s)
//   dist/sitemap.xml           → generated from the same route list
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const SITE = "https://hiresume.in";
const DIST = "dist";
const SEO_BLOCK = /<!-- seo:start[\s\S]*?<!-- seo:end -->/;

// The Supabase client touches localStorage at import time; give it an in-memory one.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
  key: (i) => [...store.keys()][i] ?? null,
  get length() { return store.size; },
};

const template = readFileSync(join(DIST, "index.html"), "utf8");
if (!SEO_BLOCK.test(template) || !template.includes('<div id="root"></div>')) {
  throw new Error("dist/index.html is missing the seo:start/seo:end block or the empty #root");
}

// 1. App shell for private routes, unknown URLs and soft 404s.
const shell = template.replace(SEO_BLOCK, `<title>HiResume</title>\n    <meta name="robots" content="noindex" />`);
writeFileSync(join(DIST, "app.html"), shell);

// 2. Public pages.
const { render, PRERENDER_ROUTES } = await import(pathToFileURL(join(process.cwd(), "dist-ssr", "entry-server.js")).href);
const titles = new Map();
for (const route of PRERENDER_ROUTES) {
  const { html, head } = await render(route.path);
  if (!/<title[^>]*>[^<]+<\/title>/.test(head)) throw new Error(`${route.path}: no <title> rendered`);
  if (!head.includes('rel="canonical"')) throw new Error(`${route.path}: no canonical link rendered`);
  if (/noindex/.test(head)) throw new Error(`${route.path}: rendered noindex — is the route/slug valid?`);
  const title = head.match(/<title[^>]*>([^<]+)<\/title>/)[1];
  if (titles.has(title)) throw new Error(`${route.path}: duplicate title with ${titles.get(title)}`);
  titles.set(title, route.path);

  const page = template
    .replace(SEO_BLOCK, head)
    .replace('<div id="root"></div>', `<div id="root">${html}</div>`);
  const file = route.path === "/" ? join(DIST, "index.html") : join(DIST, `${route.path.slice(1)}.html`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, page);
  console.log(`prerendered ${route.path.padEnd(45)} ${(page.length / 1024).toFixed(0)} KB  ${title}`);
}

// 3. Sitemap.
const today = new Date().toISOString().slice(0, 10);
const urls = PRERENDER_ROUTES.map((r) => `  <url>
    <loc>${SITE}${r.path === "/" ? "/" : r.path}</loc>
    <lastmod>${r.lastmod ?? today}</lastmod>
    <changefreq>${r.changefreq}</changefreq>
    <priority>${r.priority.toFixed(1)}</priority>
  </url>`).join("\n");
writeFileSync(join(DIST, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`);
console.log(`sitemap.xml: ${PRERENDER_ROUTES.length} URLs`);

// The Supabase client keeps timers alive; we're done.
process.exit(0);
