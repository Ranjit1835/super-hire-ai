import type { OrgInvite } from "../types";

export type InviteDisplayStatus = "pending" | "accepted" | "revoked" | "expired";

export function displayStatus(i: Pick<OrgInvite, "status" | "expires_at">, now = new Date()): InviteDisplayStatus {
  if (i.status === "pending" && new Date(i.expires_at) <= now) return "expired";
  return i.status;
}

/** Mirrors the server rule in b2b-invites (and the B2C sign-up form). */
export function passwordProblems(pw: string): string[] {
  const p: string[] = [];
  if (pw.length < 8) p.push("at least 8 characters");
  if (!/[A-Z]/.test(pw)) p.push("1 uppercase letter");
  if (!/[0-9]/.test(pw)) p.push("1 number");
  return p;
}
