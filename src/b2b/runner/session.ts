// The tab's single-session token per attempt. sessionStorage is per tab, so a refresh keeps it
// (and resumes) while a second tab has none (and is refused while this one is alive).
const key = (attemptId: string) => `hr-assess-session-${attemptId}`;
export const queueKey = (attemptId: string) => `hr-assess-queue-${attemptId}`;

export function getSessionId(attemptId: string): string | undefined {
  try { return sessionStorage.getItem(key(attemptId)) ?? undefined; } catch { return undefined; }
}

export function setSessionId(attemptId: string, sessionId: string): void {
  try { sessionStorage.setItem(key(attemptId), sessionId); } catch { /* storage blocked */ }
}

export function clearAttemptStorage(attemptId: string): void {
  try { sessionStorage.removeItem(key(attemptId)); localStorage.removeItem(queueKey(attemptId)); } catch { /* storage blocked */ }
}

export function safeLocalStorage(): Storage | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}
