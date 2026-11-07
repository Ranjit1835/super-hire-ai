// R1.6 student sessions in the browser (server side: b2b_session_touch, migration 0021, and every B2B edge call).
// One heartbeat at most a minute, on mount and on activity, so a student who is actually working never idles out.
// When the server says the session ended (another device, idle, expired) the student is signed out with the reason.
// When the server sees a new login, the student's other devices lose their refresh tokens (signOut scope "others").
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { b2bDb } from "@/features/b2b/lib/db";
import { SESSION_ENDED_EVENT } from "@/features/b2b/lib/api";
import { toast } from "@/hooks/use-toast";

export const HEARTBEAT_MIN_GAP_MS = 60_000;

const ENDED: Record<string, string> = {
  REPLACED: "You signed in on another device, so you were signed out here.",
  IDLE: "You were inactive for a while, so you were signed out.",
  EXPIRED: "Your session expired. Please sign in again.",
  LOGOUT: "You signed out.",
  NO_SESSION: "Please sign in again.",
};

let lastBeat = 0;
let inFlight: Promise<void> | null = null;
let ending = false;

/** Sign out locally and go to the sign-in page with the reason. */
export async function endSession(message: string) {
  if (ending) return;
  ending = true;
  try {
    await supabase.auth.signOut({ scope: "local" });
  } finally {
    toast({ title: "Signed out", description: message });
    window.location.assign("/auth");
  }
}

/** One heartbeat (throttled). Exported for tests. */
export function heartbeat(force = false): Promise<void> {
  const now = Date.now();
  if (inFlight) return inFlight;
  if (!force && now - lastBeat < HEARTBEAT_MIN_GAP_MS) return Promise.resolve();
  lastBeat = now;
  inFlight = (async () => {
    try {
      const res = await b2bDb.rpc("b2b_session_heartbeat");
      const data = res?.data;
      if (res?.error || !data) return;           // offline or not signed in: the server still enforces on each call
      const r = data as { ok: boolean; student?: boolean; started?: boolean; reason?: string };
      if (!r.student) return;
      if (r.ok === false) { await endSession(ENDED[r.reason ?? ""] ?? ENDED.NO_SESSION); return; }
      if (r.started) await supabase.auth.signOut({ scope: "others" });   // new login: other devices lose their refresh tokens
    } catch {
      // A failed heartbeat never blocks the page; every B2B server call checks the session anyway.
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/** Logout: end this login's session on the server too (best effort; the token is revoked by signOut anyway). */
export async function endServerSession() {
  try { await b2bDb.rpc("b2b_session_end"); } catch { /* signing out still works */ }
}

/** Test hook: reset the module state between tests. */
export function __resetSessionForTests() { lastBeat = 0; inFlight = null; ending = false; }

export function useStudentSession() {
  useEffect(() => {
    if (import.meta.env.VITE_B2B_GALLERY === "true") return;   // design gallery: no backend
    void heartbeat(true);
    const onActivity = () => { void heartbeat(); };
    const onVisible = () => { if (document.visibilityState === "visible") void heartbeat(); };
    const onEnded = (e: Event) => { void endSession(String((e as CustomEvent).detail ?? ENDED.NO_SESSION)); };
    window.addEventListener("pointerdown", onActivity, { passive: true });
    window.addEventListener("keydown", onActivity);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener(SESSION_ENDED_EVENT, onEnded);
    return () => {
      window.removeEventListener("pointerdown", onActivity);
      window.removeEventListener("keydown", onActivity);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener(SESSION_ENDED_EVENT, onEnded);
    };
  }, []);
}
