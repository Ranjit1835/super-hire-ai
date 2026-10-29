import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import { useB2BTheme, Loading } from "@/b2b/layout/V1Shell";
import { Chip, Wordmark } from "@/b2b/ui/broadcast";
import { Stage, type StageStep } from "@/b2b/three/Stage";
import { passwordProblems } from "../lib/status";
import { ApiError, invitesApi, rememberPendingInvite, takePendingInvite, type InvitePreview } from "../lib/api";
import { afterJoin } from "../lib/after-join";

const PASSWORD_HINT = "8+ characters, 1 uppercase letter, 1 number";

const DEAD_LINK: Record<string, { title: string; body: string }> = {
  expired: { title: "This invite link has expired", body: "Ask your placement office to send you a new link." },
  revoked: { title: "This invite was withdrawn", body: "Contact your placement office if you think this is a mistake." },
  accepted: { title: "This invite has already been used", body: "If you joined already, sign in to continue." },
};

/** /invite/:token — public. Create an account (or sign in) and join the institution. */
export default function InviteAccept() {
  useB2BTheme();
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
    setTimeout(() => navigate(preview.data ? afterJoin(preview.data).to : "/learn", { replace: true }), 1200);
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

  if (preview.isLoading || authLoading) return <div className="min-h-screen bg-background grid place-items-center"><Loading /></div>;

  if (preview.error || !preview.data) {
    const notFound = preview.error instanceof ApiError && preview.error.status === 404;
    return (
      <Frame>
        <h1 className="hr-display text-2xl">{notFound ? "This invite link isn't valid" : "Couldn't open this invite"}</h1>
        <p className="text-sm text-muted-foreground mt-2">
          {notFound ? "Check that you opened the full link, or ask your placement office for a new one." : (preview.error as Error)?.message}
        </p>
      </Frame>
    );
  }

  const p = preview.data;
  const staffRole = staffRoleLabel(p);
  const dead = DEAD_LINK[p.status];
  const pwProblems = passwordProblems(password);
  const canRegister = consent && pwProblems.length === 0 && password === confirm && !busy;
  const registerConsentHint = !consent && pwProblems.length === 0 && password === confirm;
  // Decision D3: the 3D stage carries the viewer's own real next steps, never the logo.
  const stageLabels = staffRole ? ["Join", "Set up", "Run drives"] : ["Join", "Check", "Test", "Interview"];
  const stageSteps: StageStep[] = stageLabels.map((label, i) => ({
    label,
    state: joined ? (i === 0 ? "done" : i === 1 ? "current" : "todo") : i === 0 ? "current" : "todo",
  }));

  return (
    <Frame org={p.org} steps={stageSteps}>
      {joined ? (
        <div className="text-center py-6" role="status">
          <CheckCircle2 className="h-10 w-10 text-[var(--hr-gold)] mx-auto mb-3" />
          <h1 className="hr-display text-2xl">You're in!</h1>
          <p className="text-sm text-muted-foreground mt-1">Taking you to {afterJoin(p).label}…</p>
        </div>
      ) : dead ? (
        <>
          <h1 className="hr-display text-2xl">{dead.title}</h1>
          <p className="text-sm text-muted-foreground mt-2">{dead.body}</p>
          {p.status === "accepted" && <Button className="mt-4" asChild><Link to={afterJoin(p).to}>Continue</Link></Button>}
        </>
      ) : (
        <>
          <h1 className="hr-display text-2xl">Hi {p.full_name.split(" ")[0]}, join {p.org.name}</h1>
          <p className="text-sm text-muted-foreground mt-1.5">
            {staffRole
              ? `You've been invited as ${staffRole} of ${p.org.name} on HiResume.`
              : p.org.type === "college"
                ? "Placement tests, AI interviews and practice set up by your placement office."
                : `AI voice mock interviews set up by your institution${p.batch ? ` for ${p.batch}` : ""}.`}
          </p>
          <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1.5 text-sm mt-4 shadow-[inset_0_0_0_1px_var(--hr-rule)] p-3">
            <dt className="hr-label">Name</dt><dd>{p.full_name}</dd>
            {staffRole
              ? <><dt className="hr-label">Role</dt><dd>{staffRole[0].toUpperCase() + staffRole.slice(1)}</dd></>
              : p.roll_no && <><dt className="hr-label">Roll no</dt><dd className="hr-data">{p.roll_no}</dd></>}
            <dt className="hr-label">Email</dt><dd className="break-all">{p.email}</dd>
          </dl>

          <div className="flex items-start gap-2 mt-5 shadow-[inset_0_0_0_1px_var(--hr-rule)] p-3">
            <Checkbox id="consent" checked={consent} onCheckedChange={(v) => setConsent(v === true)} className="mt-0.5" />
            <Label htmlFor="consent" className="text-sm font-normal leading-snug">{p.consent.text}</Label>
          </div>

          {error && <p className="text-sm text-[var(--hr-red-ink)] mt-4" role="alert">{error}</p>}

          {user ? (
            <div className="mt-5 space-y-3">
              <p className="text-sm text-muted-foreground">
                Signed in as <strong className="text-foreground">{user.email}</strong>
                {user.email?.toLowerCase() !== p.email && " (different from the invited email — that's fine)"}.
              </p>
              <Button className="w-full" onClick={acceptSignedIn} disabled={!consent || busy} aria-describedby={!consent ? "join-consent-hint" : undefined}>
                {busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Join {p.org.name}
              </Button>
              {!consent && <p id="join-consent-hint" className="text-xs text-muted-foreground">Tick the consent box above to continue.</p>}
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
                <p id="pw-hint" className={`text-xs mt-1 ${password && pwProblems.length ? "text-[var(--hr-red-ink)]" : "text-muted-foreground"}`}>
                  {password && pwProblems.length ? `Needs ${pwProblems.join(", ")}` : PASSWORD_HINT}
                </p>
              </div>
              <div>
                <Label htmlFor="pw2">Confirm password</Label>
                <Input id="pw2" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
                {confirm && confirm !== password && <p className="text-xs text-[var(--hr-red-ink)] mt-1">Passwords don't match</p>}
              </div>
              <Button type="submit" className="w-full" disabled={!canRegister} aria-describedby={registerConsentHint ? "register-consent-hint" : undefined}>
                {busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Create account & join
              </Button>
              {registerConsentHint && <p id="register-consent-hint" className="text-xs text-muted-foreground">Tick the consent box above to continue.</p>}
              <div className="relative text-center text-xs text-muted-foreground my-2"><span className="bg-[var(--hr-surface)] px-2">or</span></div>
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

function Frame({ org, steps, children }: { org?: InvitePreview["org"]; steps?: StageStep[]; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-4xl grid lg:grid-cols-[300px_minmax(0,1fr)] gap-5 items-start">
        <div className="hidden lg:block shadow-[inset_0_0_0_1px_var(--hr-rule)] bg-[var(--hr-surface)]">
          <Stage steps={steps} className="h-[340px] lg:sticky lg:top-10" />
        </div>
        <div className="shadow-[inset_0_0_0_1px_var(--hr-rule)] bg-[var(--hr-surface)] p-6 sm:p-8">
          <div className="flex items-center justify-between gap-3 mb-5">
            <Wordmark />
          </div>
          {org && (
            <div className="flex flex-wrap items-center gap-2 mb-6 hr-rule-b pb-4">
              {org.logo_url ? (
                <img src={org.logo_url} alt="" className="h-7 w-7 object-contain bg-[var(--hr-surface-2)]" />
              ) : (
                <span aria-hidden className="grid h-7 w-7 place-items-center bg-[var(--hr-surface-2)] shadow-[inset_0_0_0_1px_var(--hr-rule)] hr-display text-[13px]">
                  {org.name.trim().charAt(0).toUpperCase()}
                </span>
              )}
              <p className="text-sm font-medium flex-1 min-w-0 truncate">{org.name}</p>
              <Chip tone="muted">{org.type === "college" ? "College" : "Company"}</Chip>
              {org.is_demo && <Chip tone="muted">Demo</Chip>}
            </div>
          )}
          {children}
        </div>
      </div>
    </div>
  );
}

const STAFF_LABEL: Record<string, [college: string, company: string]> = {
  org_admin: ["TPO admin", "company admin"],
  trainer: ["trainer", "trainer"],
  recruiter: ["recruiter", "recruiter"],
  hiring_manager: ["hiring manager", "hiring manager"],
};

/** "TPO admin", "recruiter"…; null for students and candidates. */
function staffRoleLabel(p: { role?: string | null; org: { type: string } }): string | null {
  const l = p.role ? STAFF_LABEL[p.role] : undefined;
  return l ? l[p.org.type === "company" ? 1 : 0] : null;
}
