// Proctoring V1: the interface other areas build against. Track B replaces the implementation behind it
// (system check, consent, entire-screen share, snapshots, browser/camera/audio signals, policies).
// Until then ProctoredSession renders its children straight away and signals are no-ops.
import { createContext, useContext, type ReactNode } from "react";
import type { z } from "zod";
import type { EventType, Severity } from "../../../supabase/functions/_shared/contracts/proctor";
import type { ProctoringPolicyV1 } from "../types";

export interface ProctorSignal {
  type: z.infer<typeof EventType>;
  severity: z.infer<typeof Severity>;
  meta?: Record<string, unknown>;
}

export interface ProctorApi {
  /** Report an event the host screen detected (e.g. a blocked paste in the code editor). */
  report: (s: ProctorSignal) => void;
  /** Proctoring session id once started (null while starting, or when the policy is "off"). */
  sessionId: string | null;
  /** True while a Maximum-policy pause is active: the host must block input and show nothing secret. */
  paused: boolean;
}

const noop: ProctorApi = { report: () => {}, sessionId: null, paused: false };
const Ctx = createContext<ProctorApi>(noop);

/** Inside a proctored screen: how the host reports signals and learns about pauses. */
export function useProctor(): ProctorApi {
  return useContext(Ctx);
}

export interface ProctoredSessionProps {
  /** Exactly one of attemptId / interviewId: what is being proctored. */
  attemptId?: string;
  interviewId?: string;
  policy: ProctoringPolicyV1;
  /** Coding tests listen for speech; interviews don't (the candidate is meant to talk). */
  kind: "assessment" | "interview";
  /** Called once system check, consent and screen share are done and monitoring has started. */
  onReady?: (sessionId: string | null) => void;
  /** Strict policy hit its violation limit: the host must submit now. */
  onAutoSubmit?: () => void;
  children: ReactNode;
}

/**
 * Wraps a proctored screen. Track B: shows system check → consent → identity/screen share before children,
 * monitors while they render, and ends the session (computing the integrity score) on unmount.
 */
export function ProctoredSession({ children }: ProctoredSessionProps) {
  return <Ctx.Provider value={noop}>{children}</Ctx.Provider>;
}
