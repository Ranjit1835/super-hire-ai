import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { adminApi, ApiError } from "../lib/api";
import type { OrgRow } from "../types";
import { ROLE_LABEL, adjustCredits, fmtDate, friendly, num, useLedger } from "./queries";

const ROLES_BY_TYPE: Record<string, ("org_admin" | "trainer" | "recruiter" | "hiring_manager")[]> = {
  college: ["org_admin", "trainer"],
  coaching_institute: ["org_admin", "trainer"],
  company: ["org_admin", "recruiter", "hiring_manager"],
};

export function InviteStaffDialog({ org, onClose, onInvited }: {
  org: OrgRow | null; onClose: () => void; onInvited: (r: { link: string; emailed: boolean; email: string }) => void;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<string>("org_admin");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!org) return null;
  const roles = ROLES_BY_TYPE[org.type] ?? ["org_admin"];
  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const r = await adminApi("inviteStaff", { orgId: org.id, email, fullName: name || undefined, role: role as (typeof roles)[number] });
      onInvited({ link: r.link, emailed: r.emailed, email });
      setEmail(""); setName("");
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : friendly(e));
    } finally { setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Invite staff to {org.name}</DialogTitle>
          <DialogDescription>The link works only for this email address and expires in 14 days.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div><Label htmlFor="inv-email">Email</Label><Input id="inv-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <div><Label htmlFor="inv-name">Name</Label><Input id="inv-name" value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div>
            <Label>Role</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger aria-label="Role"><SelectValue /></SelectTrigger>
              <SelectContent>{roles.map((r) => <SelectItem key={r} value={r}>{ROLE_LABEL[r]}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !email.includes("@")}>{busy ? "Inviting…" : "Send invite"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CreditsDialog({ org, onClose, onChanged }: { org: OrgRow | null; onClose: () => void; onChanged: () => void }) {
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<"top_up" | "adjust">("top_up");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ledger = useLedger(org?.id ?? null);
  if (!org) return null;
  const submit = async () => {
    const n = Number(amount);
    if (!Number.isFinite(n) || n === 0) { setError("Enter a non-zero amount."); return; }
    setBusy(true); setError(null);
    try {
      await adjustCredits(org.id, mode === "top_up" ? Math.abs(n) : n, mode, note || null);
      setAmount(""); setNote("");
      onChanged();
      void ledger.refetch();
    } catch (e) { setError(friendly(e)); } finally { setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Credits: {org.name}</DialogTitle>
          <DialogDescription>Balance: <b className="hr-data text-foreground">{num(org.credits_balance)}</b> credits. 1 credit = one 20-minute practice interview.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-[1fr_auto] gap-2 items-end">
          <div><Label htmlFor="cr-amount">{mode === "top_up" ? "Add credits" : "Adjust by (negative removes)"}</Label>
            <Input id="cr-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.-]/g, ""))} /></div>
          <Select value={mode} onValueChange={(v) => setMode(v as "top_up" | "adjust")}>
            <SelectTrigger aria-label="Kind" className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="top_up">Top-up</SelectItem><SelectItem value="adjust">Correction</SelectItem></SelectContent>
          </Select>
        </div>
        <div><Label htmlFor="cr-note">Note</Label><Input id="cr-note" value={note} placeholder="e.g. Invoice #12" onChange={(e) => setNote(e.target.value)} /></div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="max-h-56 overflow-y-auto shadow-[inset_0_0_0_1px_var(--hr-rule)]">
          <table className="w-full text-xs">
            <thead className="hr-label"><tr><th className="text-left p-2">When</th><th className="text-left p-2">What</th><th className="text-right p-2">Change</th><th className="text-right p-2">Balance</th></tr></thead>
            <tbody>
              {(ledger.data ?? []).map((l) => (
                <tr key={l.id} className="hr-rule-t">
                  <td className="p-2 hr-data">{fmtDate(l.created_at)}</td>
                  <td className="p-2">{l.reason}{l.feature ? ` · ${l.feature}` : ""}{l.note ? ` · ${l.note}` : ""}</td>
                  <td className="p-2 text-right hr-data">{num(l.delta) > 0 ? "+" : ""}{num(l.delta)}</td>
                  <td className="p-2 text-right hr-data">{num(l.balance_after)}</td>
                </tr>
              ))}
              {ledger.data?.length === 0 && <tr><td colSpan={4} className="p-3 text-center text-[var(--hr-muted)]">No credit movements yet</td></tr>}
            </tbody>
          </table>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button onClick={submit} disabled={busy || !amount}>{busy ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
