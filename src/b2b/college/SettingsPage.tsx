import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Loading } from "../layout/V1Shell";
import { Numeral } from "../ui/broadcast";
import { collegeApi, ApiError } from "../lib/api";
import { CollegeShell, NativeSelect } from "./CollegeShell";
import { fmtDate, friendly, useCollegeLedger, useOrg, useStaff, usedThisMonth } from "./queries";

const REASON_TEXT: Record<string, string> = {
  grant: "Plan credits", top_up: "Top-up", consume: "Used", refund: "Refunded", adjust: "Adjustment", expire: "Expired",
};
const FEATURE_TEXT: Record<string, string> = {
  practice_interview: "practice interview", practice_coding: "practice coding test", resume: "resume optimisation",
};
const ROLE_TEXT: Record<string, string> = { org_admin: "TPO admin", trainer: "Trainer" };

/** Owner decision 2026-10-24: top-ups go to the owner by email; no pack size is promised anywhere. */
const TOPUP_MAILTO = "mailto:ranjitperumala@gmail.com?subject=Credit%20top-up%20for%20";

export default function SettingsPage() {
  return <CollegeShell>{({ orgId, isAdmin }) => <Settings orgId={orgId} isAdmin={isAdmin} />}</CollegeShell>;
}

function Settings({ orgId, isAdmin }: { orgId: string; isAdmin: boolean }) {
  const org = useOrg(orgId);
  const ledger = useCollegeLedger(orgId);
  const staff = useStaff(orgId);
  const balance = Number(org.data?.credits_balance ?? 0);
  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="hr-display text-[18px]">Practice credits <span className="text-[var(--hr-muted)] font-normal text-sm">(shared by all your students)</span></h2>
        <div className="border border-[var(--hr-rule)] bg-[var(--hr-surface)] px-5 py-4 flex flex-wrap items-end gap-x-10 gap-y-3">
          <div>
            <p className="hr-label">Balance</p>
            <p className="text-[42px] leading-none mt-1"><Numeral value={balance} tone="plain" /></p>
          </div>
          <div>
            <p className="hr-label">Used this month</p>
            <p className="text-[22px] leading-none mt-1"><Numeral value={isAdmin && ledger.data ? usedThisMonth(ledger.data) : "–"} /></p>
          </div>
          <div className="max-w-xs">
            <p className="hr-label">What a credit buys</p>
            <p className="text-sm mt-1">1 interview. A practice coding test uses ¼ credit, a resume optimisation ½. Drives don't use credits.</p>
          </div>
        </div>
        {ledger.isLoading ? <Loading /> : isAdmin && ledger.data?.length ? (
          <Table>
            <TableHeader><TableRow className="hover:bg-transparent">
              <TableHead className="hr-label">Date</TableHead><TableHead className="hr-label">What</TableHead>
              <TableHead className="hr-label text-right">Change</TableHead><TableHead className="hr-label text-right">Balance after</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {ledger.data.slice(0, 50).map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="hr-data text-xs text-[var(--hr-muted)]">{fmtDate(l.created_at)}</TableCell>
                  <TableCell>{REASON_TEXT[l.reason] ?? l.reason}{l.feature ? `: ${FEATURE_TEXT[l.feature] ?? l.feature}` : ""}{l.note ? ` · ${l.note}` : ""}</TableCell>
                  <TableCell className="hr-data text-right text-foreground">{Number(l.delta) > 0 ? `+${Number(l.delta)}` : Number(l.delta)}</TableCell>
                  <TableCell className="hr-data text-right">{Number(l.balance_after)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : <p className="text-sm text-[var(--hr-muted)]">{isAdmin ? "No credit movements yet." : "Only TPO admins see the credit history."}</p>}
        <p className="text-xs text-[var(--hr-muted)] flex flex-wrap items-center gap-3">
          Need more credits? Contact HiResume for a top-up.
          <Button variant="outline" size="sm" asChild>
            <a href={`${TOPUP_MAILTO}${encodeURIComponent(org.data?.name ?? "")}`}>Contact HiResume</a>
          </Button>
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="hr-display text-[18px]">Team</h2>
        {staff.isLoading ? <Loading /> : (
          <Table>
            <TableHeader><TableRow className="hover:bg-transparent">
              <TableHead className="hr-label">Name</TableHead><TableHead className="hr-label">Email</TableHead>
              <TableHead className="hr-label">Role</TableHead><TableHead className="hr-label">Since</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {staff.data?.members.map((m) => (
                <TableRow key={m.id}><TableCell className="font-medium">{m.full_name ?? "–"}</TableCell><TableCell className="text-[var(--hr-muted)]">{m.email ?? "–"}</TableCell><TableCell>{ROLE_TEXT[m.role] ?? m.role}</TableCell><TableCell className="hr-data text-xs">{fmtDate(m.created_at)}</TableCell></TableRow>
              ))}
              {staff.data?.invites.map((i) => (
                <TableRow key={i.id}><TableCell className="font-medium">{i.full_name}</TableCell><TableCell className="text-[var(--hr-muted)]">{i.email}</TableCell><TableCell>{ROLE_TEXT[i.role] ?? i.role}</TableCell>
                  <TableCell className="text-[var(--hr-muted)] text-xs">Invited, expires {fmtDate(i.expires_at)}</TableCell></TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {isAdmin && <InviteStaffForm orgId={orgId} />}
      </section>
    </div>
  );
}

function InviteStaffForm({ orgId }: { orgId: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<"trainer" | "org_admin">("trainer");
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    setLink(null);
    try {
      const r = await collegeApi("inviteStaff", { orgId, email, fullName: name || undefined, role });
      toast({ title: r.emailed ? `Invite emailed to ${email}` : "Invite created" });
      if (!r.emailed) setLink(r.link);
      setEmail(""); setName("");
      void qc.invalidateQueries({ queryKey: ["b2b-college", "staff", orgId] });
    } catch (e) {
      toast({ title: "Couldn't invite", description: e instanceof ApiError ? e.message : friendly(e), variant: "destructive" });
    } finally { setBusy(false); }
  };
  return (
    <form className="border border-[var(--hr-rule)] bg-[var(--hr-surface)] p-3 grid sm:grid-cols-4 gap-3 items-end" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <div className="space-y-1"><Label htmlFor="s-email">Email</Label><Input id="s-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
      <div className="space-y-1"><Label htmlFor="s-name">Name</Label><Input id="s-name" value={name} onChange={(e) => setName(e.target.value)} /></div>
      <div className="space-y-1"><Label htmlFor="s-role">Role</Label>
        <NativeSelect id="s-role" value={role} onChange={(e) => setRole(e.target.value as "trainer" | "org_admin")}>
          <option value="trainer">Trainer (drives and analytics)</option>
          <option value="org_admin">TPO admin (everything)</option>
        </NativeSelect></div>
      <Button type="submit" disabled={busy}>Invite</Button>
      {link && <p className="sm:col-span-4 text-sm" role="status">Email isn't set up yet; share this link with them (it only works for that email): <code className="hr-data text-xs break-all text-[var(--hr-muted)]">{link}</code></p>}
    </form>
  );
}
