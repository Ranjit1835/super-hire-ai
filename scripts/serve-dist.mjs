#!/usr/bin/env node
// Serve dist/ the way vercel.json does: clean URLs (/pricing → pricing.html), immutable assets, and
// every other path → app.html (the noindex app shell). Used by the Playwright tests.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..", "dist");
const PORT = Number(process.env.PORT ?? 4173);
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml",
  ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json", ".xml": "application/xml", ".txt": "text/plain",
  ".woff2": "font/woff2", ".mjs": "text/javascript", ".webp": "image/webp" };

async function file(p) { try { const s = await stat(p); return s.isFile() ? p : null; } catch { return null; } }

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  const clean = normalize(decodeURIComponent(url.pathname)).replace(/^[\/]+/, "");
  if (clean.includes("..")) { res.writeHead(400).end(); return; }
  const candidates = url.pathname.startsWith("/assets/")
    ? [join(ROOT, clean)]
    : [join(ROOT, clean), join(ROOT, `${clean}.html`), join(ROOT, clean, "index.html"), join(ROOT, "app.html")];
  for (const c of candidates) {
    const f = await file(c);
    if (f) {
      res.writeHead(200, { "Content-Type": TYPES[extname(f)] ?? "application/octet-stream" });
      res.end(await readFile(f));
      return;
    }
  }
  res.writeHead(404).end("not found");
}).listen(PORT, () => console.log(`serving dist on http://localhost:${PORT}`));
