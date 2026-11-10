// DPDP consent (owner decisions 2026-11-09): every B2C account confirms it is 18 or older and agrees to the current
// privacy notice, by a clear action, recorded with the version and exact text (user_consents). New accounts tick this
// on the sign-up form; Google sign-ups and accounts made before the notice see this prompt once. College and company
// members consent through their organisation's invite instead, and are skipped here.
import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { b2bDb } from "@/features/b2b/lib/db";
import { useIsSuperAdmin, useMyMemberships } from "@/features/b2b/hooks/useB2B";
import { MIN_AGE, PRIVACY_NOTICE_VERSION } from "@/lib/privacy";
import { usePendingStaffInvites } from "@/b2b/access/PendingInvites";

export const CONSENT_TEXT = {
  age_18_plus: `I confirm I am ${MIN_AGE} years of age or older.`,
  privacy_notice: `I have read the HiResume privacy notice (version ${PRIVACY_NOTICE_VERSION}) and agree to my personal data being used as it describes.`,
} as const;

/** Set by the sign-up form once both boxes are ticked, so the first session records them without asking again. */
export const PENDING_CONSENT_KEY = "hr-consent-pending";

const SKIP = [/^\/privacy/, /^\/auth/, /^\/verify-otp/, /^\/reset-password/, /^\/invite\//];

export async function recordConsent(userId: string) {
  const rows = (Object.keys(CONSENT_TEXT) as (keyof typeof CONSENT_TEXT)[]).map((purpose) => ({
    user_id: userId, purpose, notice_version: PRIVACY_NOTICE_VERSION, consent_text: CONSENT_TEXT[purpose],
  }));
  const { error } = await b2bDb.from("user_consents").upsert(rows, { onConflict: "user_id,purpose,notice_version", ignoreDuplicates: true });
  if (error) throw error;
}

export function ConsentGate() {
  const { user, signOut } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const memberships = useMyMemberships();
  const isSuper = useIsSuperAdmin();
  // Invited staff accept their invite first (PendingInvites); after that they're org members and skip this prompt.
  const invited = (usePendingStaffInvites().data?.length ?? 0) > 0;
  const b2b = (memberships.data?.length ?? 0) > 0 || isSuper.data === true || invited;
  const consent = useQuery({
    queryKey: ["privacy-consent", user?.id, PRIVACY_NOTICE_VERSION],
    enabled: !!user && !memberships.isLoading && !isSuper.isLoading && !b2b,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await b2bDb.from("user_consents").select("purpose")
        .eq("user_id", user!.id).eq("notice_version", PRIVACY_NOTICE_VERSION);
      if (error) throw error;
      return new Set((data as { purpose: string }[]).map((r) => r.purpose));
    },
  });
  const missing = !!consent.data && !(consent.data.has("age_18_plus") && consent.data.has("privacy_notice"));
  const [adult, setAdult] = useState(false);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!user) return;
    setBusy(true); setError(null);
    try {
      await recordConsent(user.id);
      try { localStorage.removeItem(PENDING_CONSENT_KEY); } catch { /* storage blocked */ }
      await qc.invalidateQueries({ queryKey: ["privacy-consent", user.id] });
    } catch {
      setError("Couldn't save that. Please try again.");
    } finally { setBusy(false); }
  };

  // Ticked on the sign-up form: record it silently on the first session.
  useEffect(() => {
    if (!missing || !user) return;
    let pending: string | null = null;
    try { pending = localStorage.getItem(PENDING_CONSENT_KEY); } catch { /* storage blocked */ }
    if (pending === PRIVACY_NOTICE_VERSION) void save();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missing, user?.id]);

  if (!user || !missing || SKIP.some((re) => re.test(pathname))) return null;
  return (
    <Dialog open>
      <DialogContent className="max-w-md [&>button]:hidden" onInteractOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Before you continue</DialogTitle>
          <DialogDescription>
            HiResume accounts are for people aged {MIN_AGE} or over. Please read our{" "}
            <Link to="/privacy" className="text-primary hover:underline">privacy notice</Link>{" "}
            and confirm both of these.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <label className="flex gap-2.5 items-start cursor-pointer">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-violet-500" checked={adult} onChange={(e) => setAdult(e.target.checked)} />
            <span>{CONSENT_TEXT.age_18_plus}</span>
          </label>
          <label className="flex gap-2.5 items-start cursor-pointer">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-violet-500" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
            <span>I have read the <Link to="/privacy" className="text-primary hover:underline">privacy notice</Link> and agree to my personal data being used as it describes.</span>
          </label>
          {error && <p role="alert" className="text-destructive">{error}</p>}
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="ghost" onClick={async () => { await signOut(); navigate("/", { replace: true }); }}>Sign out</Button>
          <Button onClick={() => void save()} disabled={!adult || !agree || busy}>{busy ? "Saving…" : "Continue"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
