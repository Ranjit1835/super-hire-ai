// b2b-company — company admin, recruiters, hiring managers (contract: _shared/contracts/company.ts). Track E implements.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { serveContract } from "../_shared/contract-handler.ts";
import { companyContract } from "../_shared/contracts/company.ts";

serve(serveContract("B2B-COMPANY", companyContract, {}));
