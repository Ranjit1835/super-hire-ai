import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import { CenteredSpinner } from "../components/B2BShell";
import { passwordProblems } from "../lib/status";
import { ApiError, invitesApi, rememberPendingInvite, takePendingInvite, type InvitePreview } from "../lib/api";

const PASSWORD_HINT = "8+ characters, 1 uppercase letter, 1 number";

const DEAD_LINK: Record<string, { title: string; body: string }> = {
  expired: { title: "This invite link has expired", body: "Ask your placement office to send you a new link." },
  revoked: { title: "This invite was withdrawn", body: "Contact your placement office if you think this is a mistake." },
  accepted: { title: "This invite has already been used", body: "If you joined already, sign in to continue." },
};

/** /invite/:token — public. Create an account (or sign in) and join the institution. */
export default function InviteAccept() {
  const { token = "" } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user, loading: authLoading, signIn, signOut, signInWithGoogle } = useAuth();

  const preview = useQuery({
    queryKey: ["b2b", "invite-preview", token],
    queryFn: () => invitesApi.preview(token),
    retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2,
    staleTime: 60_000,
  });

  const [consent, setConsent] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joined, setJoined] = useState(false);

  // Keep the invite across OAuth / email confirmation redirects.
  useEffect(() => { if (token) rememberPendingInvite(token); }, [token]);

  const finish = async () => {
    setJoined(true);
    await qc.invalidateQueries({ queryKey: ["b2b"] });
    takePendingInvite();
    setTimeout(() => navigate("/learn", { replace: true }), 1200);
  };

  const acceptSignedIn = async () => {
    setBusy(true);
    setError(null);
    try {
      await invitesApi.accept(token);
      await finish();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const register = async (p: InvitePreview) => {
    setBusy(true);
    setError(null);
    try {
      await invitesApi.register(token, password);
      const { error: signInErr } = await signIn(p.email, password);
      if (signInErr) throw new Error(`Your account was created, but signing in failed: ${signInErr}`);
      await finish();
    } catch (e) {
      if (e instanceof ApiError && e.code === "ACCOUNT_EXISTS") {
        qc.setQueryData(["b2b", "invite-preview", token], { ...p, has_account: true });
      }
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (preview.isLoading || authLoading) return <CenteredSpinner />;

  if (preview.error || !preview.data) {
    const notFound = preview.error instanceof ApiError && preview.error.status === 404;
    return (
      <Frame>
        <h1 className="text-xl font-semibold">{notFound ? "This invite link isn't valid" : "Couldn't open this invite"}</h1>
        <p className="text-sm text-muted-foreground mt-2">
          {notFound ? "Check that you opened the full link, or ask your placement office for a new one." : (preview.error as Error)?.message}
        </p>
      </Frame>
    );
  }

  const p = preview.data;
  const dead = DEAD_LINK[p.status];
  const pwProblems = passwordProblems(password);
  const canRegister = consent && pwProblems.length === 0 && password === confirm && !busy;

  return (
    <Frame org={p.org}>
      {joined ? (
        <div className="text-center py-6" role="status">
          <CheckCircle2 className="h-10 w-10 text-emerald-400 mx-auto mb-3" />
          <h1 className="text-xl font-semibold">You're in!</h1>
          <p className="text-sm text-muted-foreground mt-1">Taking you to your interview practice…</p>
        </div>
      ) : dead ? (
        <>
          <h1 className="text-xl font-semibold">{dead.title}</h1>
          <p className="text-sm text-muted-foreground mt-2">{dead.body}</p>
          {p.status === "accepted" && <Button className="mt-4" asChild><Link to="/learn">Continue</Link></Button>}
        </>
      ) : (
        <>
          <h1 className="text-xl font-semibold">Hi {p.full_name.split(" ")[0]}, join {p.org.name}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            AI voice mock interviews set up by your institution{p.batch ? ` for ${p.batch}` : ""}.
          </p>
          <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1 text-sm mt-4 rounded-lg bg-white/5 p-3">
            <dt className="text-muted-foreground">Name</dt><dd>{p.full_name}</dd>
            <dt className="text-muted-foreground">Roll no</dt><dd className="tabular-nums">{p.roll_no}</dd>
            <dt className="text-muted-foreground">Email</dt><dd className="break-all">{p.email}</dd>
          </dl>

          <div className="flex items-start gap-2 mt-5">
            <Checkbox id="consent" checked={consent} onCheckedChange={(v) => setConsent(v === true)} className="mt-0.5" />
            <Label htmlFor="consent" className="text-sm font-normal leading-snug">{p.consent.text}</Label>
          </div>

          {error && <p className="text-sm text-red-300 mt-4" role="alert">{error}</p>}

          {user ? (
            <div className="mt-5 space-y-3">
              <p className="text-sm text-muted-foreground">
                Signed in as <strong className="text-foreground">{user.email}</strong>
                {user.email?.toLowerCase() !== p.email && " (different from the invited email — that's fine)"}.
              </p>
              <Button className="w-full" onClick={acceptSignedIn} disabled={!consent || busy}>
                {busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Join {p.org.name}
              </Button>
              <button className="text-xs text-muted-foreground hover:text-foreground underline" onClick={() => signOut()}>
                Not you? Sign out
              </button>
            </div>
          ) : p.has_account ? (
            <div className="mt-5 space-y-2">
              <p className="text-sm text-muted-foreground">You already have a HiResume account for {p.email}. Sign in to join.</p>
              <Button className="w-full" asChild>
                <Link to={`/auth?redirect=${encodeURIComponent(`/invite/${token}`)}`}>Sign in to join</Link>
              </Button>
            </div>
          ) : (
            <form
              className="mt-5 space-y-3"
              onSubmit={(e) => { e.preventDefault(); if (canRegister) register(p); }}
            >
              <div>
                <Label htmlFor="pw">Create a password</Label>
                <Input id="pw" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} aria-describedby="pw-hint" />
                <p id="pw-hint" className={`text-xs mt-1 ${password && pwProblems.length ? "text-amber-300" : "text-muted-foreground"}`}>
                  {password && pwProblems.length ? `Needs ${pwProblems.join(", ")}` : PASSWORD_HINT}
                </p>
              </div>
              <div>
                <Label htmlFor="pw2">Confirm password</Label>
                <Input id="pw2" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
                {confirm && confirm !== password && <p className="text-xs text-amber-300 mt-1">Passwords don't match</p>}
              </div>
              <Button type="submit" className="w-full" disabled={!canRegister}>
                {busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Create account & join
              </Button>
              <div className="relative text-center text-xs text-muted-foreground my-2"><span className="bg-card px-2">or</span></div>
              <Button type="button" variant="outline" className="w-full" onClick={() => signInWithGoogle()}>
                Continue with Google
              </Button>
            </form>
          )}
        </>
      )}
    </Frame>
  );
}

function Frame({ org, children }: { org?: InvitePreview["org"]; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md rounded-xl border border-border/60 bg-card p-6 shadow-xl">
        <div className="flex items-center gap-2 mb-5">
          {org?.logo_url ? (
            <img src={org.logo_url} alt="" className="h-9 w-9 rounded-md object-contain bg-white/5" />
          ) : (
            <img src="/logo.svg" alt="" className="h-8 w-8 rounded-md" />
          )}
          <div className="text-sm">
            <p className="font-medium">{org?.name ?? "HiResume"}</p>
            <p className="text-xs text-muted-foreground">Interview practice powered by HiResume</p>
          </div>
        </div>
        {org?.is_demo && <p className="text-xs text-amber-300 mb-3">Demo institution</p>}
        {children}
      </div>
    </div>
  );
}
