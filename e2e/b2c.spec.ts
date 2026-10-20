import { test, expect, type Page } from "@playwright/test";

// Key B2C pages: they load, render their main heading, throw no errors, and look exactly as before
// (screenshot baselines, Linux, committed). B2C must stay pixel-identical while B2B is built.
const PAGES: { path: string; name: string; heading: RegExp }[] = [
  { path: "/", name: "home", heading: /resume/i },
  { path: "/ats-checker", name: "ats-checker", heading: /ats/i },
  { path: "/pricing", name: "pricing", heading: /pric|plan/i },
  { path: "/college-placement", name: "college-placement", heading: /students|jobs|college/i },
  { path: "/blog", name: "blog", heading: /blog|guide|resume/i },
  { path: "/blog/what-is-ats-resume", name: "blog-ats", heading: /ats/i },
  { path: "/about", name: "about", heading: /job seekers|ats|hiresume/i },
  { path: "/auth", name: "auth", heading: /hiresume|sign/i },
];

// The e2e build points at an unreachable backend on purpose, so failed data calls are expected.
const EXPECTED_NOISE = /127\.0\.0\.1:54399|Failed to load resource|net::ERR_|ERR_CONNECTION_REFUSED|Failed to fetch|AuthRetryableFetchError/i;

function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !EXPECTED_NOISE.test(m.text())) errors.push(`console: ${m.text()}`);
  });
  return errors;
}

for (const p of PAGES) {
  test(`B2C ${p.name}: loads cleanly and matches its screenshot`, async ({ page }) => {
    const errors = watchErrors(page);
    // The e2e build skips framer-motion animations; decorative particles also use Math.random(),
    // so seed it to draw the same frame on every run.
    await page.addInitScript(() => {
      let seed = 42;
      Math.random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    });
    const res = await page.goto(p.path);
    expect(res?.status()).toBe(200);
    await expect(page.locator("h1").first()).toHaveText(p.heading);
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
    expect(errors, errors.join("\n")).toEqual([]);
    await expect(page).toHaveScreenshot(`${p.name}.png`, { fullPage: true, timeout: 20_000 });
  });
}

test("B2C: the voice interview asks visitors to sign in and comes back afterwards", async ({ page }) => {
  await page.goto("/voice-interview");
  await expect(page).toHaveURL(/\/auth\?redirect=%2Fvoice-interview/);
});

test("B2C: unknown pages show the 404 page", async ({ page }) => {
  await page.goto("/definitely-not-a-page");
  await expect(page.getByRole("heading", { name: "We couldn't find that page" })).toBeVisible();
});

// Production builds don't set VITE_B2B_ENABLED: no B2B route exists, signed in or not.
for (const path of ["/org", "/org/abc", "/admin/orgs", "/admin/usage", "/admin/costs", "/learn", "/test/demo-college", "/invite/sometoken"]) {
  test(`B2B is off in production builds: ${path} is a 404`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: "We couldn't find that page" })).toBeVisible();
  });
}
