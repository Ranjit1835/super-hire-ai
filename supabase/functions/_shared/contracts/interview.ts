// Interview V1 additions to the pilot's b2b-interview function (track C). Stubbed in Phase 1.
// The pilot actions (current / start / resume / answer / end) are unchanged; these add drive and
// job-role contexts and the code walkthrough.
import { z } from "./zod.ts";
import { Uuid } from "./common.ts";

export const interviewContract = {
  /** Start (or resume) the interview step of a drive or job role, optionally walking through a coding attempt. */
  startContext: {
    input: z.object({ kind: z.enum(["drive", "job_role"]), contextId: Uuid, attemptId: Uuid.optional() }),
    output: z.object({ interviewId: Uuid, resumed: z.boolean() }),
  },
  /** Gemini Live spike: a short-lived token for a direct browser↔Gemini session (time-boxed experiment). */
  liveToken: {
    input: z.object({ interviewId: Uuid }),
    output: z.object({ token: z.string(), expiresAt: z.string(), model: z.string() }),
  },
} as const;
