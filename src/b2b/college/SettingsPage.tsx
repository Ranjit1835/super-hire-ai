import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Loading, Stat } from "../layout/V1Shell";
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
        <h2 className="text-lg font-semibold">Practice credits (shared by all your students)</h2>
        <div className="grid sm:grid-cols-3 gap-3">
          <Stat label="Balance" value={balance.toLocaleString("en-IN")} />
          <Stat label="Used this month" value={isAdmin && ledger.data ? usedThisMonth(ledger.data).toLocaleString("en-IN") : "—"} />
          <Stat label="What a credit buys" value="1 interview" hint="A practice coding test uses ¼ credit, a resume optimisation ½. Drives don't use credits." />
        </div>
        {ledger.isLoading ? <Loading /> : isAdmin && ledger.data?.length ? (
          <Table>
            <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>What</TableHead><TableHead className="text-right">Change</TableHead><TableHead className="text-right">Balance after</TableHead></TableRow></TableHeader>
            <TableBody>
              {ledger.data.slice(0, 50).map((l) => (
                <TableRow key={l.id}>
                  <TableCell>{fmtDate(l.created_at)}</TableCell>
                  <TableCell>{REASON_TEXT[l.reason] ?? l.reason}{l.feature ? `: ${FEATURE_TEXT[l.feature] ?? l.feature}` : ""}{l.note ? ` · ${l.note}` : ""}</TableCell>
                  <TableCell className="text-right tabular-nums">{Number(l.delta) > 0 ? `+${Number(l.delta)}` : Number(l.delta)}</TableCell>
                  <TableCell className="text-right tabular-nums">{Number(l.balance_after)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : <p className="text-sm text-muted-foreground">{isAdmin ? "No credit movements yet." : "Only TPO admins see the credit history."}</p>}
        <p className="text-xs text-muted-foreground">Need more credits? Ask HiResume for a top-up (100 credits per pack).</p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Team</h2>
        {staff.isLoading ? <Loading /> : (
          <Table>
            <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Email</TableHead><TableHead>Role</TableHead><TableHead>Since</TableHead></TableRow></TableHeader>
            <TableBody>
              {staff.data?.members.map((m) => (
                <TableRow key={m.id}><TableCell>{m.full_name ?? "—"}</TableCell><TableCell>{m.email ?? "—"}</TableCell><TableCell>{ROLE_TEXT[m.role] ?? m.role}</TableCell><TableCell>{fmtDate(m.created_at)}</TableCell></TableRow>
              ))}
              {staff.data?.invites.map((i) => (
                <TableRow key={i.id}><TableCell>{i.full_name}</TableCell><TableCell>{i.email}</TableCell><TableCell>{ROLE_TEXT[i.role] ?? i.role}</TableCell>
                  <TableCell className="text-muted-foreground">Invited, expires {fmtDate(i.expires_at)}</TableCell></TableRow>
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
    <form className="rounded-lg border p-3 grid sm:grid-cols-4 gap-3 items-end" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <div className="space-y-1"><Label htmlFor="s-email">Email</Label><Input id="s-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
      <div className="space-y-1"><Label htmlFor="s-name">Name</Label><Input id="s-name" value={name} onChange={(e) => setName(e.target.value)} /></div>
      <div className="space-y-1"><Label htmlFor="s-role">Role</Label>
        <NativeSelect id="s-role" value={role} onChange={(e) => setRole(e.target.value as "trainer" | "org_admin")}>
          <option value="trainer">Trainer (drives and analytics)</option>
          <option value="org_admin">TPO admin (everything)</option>
        </NativeSelect></div>
      <Button type="submit" disabled={busy}>Invite</Button>
      {link && <p className="sm:col-span-4 text-sm" role="status">Email isn't set up yet; share this link with them (it only works for that email): <code className="text-xs break-all">{link}</code></p>}
    </form>
  );
}
