// R3.5: super-admin screens need a login verified with an authenticator app (Supabase TOTP MFA, free on every
// project). The database enforces it too: is_super_admin() is false until the session is aal2, and B2B edge functions
// answer MFA_REQUIRED. This screen gets the admin there: enrol (QR code) the first time, verify a code after that.
// Non-admins pass straight through; the page behind decides what they may see.
import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { b2bDb } from "../lib/db";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Aal = { currentLevel: string | null; nextLevel: string | null };

export function MfaGate({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const admin = useQuery({
    queryKey: ["b2b", "admin-role", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await b2bDb.rpc("b2b_is_admin_role");
      if (error) throw error;
      return data === true;
    },
  });
  const aal = useQuery({
    queryKey: ["b2b", "aal", user?.id],
    enabled: !!user && admin.data === true,
    queryFn: async (): Promise<Aal> => {
      const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (error) throw error;
      return { currentLevel: data.currentLevel, nextLevel: data.nextLevel };
    },
  });

  if (!user || admin.isLoading || (admin.data && aal.isLoading)) return <Centered><p className="text-sm text-muted-foreground">Checking access…</p></Centered>;
  if (!admin.data) return <>{children}</>;
  if (aal.data?.currentLevel === "aal2") return <>{children}</>;
  return (
    <MfaScreen
      enrolled={aal.data?.nextLevel === "aal2"}
      onVerified={async () => { await qc.invalidateQueries(); }}
    />
  );
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="min-h-screen grid place-items-center p-6"><div className="w-full max-w-sm space-y-4">{children}</div></div>;
}

export function MfaScreen({ enrolled, onVerified }: { enrolled: boolean; onVerified: () => Promise<void> | void }) {
  const [factorId, setFactorId] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function startEnrol() {
    setBusy(true); setError(null);
    try {
      // An earlier, never-verified enrolment blocks a new one: clear it first.
      const { data: list } = await supabase.auth.mfa.listFactors();
      for (const f of list?.all ?? []) if (f.factor_type === "totp" && f.status !== "verified") await supabase.auth.mfa.unenroll({ factorId: f.id });
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "HiResume admin" });
      if (error) throw error;
      setFactorId(data.id); setQr(data.totp.qr_code); setSecret(data.totp.secret);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't start setup.");
    } finally { setBusy(false); }
  }

  async function verify() {
    setBusy(true); setError(null);
    try {
      let id = factorId;
      if (!id) {
        const { data: list, error } = await supabase.auth.mfa.listFactors();
        if (error) throw error;
        id = list?.totp?.[0]?.id ?? null;
        if (!id) throw new Error("No authenticator is set up yet.");
      }
      const { data: ch, error: chErr } = await supabase.auth.mfa.challenge({ factorId: id });
      if (chErr) throw chErr;
      const { error: vErr } = await supabase.auth.mfa.verify({ factorId: id, challengeId: ch.id, code: code.trim() });
      if (vErr) throw new Error("That code didn't work. Check the time on your phone and try the newest code.");
      await onVerified();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't verify the code.");
    } finally { setBusy(false); }
  }

  const needsSetup = !enrolled && !factorId;
  return (
    <Centered>
      <h1 className="text-xl font-semibold">Two-factor sign-in</h1>
      {needsSetup ? (
        <>
          <p className="text-sm text-muted-foreground">Admin access needs an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…). Set it up once; after that you enter a 6-digit code when you sign in.</p>
          <Button onClick={() => void startEnrol()} disabled={busy}>Set up authenticator</Button>
        </>
      ) : (
        <>
          {qr && (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Scan this with your authenticator app, then enter the code it shows.</p>
              <img src={qr} alt="QR code for your authenticator app" className="w-44 h-44 bg-white p-2" />
              {secret && <p className="text-xs text-muted-foreground break-all">Can't scan? Enter this key: <code>{secret}</code></p>}
            </div>
          )}
          {!qr && <p className="text-sm text-muted-foreground">Enter the 6-digit code from your authenticator app.</p>}
          <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); void verify(); }}>
            <Label htmlFor="mfa-code">Code</Label>
            <Input id="mfa-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code}
                   onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
            <Button type="submit" disabled={busy || code.length !== 6}>Verify</Button>
          </form>
        </>
      )}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </Centered>
  );
}
