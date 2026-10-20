// b2b-proctor — proctoring V1 (contract: _shared/contracts/proctor.ts). Track B implements.
// Subject actions accept anonymous sessions (candidates); review actions are staff only.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { serveContract } from "../_shared/contract-handler.ts";
import { proctorContract } from "../_shared/contracts/proctor.ts";

const SUBJECT = new Set(["start", "events", "snapshotUploadUrl", "end"]);
serve(serveContract("B2B-PROCTOR", proctorContract, {}, { allowAnonymous: (a) => SUBJECT.has(a) }));
