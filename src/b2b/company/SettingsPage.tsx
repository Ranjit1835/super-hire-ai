// Credits (balance + ledger) and team (company admins invite recruiters and hiring managers).
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Stat, Loading } from "../layout/V1Shell";
import { Chip } from "../ui/broadcast";
import { companyApi } from "../lib/api";
import { NativeSelect } from "../college/CollegeShell";

/** Owner decision 2026-10-24: top-ups go to the owner by email; no pack size is promised anywhere. */
const TOPUP_MAILTO = "mailto:ranjitperumala@gmail.com?subject=Credit%20top-up%20for%20";
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
        <h2 className="hr-display text-xl">Credits</h2>
        <div className="grid grid-cols-2 gap-3">
          <Stat label="Balance" value={org.data ? Number(org.data.credits_balance) : "–"} hint={`${cost} credit${cost === 1 ? "" : "s"} per completed candidate session`} />
        </div>
        <p className="text-sm text-[var(--hr-muted)]">Credits are used once per candidate who finishes every step. New invites are blocked when the balance can't cover them.</p>
        <p className="text-sm text-[var(--hr-muted)] flex flex-wrap items-center gap-3">
          Need more credits? Contact HiResume for a top-up.
          <Button variant="outline" size="sm" asChild>
            <a href={`${TOPUP_MAILTO}${encodeURIComponent(org.data?.name ?? "")}`}>Contact HiResume</a>
          </Button>
        </p>
        {isAdmin && (ledger.isLoading ? <Loading /> : (
          <Table aria-label="Credit ledger">
            <TableHeader><TableRow className="hover:bg-transparent">
              <TableHead className="hr-label">Date</TableHead><TableHead className="hr-label">What</TableHead>
              <TableHead className="hr-label text-right">Change</TableHead><TableHead className="hr-label text-right">Balance</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {(ledger.data ?? []).map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="text-sm text-[var(--hr-muted)]">{fmtDateTime(l.created_at)}</TableCell>
                  <TableCell className="text-sm">{REASON_TEXT[l.reason] ?? l.reason}{l.note ? ` · ${l.note}` : ""}</TableCell>
                  <TableCell className="hr-data text-sm text-right">{Number(l.delta) > 0 ? "+" : ""}{Number(l.delta)}</TableCell>
                  <TableCell className="hr-data text-sm text-right">{Number(l.balance_after)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ))}
      </section>

      <section className="space-y-3 hr-rule-t pt-6">
        <h2 className="hr-display text-xl">Team</h2>
        {team.isLoading ? <Loading /> : (
          <ul className="divide-y divide-[var(--hr-rule)]">
            {(team.data?.members ?? []).map((m) => (
              <li key={m.id} className="flex items-center gap-2 py-3 text-sm"><span className="flex-1">{m.full_name || m.email}</span><Chip tone="muted">{ROLE_TEXT[m.role]}</Chip></li>
            ))}
            {(team.data?.invites ?? []).map((i) => (
              <li key={i.id} className="flex items-center gap-2 py-3 text-sm text-[var(--hr-muted)]">
                <span className="flex-1">{i.email} (invited, expires {fmtDate(i.expires_at)})</span>
                <Chip tone="muted">{ROLE_TEXT[i.role as CompanyRole] ?? i.role}</Chip>
              </li>
            ))}
          </ul>
        )}
        {isAdmin ? <InviteStaff orgId={orgId} /> : <p className="text-sm text-[var(--hr-muted)]">Only company admins can invite people.</p>}
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
    <div className="grid sm:grid-cols-4 gap-2 items-end pt-2">
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
