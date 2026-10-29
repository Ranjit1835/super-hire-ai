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

/** R1.8 and the per-org limits added in Phase 1. Empty = use the platform default. Super admins only. */
export const SETTING_FIELDS = [
  { key: "practice_credits", label: "Credits per practice run", hint: "Default 0.25; 0 makes practice free", min: 0, max: 100, step: 0.05 },
  { key: "candidate_session_credits", label: "Credits per candidate (companies)", hint: "Default 1", min: 0.01, max: 100, step: 0.05 },
  { key: "low_credit_alert", label: "Low-credit alert below", hint: "Default 50 credits", min: 0, max: 1_000_000, step: 1 },
  { key: "expiry_alert_days", label: "Plan expiry alert (days before)", hint: "Default 14", min: 1, max: 90, step: 1 },
  { key: "retention_days", label: "Keep evidence for (days)", hint: "Default 90; consent text uses this", min: 7, max: 730, step: 1 },
  { key: "session_idle_min", label: "Student idle sign-out (minutes)", hint: "Default 30", min: 5, max: 240, step: 1 },
  { key: "session_max_hours", label: "Student session length (hours)", hint: "Default 8", min: 1, max: 24, step: 1 },
] as const;
type SettingKey = (typeof SETTING_FIELDS)[number]["key"];

export function SettingsDialog({ org, onClose, onSaved }: { org: OrgRow | null; onClose: () => void; onSaved: () => void }) {
  const current = (org?.settings ?? {}) as Record<string, unknown>;
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(SETTING_FIELDS.map((f) => [f.key, current[f.key] === undefined || current[f.key] === null ? "" : String(current[f.key])])));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!org) return null;
  const submit = async () => {
    setError(null);
    const settings: Partial<Record<SettingKey, number>> = {};
    for (const f of SETTING_FIELDS) {
      const raw = values[f.key].trim();
      if (raw === "") continue;
      const n = Number(raw);
      if (!Number.isFinite(n) || n < f.min || n > f.max) { setError(`${f.label}: enter a number from ${f.min} to ${f.max}.`); return; }
      settings[f.key] = n;
    }
    setBusy(true);
    try {
      // updateOrg's optional fields come from Object.fromEntries, so TS only sees orgId/status; the contract still
      // validates settings at runtime (OrgSettings, strict, with the bounds above).
      await adminApi("updateOrg", { orgId: org.id, settings } as never);
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : friendly(e));
    } finally { setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Costs and limits: {org.name}</DialogTitle>
          <DialogDescription>Credits each activity uses, alerts, evidence retention and student sessions. Leave a field empty for the default.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          {SETTING_FIELDS.map((f) => (
            <div key={f.key}>
              <Label htmlFor={`set-${f.key}`}>{f.label}</Label>
              <Input id={`set-${f.key}`} type="number" inputMode="decimal" min={f.min} max={f.max} step={f.step} placeholder={f.hint}
                     value={values[f.key]} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} />
            </div>
          ))}
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
