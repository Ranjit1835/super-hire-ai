// Build-time renderer for public pages (see scripts/prerender.mjs). Renders the same tree as
// src/main.tsx, with a StaticRouter, and waits for lazy routes so the HTML is complete.
import { renderToPipeableStream } from "react-dom/server";
import { StaticRouter } from "react-router-dom/server";
import { HelmetProvider, type HelmetServerState } from "react-helmet-async";
import { Writable } from "node:stream";
import { AppContent, AppProviders } from "./App";

export { PRERENDER_ROUTES } from "./seo/routes";

export interface RenderResult {
  html: string;
  head: string;
}

export function render(url: string): Promise<RenderResult> {
  const helmetContext: { helmet?: HelmetServerState } = {};
  return new Promise((resolve, reject) => {
    let html = "";
    const sink = new Writable({
      write(chunk, _enc, cb) { html += chunk.toString(); cb(); },
      final(cb) {
        const h = helmetContext.helmet;
        const head = h
          ? [h.title, h.meta, h.link, h.script].map((part) => part.toString()).filter(Boolean).join("\n    ")
          : "";
        resolve({ html, head });
        cb();
      },
    });
    const stream = renderToPipeableStream(
      <HelmetProvider context={helmetContext}>
        <AppProviders>
          <StaticRouter location={url}>
            <AppContent />
          </StaticRouter>
        </AppProviders>
      </HelmetProvider>,
      {
        onAllReady() { stream.pipe(sink); },
        onShellError: reject,
        onError(e) { reject(e); },
      },
    );
    setTimeout(() => reject(new Error(`render timed out: ${url}`)), 30_000).unref();
  });
}
