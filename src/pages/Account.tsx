// Account & privacy (DPDP): what we hold, when you agreed to the notice, and deleting your account. College and
// company members see who to ask instead, because their organisation holds their results.
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { b2bDb } from "@/features/b2b/lib/db";
import { useIsSuperAdmin, useMyMemberships } from "@/features/b2b/hooks/useB2B";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { PRIVACY_EMAIL, PRIVACY_NOTICE_VERSION } from "@/lib/privacy";

export default function Account() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const memberships = useMyMemberships();
  const isSuper = useIsSuperAdmin();
  const consents = useQuery({
    queryKey: ["privacy-consent-list", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await b2bDb.from("user_consents").select("purpose, notice_version, granted_at").order("granted_at", { ascending: false });
      if (error) throw error;
      return data as { purpose: string; notice_version: string; granted_at: string }[];
    },
  });
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const orgs = memberships.data ?? [];
  const managed = orgs.length > 0;
  const staff = isSuper.data === true;
  const agreed = consents.data?.find((c) => c.purpose === "privacy_notice");

  const remove = async () => {
    setBusy(true); setError(null);
    try {
      const { data, error } = await supabase.functions.invoke("account-delete", { body: { confirm: typed } });
      if (error) {
        const body = await (error as { context?: Response }).context?.json?.().catch(() => null);
        throw new Error(body?.error ?? "Couldn't delete the account. Please try again.");
      }
      if (!(data as { ok?: boolean })?.ok) throw new Error("Couldn't delete the account. Please try again.");
      await signOut().catch(() => undefined);
      navigate("/?account=deleted", { replace: true });
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(false); }
  };

  const mail = <a className="text-primary hover:underline" href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</a>;
  return (
    <div className="min-h-screen bg-background">
      <SiteHeader spacer />
      <main className="container max-w-2xl px-4 py-10 space-y-8 text-sm text-muted-foreground">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Account &amp; privacy</h1>
          <p className="mt-1.5">Signed in as <span className="text-foreground">{user?.email}</span>.</p>
        </div>

        <section className="rounded-lg border border-border/60 p-5 space-y-2">
          <h2 className="text-base font-semibold text-foreground">Your data</h2>
          <p>Your resumes, analyses and interviews are in your <Link className="text-primary hover:underline" to="/dashboard">dashboard</Link>,
            where you can open, edit or delete each one. Our <Link className="text-primary hover:underline" to="/privacy">privacy notice</Link> lists
            everything we hold, why, and for how long. For a full copy, or to correct anything, email {mail}.</p>
          <p>{agreed
            ? <>You agreed to the privacy notice (version {agreed.notice_version}) on {new Date(agreed.granted_at).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}.</>
            : managed ? <>You agreed to your organisation's terms when you accepted its invite.</> : <>Current notice: version {PRIVACY_NOTICE_VERSION}.</>}</p>
        </section>

        <section className="rounded-lg border border-red-500/25 p-5 space-y-3">
          <h2 className="text-base font-semibold text-foreground">Delete my account</h2>
          {managed ? (
            <p>Your account is managed by {orgs.map((m) => m.organizations?.name).filter(Boolean).join(", ") || "your organisation"}, which
              holds your test and interview results. To delete your data, ask your placement office or HR team, or email {mail} and we'll
              pass it on and confirm when it's done.</p>
          ) : staff ? (
            <p>HiResume staff accounts can't be deleted here. Email {mail}.</p>
          ) : (
            <>
              <p>This deletes your account, resumes, analyses, interviews and Resume Studio work, and signs you out. It can't be undone.
                Payment records are kept separately for 8 years because tax law requires it; nothing in the app uses them.</p>
              <div className="flex flex-wrap gap-2 items-end">
                <div className="grow min-w-[12rem]">
                  <label htmlFor="del-confirm" className="block text-xs mb-1">Type <b className="text-foreground">DELETE</b> to confirm</label>
                  <Input id="del-confirm" autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} />
                </div>
                <Button variant="destructive" disabled={typed !== "DELETE" || busy} onClick={() => void remove()}>
                  {busy ? "Deleting…" : "Delete my account"}
                </Button>
              </div>
              {error && <p role="alert" className="text-destructive">{error}</p>}
            </>
          )}
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
