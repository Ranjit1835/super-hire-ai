// b2b-assess — question bank and test runner (contract: _shared/contracts/assess.ts). Track A implements.
// Runner actions accept anonymous sessions (candidates); the implementation checks the subject owns the attempt.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { serveContract } from "../_shared/contract-handler.ts";
import { assessContract } from "../_shared/contracts/assess.ts";

const RUNNER = new Set(["start", "state", "autosave", "run", "submitQuestion", "finish", "heartbeat"]);
serve(serveContract("B2B-ASSESS", assessContract, {}, { allowAnonymous: (a) => RUNNER.has(a) }));
