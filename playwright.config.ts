import { defineConfig, devices } from "@playwright/test";

// B2C smoke + screenshot regression, and "B2B is off in production" checks.
// Runs against a production build made with .env.e2e (no production backend) served like Vercel.
// Screenshot baselines are committed for Linux only (CI); local Windows runs keep theirs untracked.
export default defineConfig({
  testDir: "e2e",
  timeout: 45_000,
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: "disabled", caret: "hide" } },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://localhost:4317",
    locale: "en-IN",
    timezoneId: "Asia/Kolkata",
    colorScheme: "dark",
    reducedMotion: "reduce",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 900 } } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: { command: "node scripts/serve-dist.mjs", env: { PORT: "4317" }, url: "http://localhost:4317/app", reuseExistingServer: false },
});
