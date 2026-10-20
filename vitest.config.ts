import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}", "supabase/tests/**/*.test.ts"],
    // B2B pages are tested with the portal switched on; b2b-flag-off.test.tsx covers the off state.
    env: { VITE_B2B_ENABLED: "true" },
    testTimeout: 30000,
    hookTimeout: 180000,
    // Each DB suite boots its own embedded Postgres (WASM); too many at once starve a laptop.
    maxWorkers: 4,
    minWorkers: 1,
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src"), "npm:zod@3.25.76": "zod" },
  },
});
