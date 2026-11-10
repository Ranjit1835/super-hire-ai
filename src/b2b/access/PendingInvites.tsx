// Staff invites after sign-in (owner, 2026-11-10): a TPO, trainer, recruiter or company admin who was invited sees the
// invite as soon as they sign in with that (verified) email, and accepts it here. No emailed link needed, so this
// works while email isn't set up. Student invites keep using their link, which shows the consent first.
// SQL: b2b_my_staff_invites / b2b_accept_my_invite (20261110000006_b2b_staff_invites_in_app.sql).
import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { B2B_ENABLED } from "@/lib/config";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { b2bDb } from "@/features/b2b/lib/db";

export interface StaffInvite { id: string; role: string; expires_at: string; org: { id: string; name: string; type: string } }

const ROLE: Record<string, string> = {
  org_admin: "admin", trainer: "trainer", recruiter: "recruiter", hiring_manager: "hiring manager",
};
const roleText = (i: StaffInvite) => i.role === "org_admin" ? (i.org.type === "company" ? "company admin" : "TPO admin") : ROLE[i.role] ?? i.role;

const SKIP = [/^\/invite\//, /^\/auth/, /^\/verify-otp/, /^\/reset-password/];

export function usePendingStaffInvites() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["b2b-staff-invites", user?.id],
    enabled: B2B_ENABLED && !!user,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await b2bDb.rpc("b2b_my_staff_invites");
      if (error) throw error;
      return (data ?? []) as StaffInvite[];
    },
  });
}

export function PendingInvites() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const invites = usePendingStaffInvites();
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const list = invites.data ?? [];
  if (dismissed || !list.length || SKIP.some((re) => re.test(pathname))) return null;

  const accept = async (inv: StaffInvite) => {
    setBusy(inv.id); setError(null);
    try {
      const { data, error } = await b2bDb.rpc("b2b_accept_my_invite", { _invite_id: inv.id });
      if (error) throw error;
      const r = data as { ok: boolean; reason?: string };
      if (!r.ok) throw new Error(r.reason === "EXPIRED" ? "This invite has expired. Ask HiResume for a new one."
        : r.reason === "STUDENT_ACCOUNT" ? "This account is a student account, so it can't join as staff. Sign in with another email."
        : "Couldn't accept this invite. Ask HiResume to send a new one.");
      await qc.invalidateQueries({ queryKey: ["b2b"] });
      await qc.invalidateQueries({ queryKey: ["b2b-staff-invites"] });
      await qc.invalidateQueries({ queryKey: ["b2b-access"] });
      navigate(inv.org.type === "company" ? `/co/${inv.org.id}/roles` : `/c/${inv.org.id}/students`);
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(null); }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) setDismissed(true); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{list.length === 1 ? "You've been invited" : `You have ${list.length} invites`}</DialogTitle>
          <DialogDescription>Accept to open the portal. You can also accept later from the same account.</DialogDescription>
        </DialogHeader>
        <ul className="space-y-3">
          {list.map((i) => (
            <li key={i.id} className="flex items-center justify-between gap-3 rounded-lg border border-border/60 p-3">
              <div className="min-w-0">
                <p className="font-medium text-foreground truncate">{i.org.name}</p>
                <p className="text-xs text-muted-foreground">as {roleText(i)} · expires {new Date(i.expires_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</p>
              </div>
              <Button size="sm" disabled={busy !== null} onClick={() => void accept(i)}>{busy === i.id ? "Accepting…" : "Accept"}</Button>
            </li>
          ))}
        </ul>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter><Button variant="ghost" onClick={() => setDismissed(true)}>Not now</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
