// First sign-in for staff accounts made at invite time (owner, 2026-11-11): the account carries
// app_metadata.must_change_password, so before anything else the person sets their own password. The account-password
// edge function saves it and clears the flag; the session is then refreshed so the flag is gone from the token too.
import { useState } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { passwordProblems } from "../../supabase/functions/_shared/staff-account";

const SKIP = [/^\/auth/, /^\/reset-password/, /^\/verify-otp/];

export function mustChangePassword(user: { app_metadata?: Record<string, unknown> } | null | undefined): boolean {
  return user?.app_metadata?.must_change_password === true;
}

export function PasswordChangeGate() {
  const { user, signOut } = useAuth();
  const { pathname } = useLocation();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  if (done || !mustChangePassword(user) || SKIP.some((re) => re.test(pathname))) return null;

  const problems = passwordProblems(password);
  const save = async () => {
    setBusy(true); setError(null);
    try {
      const { data, error } = await supabase.functions.invoke("account-password", { body: { password } });
      if (error) {
        const body = await (error as { context?: Response }).context?.json?.().catch(() => null);
        throw new Error(body?.error ?? "Couldn't save the password. Please try again.");
      }
      if (!(data as { ok?: boolean })?.ok) throw new Error("Couldn't save the password. Please try again.");
      await supabase.auth.refreshSession();   // new token without the flag
      setDone(true);
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(false); }
  };

  return (
    <Dialog open>
      <DialogContent className="max-w-md [&>button]:hidden" onInteractOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Set your password</DialogTitle>
          <DialogDescription>
            You signed in with a temporary password. Choose your own to continue; the temporary one stops working.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label htmlFor="new-pw" className="text-sm">New password</label>
            <Input id="new-pw" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            {password && problems.length > 0 && <p className="text-xs text-muted-foreground mt-1">Needs: {problems.join(", ")}</p>}
          </div>
          <div>
            <label htmlFor="confirm-pw" className="text-sm">Confirm new password</label>
            <Input id="confirm-pw" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            {confirm && confirm !== password && <p className="text-xs text-destructive mt-1">Passwords don't match</p>}
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="ghost" onClick={() => void signOut()}>Sign out</Button>
          <Button onClick={() => void save()} disabled={busy || problems.length > 0 || confirm !== password}>
            {busy ? "Saving…" : "Save password"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
