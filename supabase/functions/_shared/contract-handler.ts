// Serve a V1 contract: { action, ...input } → zod-validated input → implementation → zod-validated output.
// Actions without an implementation answer 501 NOT_IMPLEMENTED (Phase 1 stubs for the parallel tracks).
import type { User } from "npm:@supabase/supabase-js@2";
import { HttpError, handle, json, requireUser } from "./b2b-http.ts";
import type { Contract } from "./contracts/common.ts";
import type { z } from "./contracts/zod.ts";

export interface Ctx { req: Request; user: User }

export type Impl<C extends Contract> = {
  [A in keyof C]?: (input: z.output<C[A]["input"]>, ctx: Ctx) => Promise<z.input<C[A]["output"]>>;
};

export function serveContract<C extends Contract>(
  name: string, contract: C, impl: Impl<C>,
  opts: { allowAnonymous?: (action: string) => boolean; publicActions?: string[] } = {},
): (req: Request) => Promise<Response> {
  return handle(name, async (req, body) => {
    const action = typeof body.action === "string" ? body.action : "";
    const def = contract[action];
    if (!def) throw new HttpError(400, "BAD_REQUEST", `Unknown action "${action}"`);
    const { action: _a, ...raw } = body;
    const parsed = def.input.safeParse(raw);
    if (!parsed.success) {
      return json({ error: "Invalid input", code: "BAD_REQUEST", details: parsed.error.issues.slice(0, 20) }, 400);
    }
    const fn = impl[action as keyof C];
    // Public actions (token links) run without a session; everything else needs one.
    const user = opts.publicActions?.includes(action)
      ? (null as unknown as User)
      : await requireUser(req, { allowAnonymous: opts.allowAnonymous?.(action) ?? false });
    if (!fn) throw new HttpError(501, "NOT_IMPLEMENTED", `${name}.${action} is not implemented yet`);
    const out = await fn(parsed.data, { req, user });
    const checked = def.output.safeParse(out);
    if (!checked.success) {
      console.error(`[${name}] ${action} returned output that breaks its contract:`, JSON.stringify(checked.error.issues.slice(0, 5)));
      throw new HttpError(500, "CONTRACT_VIOLATION", "Something went wrong. Please try again.");
    }
    return json(checked.data);
  });
}
