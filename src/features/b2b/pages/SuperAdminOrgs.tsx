import { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { B2BShell, CenteredSpinner, EmptyState } from "../components/B2BShell";
import { useAllOrgs, useIsSuperAdmin, usePlans, type OrgWithCounts } from "../hooks/useB2B";
import { b2bDb } from "../lib/db";
import { SLUG_RE, daysLeft, formatDate, friendlyDbError, slugify } from "../lib/format";
import type { OrgMemberRole, OrgType, Plan } from "../types";

const TYPE_LABEL: Record<OrgType, string> = { college: "College", coaching_institute: "Coaching institute" };

function toDateInput(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "";
}

function endOfDayIso(date: string): string | null {
  return date ? new Date(`${date}T23:59:59+05:30`).toISOString() : null;
}

export default function SuperAdminOrgs() {
  const { user } = useAuth();
  const isSuper = useIsSuperAdmin();
  const enabled = isSuper.data === true;
  const orgs = useAllOrgs(enabled);
  const plans = usePlans(enabled);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<OrgWithCounts | null>(null);
  const [addingTo, setAddingTo] = useState<OrgWithCounts | null>(null);

  if (isSuper.isLoading) return <CenteredSpinner />;
  if (!isSuper.data) return <Navigate to="/dashboard" replace />;

  const planById = new Map((plans.data ?? []).map((p) => [p.id, p]));

  return (
    <B2BShell
      title="HiResume for Institutions"
      subtitle={`Super-admin · ${user?.email ?? ""}`}
      actions={
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" asChild><Link to="/admin/costs">Costs</Link></Button>
          <Button size="sm" onClick={() => setCreating(true)} disabled={!plans.data}>
            <Plus className="h-4 w-4 mr-1" /> New institution
          </Button>
        </div>
      }
    >
      {orgs.isLoading ? (
        <CenteredSpinner />
      ) : orgs.error ? (
        <p className="text-destructive text-sm">{friendlyDbError(orgs.error)}</p>
      ) : !orgs.data?.length ? (
        <EmptyState title="No institutions yet" body="Create the pilot college, assign a plan, then add its TPO as org admin.">
          <Button onClick={() => setCreating(true)} disabled={!plans.data}>
            <Plus className="h-4 w-4 mr-1" /> New institution
          </Button>
        </EmptyState>
      ) : (
        <div className="rounded-lg border border-border/60 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Institution</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead className="text-right">Students</TableHead>
                <TableHead>Plan ends</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orgs.data.map((o) => {
                const plan = planById.get(o.plan_id);
                const left = daysLeft(o.plan_ends_at);
                return (
                  <TableRow key={o.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Link to={`/org/${o.id}`} className="font-medium hover:underline">{o.name}</Link>
                        {o.is_demo && <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-300">DEMO</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground">{TYPE_LABEL[o.type]} · /{o.slug}</p>
                    </TableCell>
                    <TableCell>{plan?.name ?? o.plan_id}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {o.student_count}
                      {plan?.max_students ? <span className="text-muted-foreground"> / {plan.max_students}</span> : null}
                    </TableCell>
                    <TableCell>
                      {formatDate(o.plan_ends_at)}
                      {left !== null && (
                        <span className={left <= 7 ? "text-amber-300 text-xs ml-1" : "text-muted-foreground text-xs ml-1"}>
                          {left > 0 ? `(${left}d left)` : "(ended)"}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <Button variant="ghost" size="sm" onClick={() => setAddingTo(o)}>
                        <UserPlus className="h-4 w-4 mr-1" /> Add staff
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setEditing(o)}>Edit plan</Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {creating && plans.data && (
        <CreateOrgDialog plans={plans.data} userId={user!.id} onClose={() => setCreating(false)} />
      )}
      {editing && plans.data && <EditPlanDialog org={editing} plans={plans.data} onClose={() => setEditing(null)} />}
      {addingTo && <AddMemberDialog org={addingTo} onClose={() => setAddingTo(null)} />}
    </B2BShell>
  );
}

function PlanSelect({ plans, value, onChange }: { plans: Plan[]; value: string; onChange: (v: string) => void }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id="plan"><SelectValue /></SelectTrigger>
      <SelectContent>
        {plans.map((p) => (
          <SelectItem key={p.id} value={p.id}>
            {p.name} — {p.interviews_per_student} interviews/student
            {p.max_students ? `, max ${p.max_students}` : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function CreateOrgDialog({ plans, userId, onClose }: { plans: Plan[]; userId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [type, setType] = useState<OrgType>("college");
  const [planId, setPlanId] = useState("pilot");
  const [logoUrl, setLogoUrl] = useState("");
  const [endsOn, setEndsOn] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 42); // 6-week pilot
    return d.toISOString().slice(0, 10);
  });
  const [saving, setSaving] = useState(false);

  const effectiveSlug = slugTouched ? slug : slugify(name);
  const valid = name.trim().length >= 2 && SLUG_RE.test(effectiveSlug);

  const save = async () => {
    setSaving(true);
    const { error } = await b2bDb.from("organizations").insert({
      name: name.trim(),
      slug: effectiveSlug,
      type,
      plan_id: planId,
      logo_url: logoUrl.trim() || null,
      plan_ends_at: endOfDayIso(endsOn),
      created_by: userId,
    });
    setSaving(false);
    if (error) {
      toast({ title: "Could not create institution", description: friendlyDbError(error), variant: "destructive" });
      return;
    }
    toast({ title: "Institution created", description: "Next: add their TPO / owner as org admin." });
    qc.invalidateQueries({ queryKey: ["b2b", "all-orgs"] });
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New institution</DialogTitle>
          <DialogDescription>Plans are assigned manually; there is no billing yet.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="org-name">Name</Label>
            <Input id="org-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. SVR Engineering College" />
          </div>
          <div>
            <Label htmlFor="org-slug">Link name</Label>
            <Input
              id="org-slug"
              value={effectiveSlug}
              onChange={(e) => { setSlugTouched(true); setSlug(e.target.value.toLowerCase()); }}
            />
            <p className="text-xs text-muted-foreground mt-1">Used for the public test page: hiresume.in/test/{effectiveSlug || "…"}</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="org-type">Type</Label>
              <Select value={type} onValueChange={(v) => setType(v as OrgType)}>
                <SelectTrigger id="org-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="college">College</SelectItem>
                  <SelectItem value="coaching_institute">Coaching institute</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="org-ends">Plan ends</Label>
              <Input id="org-ends" type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
            </div>
          </div>
          <div>
            <Label htmlFor="plan">Plan</Label>
            <PlanSelect plans={plans} value={planId} onChange={setPlanId} />
          </div>
          <div>
            <Label htmlFor="org-logo">Logo URL (optional)</Label>
            <Input id="org-logo" value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="https://…/logo.png" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={!valid || saving}>{saving ? "Creating…" : "Create"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditPlanDialog({ org, plans, onClose }: { org: OrgWithCounts; plans: Plan[]; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [planId, setPlanId] = useState(org.plan_id);
  const [endsOn, setEndsOn] = useState(toDateInput(org.plan_ends_at));
  const [cap, setCap] = useState(String((org as { public_test_monthly_cap?: number }).public_test_monthly_cap ?? 100));
  const [saving, setSaving] = useState(false);
  const target = plans.find((p) => p.id === planId);
  const overCap = !!target?.max_students && org.student_count > target.max_students;

  const save = async () => {
    setSaving(true);
    const { error } = await b2bDb
      .from("organizations")
      .update({ plan_id: planId, plan_ends_at: endOfDayIso(endsOn), public_test_monthly_cap: Math.max(0, Math.floor(Number(cap) || 0)) })
      .eq("id", org.id);
    setSaving(false);
    if (error) {
      toast({ title: "Could not update plan", description: friendlyDbError(error), variant: "destructive" });
      return;
    }
    toast({ title: "Plan updated" });
    qc.invalidateQueries({ queryKey: ["b2b"] });
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Plan for {org.name}</DialogTitle>
          <DialogDescription>Changes apply immediately. Interviews already used are kept.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="plan">Plan</Label>
            <PlanSelect plans={plans} value={planId} onChange={setPlanId} />
          </div>
          <div>
            <Label htmlFor="edit-ends">Plan ends (leave empty for no end date)</Label>
            <Input id="edit-ends" type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="edit-cap">Free public readiness tests per month</Label>
            <Input id="edit-cap" type="number" min={0} inputMode="numeric" value={cap} onChange={(e) => setCap(e.target.value)} />
            <p className="text-xs text-muted-foreground mt-1">Each test costs model usage (see Costs). Set 0 to switch the public test off.</p>
          </div>
          {overCap && (
            <p className="text-xs text-amber-300">
              {org.student_count} students are enrolled but this plan allows {target!.max_students}. Existing students keep
              access; new students will be refused until the count is under the cap.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddMemberDialog({ org, onClose }: { org: OrgWithCounts; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<OrgMemberRole>("org_admin");
  const [saving, setSaving] = useState(false);
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  const save = async () => {
    setSaving(true);
    const { error } = await b2bDb.rpc("super_add_org_member", {
      _org_id: org.id,
      _email: email.trim(),
      _role: role,
      _full_name: fullName.trim() || null,
    });
    setSaving(false);
    if (error) {
      toast({ title: "Could not add member", description: friendlyDbError(error), variant: "destructive" });
      return;
    }
    toast({ title: "Added", description: `${email.trim()} can now open hiresume.in/org` });
    qc.invalidateQueries({ queryKey: ["b2b"] });
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add staff to {org.name}</DialogTitle>
          <DialogDescription>
            The person must already have a HiResume account. Students join through CSV invites instead.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="m-email">Email</Label>
            <Input id="m-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="m-name">Name (optional)</Label>
            <Input id="m-name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="m-role">Role</Label>
            <Select value={role} onValueChange={(v) => setRole(v as OrgMemberRole)}>
              <SelectTrigger id="m-role"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="org_admin">Org admin (TPO / dean / owner)</SelectItem>
                <SelectItem value="trainer">Trainer (read-only)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={!valid || saving}>{saving ? "Adding…" : "Add"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
