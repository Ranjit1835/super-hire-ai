// Typed client for the V1 B2B edge functions. Inputs are validated against the shared contract before
// sending, outputs after receiving, so the browser and the functions can't silently drift apart.
import { ApiError, callB2B } from "@/features/b2b/lib/api";
import type { Contract, ContractInput, ContractOutput } from "../../../supabase/functions/_shared/contracts/common";
import { adminContract } from "../../../supabase/functions/_shared/contracts/admin";
import { collegeContract } from "../../../supabase/functions/_shared/contracts/college";
import { candidateContract, companyContract } from "../../../supabase/functions/_shared/contracts/company";
import { assessContract } from "../../../supabase/functions/_shared/contracts/assess";
import { proctorContract } from "../../../supabase/functions/_shared/contracts/proctor";

export { ApiError };

export interface CallOptions { auth?: boolean; timeoutMs?: number }

export function client<C extends Contract>(fn: string, contract: C) {
  return async function call<A extends keyof C & string>(
    action: A, input: ContractInput<C, A>, opts: CallOptions = {},
  ): Promise<ContractOutput<C, A>> {
    const parsed = contract[action].input.safeParse(input);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      throw new ApiError(400, "BAD_REQUEST", first ? `${first.path.join(".") || "input"}: ${first.message}` : "Invalid input");
    }
    const raw = await callB2B<unknown>(fn, { action, ...(parsed.data as Record<string, unknown>) }, opts);
    const out = contract[action].output.safeParse(raw);
    if (!out.success) throw new ApiError(500, "CONTRACT_VIOLATION", "Unexpected response from the server. Please try again.");
    return out.data as ContractOutput<C, A>;
  };
}

export const adminApi = client("b2b-admin", adminContract);
export const collegeApi = client("b2b-college", collegeContract);
export const companyApi = client("b2b-company", companyContract);
export const candidateApi = client("b2b-candidate", candidateContract);
export const assessApi = client("b2b-assess", assessContract);
export const proctorApi = client("b2b-proctor", proctorContract);
