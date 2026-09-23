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
    testTimeout: 30000,
    hookTimeout: 180000,
    // Each DB suite boots its own embedded Postgres (WASM); too many at once starve a laptop.
    maxWorkers: 4,
    minWorkers: 1,
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
