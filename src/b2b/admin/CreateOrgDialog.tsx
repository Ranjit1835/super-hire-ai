import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { adminApi, ApiError } from "../lib/api";
import type { PlanRow } from "../types";
import { inr, num } from "./queries";

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50);
const endOfDay = (d: string) => (d ? new Date(`${d}T23:59:59+05:30`).toISOString() : null);

export interface CreatedOrg { orgId: string; name: string; credits: number; inviteLink: string | null; emailed: boolean }

export function CreateOrgDialog({ open, onOpenChange, plans, onCreated }: {
  open: boolean; onOpenChange: (o: boolean) => void; plans: PlanRow[]; onCreated: (o: CreatedOrg) => void;
}) {
  const [type, setType] = useState<"college" | "company">("college");
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [planId, setPlanId] = useState("");
  const [seats, setSeats] = useState("");
  const [validTo, setValidTo] = useState("");
  const [credits, setCredits] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminName, setAdminName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const typePlans = useMemo(() => plans.filter((p) => p.org_type === type), [plans, type]);
  const plan = typePlans.find((p) => p.id === planId) ?? typePlans[0];
  const seatN = seats ? Number(seats) : null;
  const suggestedCredits = plan && seatN ? seatN * num(plan.credits_per_student) : plan ? num(plan.credits_included) : 0;

  const submit = async () => {
    setError(null);
    if (!plan) { setError("Pick a plan."); return; }
    setBusy(true);
    try {
      const r = await adminApi("createOrg", {
        name, slug: slug || slugify(name), type, planId: plan.id,
        seatLimit: seatN, validTo: endOfDay(validTo),
        initialCredits: credits === "" ? undefined : Number(credits),
        contactPhone: contactPhone || null,
        contactEmail: adminEmail || null, contactName: adminName || null,
        admin: adminEmail ? { email: adminEmail, fullName: adminName || undefined } : undefined,
      });
      onCreated({ orgId: r.orgId, name, credits: r.credits, inviteLink: r.invite?.link ?? null, emailed: r.invite?.emailed ?? false });
      onOpenChange(false);
      setName(""); setSlug(""); setSlugTouched(false); setSeats(""); setValidTo(""); setCredits(""); setAdminEmail(""); setAdminName(""); setContactPhone("");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New organisation</DialogTitle>
          <DialogDescription>A college (TPO and students) or a company (recruiters and candidates).</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Organisation type">
            {(["college", "company"] as const).map((t) => (
              <Button key={t} type="button" variant={type === t ? "default" : "outline"} role="radio" aria-checked={type === t}
                      onClick={() => { setType(t); setPlanId(""); }}>
                {t === "college" ? "College" : "Company"}
              </Button>
            ))}
          </div>
          <div>
            <Label htmlFor="org-name">Name</Label>
            <Input id="org-name" value={name} onChange={(e) => { setName(e.target.value); if (!slugTouched) setSlug(slugify(e.target.value)); }} />
          </div>
          <div>
            <Label htmlFor="org-slug">Link name</Label>
            <Input id="org-slug" value={slug} onChange={(e) => { setSlugTouched(true); setSlug(slugify(e.target.value)); }} />
            <p className="text-xs text-muted-foreground mt-1">Lowercase letters, digits and hyphens; used in this organisation's links.</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Plan</Label>
              <Select value={plan?.id ?? ""} onValueChange={setPlanId}>
                <SelectTrigger aria-label="Plan"><SelectValue placeholder="Plan" /></SelectTrigger>
                <SelectContent>
                  {typePlans.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}{num(p.price_inr_per_student) > 0 ? ` · ${inr(num(p.price_inr_per_student))}/student` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="org-seats">{type === "college" ? "Students (seats)" : "Seat limit"}</Label>
              <Input id="org-seats" inputMode="numeric" value={seats} onChange={(e) => setSeats(e.target.value.replace(/\D/g, ""))} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="org-valid">Valid until</Label>
              <Input id="org-valid" type="date" value={validTo} onChange={(e) => setValidTo(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="org-credits">Opening credits</Label>
              <Input id="org-credits" inputMode="decimal" placeholder={String(suggestedCredits)} value={credits}
                     onChange={(e) => setCredits(e.target.value.replace(/[^\d.]/g, ""))} />
              <p className="text-xs text-muted-foreground mt-1">
                {plan && type === "college" ? `${num(plan.credits_per_student)} per student` : "Credits per candidate session"}
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="org-admin-email">{type === "college" ? "TPO admin email" : "Company admin email"}</Label>
              <Input id="org-admin-email" type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="org-admin-name">Their name</Label>
              <Input id="org-admin-name" value={adminName} onChange={(e) => setAdminName(e.target.value)} />
            </div>
          </div>
          <div>
            <Label htmlFor="org-phone">Contact phone</Label>
            <Input id="org-phone" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={busy || name.trim().length < 2}>{busy ? "Creating…" : "Create"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
