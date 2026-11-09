// b2b-candidate — candidate token flow and share links (contract: _shared/contracts/company.ts; logic: ./handlers.ts).
// resolveInvite / viewShare are public (the token is the credential); the rest run on the candidate's
// anonymous Supabase session, which the first startCandidate links to the invite.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { HttpError, appBaseUrl, serviceClient, sha256Hex } from "../_shared/b2b-http.ts";
import { serveContract, type Ctx } from "../_shared/contract-handler.ts";
import { candidateContract } from "../_shared/contracts/company.ts";
import { emailConfigured, sendMail } from "../_shared/mailer.ts";
import { CandidateError, makeHandlers } from "./handlers.ts";

const db = serviceClient();
const h = makeHandlers({
  rpc: async (fn, args) => {
    const { data, error } = await db.rpc(fn, args);
    if (error) throw new Error(`${fn}: ${error.message}`);
    return data;
  },
  sha256: sha256Hex,
  sendMail,
  emailConfigured,
  baseUrl: appBaseUrl,
});

function wrap<I, O>(fn: (input: I, user: string) => Promise<O>) {
  return async (input: I, ctx: Ctx): Promise<O> => {
    try {
      return await fn(input, ctx.user?.id ?? "");
    } catch (e) {
      if (e instanceof CandidateError) throw new HttpError(e.status, e.code, e.message);
      throw e;
    }
  };
}

serve(serveContract("B2B-CANDIDATE", candidateContract, {
  resolveInvite: wrap((i: { token: string }) => h.resolveInvite(i)),
  startCandidate: wrap(h.startCandidate),
  state: wrap(h.state),
  recordConsent: wrap(h.recordConsent),
  markSystemCheck: wrap(h.markSystemCheck),
  viewShare: wrap((i: { token: string }) => h.viewShare(i)),
}, {
  publicActions: ["resolveInvite", "viewShare"],
  allowAnonymous: () => true,
}));
