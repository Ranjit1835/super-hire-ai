import { JSDOM } from "jsdom";

/**
 * Throw if the browser would parse a page's HTML into a different tree than React rendered
 * (e.g. a <div> inside a <p>, which the parser splits). React can't hydrate such a page: it
 * throws #418/#422 and re-renders it from scratch, losing the pre-render's benefit.
 */
export function assertParsesAsRendered(path, html) {
  const rendered = [...html.replace(/<!--[\s\S]*?-->/g, "").matchAll(/<([a-zA-Z][\w:-]*)(?=[\s/>])/g)].map((m) => m[1].toLowerCase());
  const root = new JSDOM(`<!doctype html><body><div id="root">${html}</div>`).window.document.getElementById("root");
  const parsed = [...root.querySelectorAll("*")].map((el) => el.tagName.toLowerCase());
  const i = rendered.findIndex((tag, k) => tag !== parsed[k]);
  if (i === -1 && rendered.length === parsed.length) return;
  const at = i === -1 ? Math.min(rendered.length, parsed.length) : i;
  const ctx = (a) => a.slice(Math.max(0, at - 4), at + 3).join(" > ");
  throw new Error(`${path}: the HTML parser changes the page structure at element #${at} (hydration would fail).
  React:   ${ctx(rendered)}
  Browser: ${ctx(parsed)}
  Usually a block element (div, ul, h2...) inside a <p>, or a table without <tbody>.`);
}
