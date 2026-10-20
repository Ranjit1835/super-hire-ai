// b2b-candidate — candidate token flow and share links (contract: _shared/contracts/company.ts). Track E implements.
// resolveInvite / viewShare are public (the token is the credential); the rest run on the candidate's
// anonymous Supabase session.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { serveContract } from "../_shared/contract-handler.ts";
import { candidateContract } from "../_shared/contracts/company.ts";

serve(serveContract("B2B-CANDIDATE", candidateContract, {}, {
  publicActions: ["resolveInvite", "viewShare"],
  allowAnonymous: () => true,
}));
