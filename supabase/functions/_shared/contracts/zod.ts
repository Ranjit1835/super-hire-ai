// One zod import for code shared by the edge functions (Deno, npm: specifier) and the browser
// (Vite/Vitest alias "npm:zod@3.25.76" → "zod"; TS sees it through src/vite-env.d.ts).
export { z } from "npm:zod@3.25.76";
export type { ZodType, infer as Infer } from "npm:zod@3.25.76";
