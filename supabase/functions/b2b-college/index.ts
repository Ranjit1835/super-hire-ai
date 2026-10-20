// b2b-college — TPO admin and trainers (contract: _shared/contracts/college.ts). Track D implements.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { serveContract } from "../_shared/contract-handler.ts";
import { collegeContract } from "../_shared/contracts/college.ts";

serve(serveContract("B2B-COLLEGE", collegeContract, {}));
