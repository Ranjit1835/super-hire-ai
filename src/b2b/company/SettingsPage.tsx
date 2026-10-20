// Credits (balance + ledger) and team (company admins invite recruiters and hiring managers).
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Stat, Loading } from "../layout/V1Shell";
import { companyApi } from "../lib/api";
import { NativeSelect } from "../college/CollegeShell";
import { CompanyShell } from "./CompanyShell";
import { fmtDate, fmtDateTime, useCompanyLedger, useCompanyOrg, useTeam, type CompanyRole } from "./queries";

const ROLE_TEXT: Record<CompanyRole, string> = { org_admin: "Company admin", recruiter: "Recruiter", hiring_manager: "Hiring manager" };
const REASON_TEXT: Record<string, string> = { grant: "Opening credits", top_up: "Top-up", consume: "Candidate session", refund: "Refund", adjust: "Adjustment", expire: "Expired" };

export default function SettingsPage() {
  return <CompanyShell>{({ orgId, isAdmin }) => <Settings orgId={orgId} isAdmin={isAdmin} />}</CompanyShell>;
}

export function Settings({ orgId, isAdmin }: { orgId: string; isAdmin: boolean }) {
  const org = useCompanyOrg(orgId);
  const ledger = useCompanyLedger(orgId, isAdmin);
  const team = useTeam(orgId);
  const cost = Number((org.data?.settings as { candidate_session_credits?: number } | undefined)?.candidate_session_credits ?? 1);
  return (
    <div className="space-y-8 max-w-3xl">
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Credits</h2>
        <div className="grid grid-cols-2 gap-3">
          <Stat label="Balance" value={org.data ? Number(org.data.credits_balance) : "—"} hint={`${cost} credit${cost === 1 ? "" : "s"} per completed candidate session`} />
        </div>
        <p className="text-sm text-muted-foreground">Credits are used once per candidate who finishes every step. New invites are blocked when the balance can't cover them. Top-ups: contact HiResume.</p>
        {isAdmin && (ledger.isLoading ? <Loading /> : (
          <table className="w-full text-sm" aria-label="Credit ledger">
            <thead><tr className="text-left text-muted-foreground"><th className="py-1">Date</th><th>What</th><th className="text-right">Change</th><th className="text-right">Balance</th></tr></thead>
            <tbody>
              {(ledger.data ?? []).map((l) => (
                <tr key={l.id} className="border-t border-border">
                  <td className="py-1">{fmtDateTime(l.created_at)}</td><td>{REASON_TEXT[l.reason] ?? l.reason}{l.note ? ` · ${l.note}` : ""}</td>
                  <td className="text-right tabular-nums">{Number(l.delta) > 0 ? "+" : ""}{Number(l.delta)}</td>
                  <td className="text-right tabular-nums">{Number(l.balance_after)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Team</h2>
        {team.isLoading ? <Loading /> : (
          <ul className="divide-y divide-border rounded-lg border border-border text-sm">
            {(team.data?.members ?? []).map((m) => (
              <li key={m.id} className="flex gap-2 p-3"><span className="flex-1">{m.full_name || m.email}</span><span className="text-muted-foreground">{ROLE_TEXT[m.role]}</span></li>
            ))}
            {(team.data?.invites ?? []).map((i) => (
              <li key={i.id} className="flex gap-2 p-3 text-muted-foreground"><span className="flex-1">{i.email} (invited, expires {fmtDate(i.expires_at)})</span><span>{ROLE_TEXT[i.role as CompanyRole] ?? i.role}</span></li>
            ))}
          </ul>
        )}
        {isAdmin ? <InviteStaff orgId={orgId} /> : <p className="text-sm text-muted-foreground">Only company admins can invite people.</p>}
      </section>
    </div>
  );
}

function InviteStaff({ orgId }: { orgId: string }) {
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<CompanyRole>("recruiter");
  const [msg, setMsg] = useState<string | null>(null);
  async function submit() {
    setMsg(null);
    try {
      const r = await companyApi("inviteStaff", { orgId, email: email.trim(), role, ...(name.trim() ? { fullName: name.trim() } : {}) });
      setMsg(r.emailed ? `Invite emailed to ${email.trim()}.` : `Invite created. Send this link to ${email.trim()} (it works only for that email): ${r.link}`);
      setEmail(""); setName("");
      await qc.invalidateQueries({ queryKey: ["b2b-company", "team", orgId] });
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Couldn't send the invite.");
    }
  }
  return (
    <div className="grid sm:grid-cols-4 gap-2 items-end">
      <div className="space-y-1"><Label htmlFor="staff-name">Name</Label><Input id="staff-name" value={name} onChange={(e) => setName(e.target.value)} /></div>
      <div className="space-y-1"><Label htmlFor="staff-email">Email</Label><Input id="staff-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
      <div className="space-y-1"><Label htmlFor="staff-role">Role</Label>
        <NativeSelect id="staff-role" value={role} onChange={(e) => setRole(e.target.value as CompanyRole)}>
          <option value="recruiter">Recruiter</option><option value="hiring_manager">Hiring manager</option><option value="org_admin">Company admin</option>
        </NativeSelect>
      </div>
      <Button onClick={() => void submit()} disabled={!email.trim()}>Invite</Button>
      {msg && <p role="status" className="sm:col-span-4 text-sm break-all">{msg}</p>}
    </div>
  );
}
