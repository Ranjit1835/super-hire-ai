// Typed client for the V1 interview actions of b2b-interview (contract: supabase/functions/_shared/contracts/interview.ts).
import { client } from "../lib/api";
import { interviewContract } from "../../../supabase/functions/_shared/contracts/interview";

export { ApiError } from "../lib/api";
export const interviewV1Api = client("b2b-interview", interviewContract);
export type { RoomState } from "../../../supabase/functions/_shared/contracts/interview";
