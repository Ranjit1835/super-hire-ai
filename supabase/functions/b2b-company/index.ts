// b2b-company — company admin, recruiters, hiring managers (contract: _shared/contracts/company.ts; logic: ./handlers.ts).
// Every action re-authorises in SQL (supabase/migrations/20261021000010_b2b_v1_startup.sql); this layer validates input, makes tokens,
// calls the AI gateway and sends email.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { HttpError, appBaseUrl, randomToken, serviceClient, sha256Hex } from "../_shared/b2b-http.ts";
import { serveContract, type Ctx } from "../_shared/contract-handler.ts";
import { companyContract } from "../_shared/contracts/company.ts";
import { ai } from "../_shared/ai-gateway/index.ts";
import { emailConfigured, sendMail } from "../_shared/mailer.ts";
import { CompanyError, makeHandlers } from "./handlers.ts";

const db = serviceClient();
const h = makeHandlers({
  rpc: async (fn, args) => {
    const { data, error } = await db.rpc(fn, args);
    if (error) throw new Error(`${fn}: ${error.message}`);
    return data;
  },
  ai: (req) => ai(req, db),
  sendMail,
  emailConfigured,
  baseUrl: appBaseUrl,
  randomToken,
  sha256: sha256Hex,
});

function wrap<I, O>(fn: (input: I, actor: string) => Promise<O>) {
  return async (input: I, ctx: Ctx): Promise<O> => {
    try {
      return await fn(input, ctx.user.id);
    } catch (e) {
      if (e instanceof CompanyError) throw new HttpError(e.status, e.code, e.message);
      throw e;
    }
  };
}

serve(serveContract("B2B-COMPANY", companyContract, {
  skillsFromJd: wrap(h.skillsFromJd),
  inviteCandidates: wrap(h.inviteCandidates),
  resendInvite: wrap(h.resendInvite),
  pipeline: wrap(h.pipeline),
  exportPipeline: wrap(h.exportPipeline),
  decide: wrap(h.decide),
  report: wrap(h.report),
  createShareLink: wrap(h.createShareLink),
  revokeShareLink: wrap(h.revokeShareLink),
  inviteStaff: wrap(h.inviteStaff),
}));
