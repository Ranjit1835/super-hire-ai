// Staff accounts made at invite time (owner, 2026-11-11): when the super admin invites a TPO, trainer, recruiter or
// company admin whose email has no HiResume account, the account is created with a temporary password, the invite is
// accepted for it, and the email carries the username and temporary password. The account is flagged
// must_change_password in app_metadata (which users can't edit), so the first sign-in asks for a new password
// (account-password edge function clears the flag). An email that already has an account is left alone: its owner
// keeps their password and accepts the invite in the app or from the link. No Deno or browser APIs beyond crypto.

/** The sign-up rules (src/pages/Auth.tsx): at least 8 characters, one uppercase letter, one number. */
export function passwordProblems(p: string): string[] {
  const out: string[] = [];
  if (p.length < 8) out.push("At least 8 characters");
  if (!/[A-Z]/.test(p)) out.push("At least 1 uppercase letter");
  if (!/[0-9]/.test(p)) out.push("At least 1 number");
  if (p.length > 72) out.push("At most 72 characters");
  return out;
}

// No look-alikes (0/O, 1/l/I) so it can be typed from an email or read out.
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ", LOWER = "abcdefghijkmnpqrstuvwxyz", DIGIT = "23456789", SYMBOL = "@#$%&*";

/** 14 random characters with at least one of each kind, so it always passes passwordProblems. */
export function temporaryPassword(random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  const all = UPPER + LOWER + DIGIT + SYMBOL;
  const bytes = random(32);
  const pick = (set: string, i: number) => set[bytes[i] % set.length];
  const chars = [pick(UPPER, 0), pick(LOWER, 1), pick(DIGIT, 2), pick(SYMBOL, 3)];
  for (let i = 4; i < 14; i++) chars.push(pick(all, i));
  for (let i = chars.length - 1; i > 0; i--) {          // shuffle, so the kinds aren't in fixed places
    const j = bytes[14 + i] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

/** The parts of the Supabase service client this needs (kept narrow so tests can fake it). */
export interface StaffAccountClient {
  auth: { admin: { createUser(a: {
    email: string; password: string; email_confirm: boolean;
    user_metadata: Record<string, unknown>; app_metadata: Record<string, unknown>;
  }): Promise<{ data: { user: { id: string } | null } | null; error: { message: string; code?: string; status?: number } | null }> } };
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

export interface StaffAccount { created: boolean; userId: string | null; tempPassword: string | null }

const EXISTS = /already (been )?registered|already exists|email_exists/i;

/**
 * Create the invited person's account if their email has none, and accept the invite (tokenHash) for it.
 * Returns created: false when the email already has an account (nothing changed).
 */
export async function provisionStaffAccount(admin: StaffAccountClient, o: { email: string; fullName?: string | null; tokenHash: string },
  makePassword: () => string = () => temporaryPassword()): Promise<StaffAccount> {
  const password = makePassword();
  const { data, error } = await admin.auth.admin.createUser({
    email: o.email, password, email_confirm: true,
    user_metadata: { display_name: o.fullName || o.email.split("@")[0] },
    app_metadata: { must_change_password: true },
  });
  if (error) {
    if (EXISTS.test(`${error.code ?? ""} ${error.message}`)) return { created: false, userId: null, tempPassword: null };
    throw new Error(`createUser: ${error.message}`);
  }
  const userId = data?.user?.id ?? null;
  if (!userId) throw new Error("createUser returned no user");
  const r = await admin.rpc("b2b_accept_invite", { _token_hash: o.tokenHash, _user_id: userId, _consent_version: null, _consent_text: null });
  const ok = !r.error && (r.data as { ok?: boolean } | null)?.ok === true;
  // Not accepted (e.g. the org was deactivated meanwhile): the account still exists and the invite stays pending.
  if (!ok) console.error("[staff-account] invite not accepted:", r.error?.message ?? JSON.stringify(r.data));
  return { created: true, userId, tempPassword: password };
}
