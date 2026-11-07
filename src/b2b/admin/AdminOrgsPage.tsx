import { useState } from "react";
import { Navigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { V1Shell, Loading, Empty } from "../layout/V1Shell";
import { Chip } from "../ui/broadcast";
import { adminApi } from "../lib/api";
import type { OrgRow } from "../types";
import { CreateOrgDialog } from "./CreateOrgDialog";
import { CreditsDialog, InviteStaffDialog, SettingsDialog } from "./OrgActions";
import { ORG_TYPE_LABEL, ROLE_LABEL, alertText, fmtDate, friendly, num, useIsSuperAdmin, useOrgAlerts, useOrgs, usePlans, useStaffInvites } from "./queries";

export const ADMIN_TABS = [
  { to: "/admin/orgs", label: "Organisations" },
  { to: "/admin/usage", label: "Usage" },
  { to: "/admin/costs", label: "AI costs" },
  { to: "/admin/enquiries", label: "Enquiries" },
];

/** `demoInviteLink` seeds the just-created-invite panel for the gallery only; the live page never passes it. */
export default function AdminOrgsPage({ demoInviteLink }: { demoInviteLink?: { email: string; link: string } } = {}) {
  const isSuper = useIsSuperAdmin();
  const enabled = isSuper.data === true;
  const orgs = useOrgs(enabled);
  const alerts = useOrgAlerts(enabled);
  const plans = usePlans(enabled);
  const invites = useStaffInvites(enabled);
  const qc = useQueryClient();
  const { toast } = useToast();
  const [creating, setCreating] = useState(false);
  const [inviting, setInviting] = useState<OrgRow | null>(null);
  const [crediting, setCrediting] = useState<OrgRow | null>(null);
  const [configuring, setConfiguring] = useState<OrgRow | null>(null);
  const [lastLink, setLastLink] = useState<{ email: string; link: string } | null>(demoInviteLink ?? null);

  if (isSuper.isLoading) return <V1Shell title="Super admin"><Loading /></V1Shell>;
  if (!enabled) return <Navigate to="/dashboard" replace />;
  const refresh = () => { void qc.invalidateQueries({ queryKey: ["b2b-v1"] }); };

  const setStatus = async (org: OrgRow, status: "active" | "suspended") => {
    try {
      await adminApi("updateOrg", { orgId: org.id, status });
      toast({ title: status === "suspended" ? `${org.name} suspended` : `${org.name} reactivated` });
      refresh();
    } catch (e) { toast({ title: "Couldn't change status", description: friendly(e), variant: "destructive" }); }
  };

  const pendingFor = (orgId: string) => (invites.data ?? []).filter((i) => i.org_id === orgId);
  const colleges = orgs.data?.filter((o) => o.type === "college").length;
  const companies = orgs.data?.filter((o) => o.type === "company").length;
  const count = (n: number | undefined, one: string, many = `${one}s`) => (n === undefined ? `– ${many}` : `${n} ${n === 1 ? one : many}`);

  return (
    <V1Shell title="Super admin" subtitle="Colleges and companies" tabs={ADMIN_TABS}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="hr-display text-[22px]">Organisations</h2>
            <p className="text-sm text-[var(--hr-muted)] mt-1.5">Every college and company on HiResume, with plan, credits and staff invites.</p>
            <p className="hr-data text-sm text-foreground mt-1.5">
              {count(orgs.data?.length, "organisation")} · {count(colleges, "college")} · {count(companies, "company", "companies")} · {count(invites.data?.length, "pending invite")}
            </p>
          </div>
          <Button size="sm" onClick={() => setCreating(true)}><Plus className="h-4 w-4 mr-1" />New organisation</Button>
        </div>

        {/* R1.9: low credits, plans ending or ended, seats nearly full. Also emailed daily (b2b-alerts). */}
        {!!alerts.data?.length && (
          <section aria-label="Alerts" className="bg-[var(--hr-surface)] shadow-[inset_0_0_0_1px_var(--hr-orange)] px-4 py-3">
            <p className="hr-label">Needs attention</p>
            <ul className="mt-1.5 space-y-1 text-sm">
              {alerts.data.map((a) => (
                <li key={`${a.org_id}-${a.kind}`}>
                  <b className="text-foreground">{a.org_name}</b>: <span className={a.kind === "plan_expired" ? "text-[var(--hr-red-ink)]" : ""}>{alertText(a)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {lastLink && (
          <div role="status" className="bg-[var(--hr-surface)] shadow-[inset_0_0_0_1px_var(--hr-rule)] px-4 py-3">
            <p className="hr-label">Invite link</p>
            <p className="text-sm mt-1">For <b className="text-foreground">{lastLink.email}</b>. Email isn't configured yet, so share this link directly.</p>
            <div className="mt-2 flex gap-2 items-center">
              <code className="hr-data truncate text-xs flex-1 text-[var(--hr-blue-ink)]">{lastLink.link}</code>
              <Button size="sm" variant="outline" onClick={() => { void navigator.clipboard?.writeText(lastLink.link); toast({ title: "Link copied" }); }}>Copy</Button>
            </div>
          </div>
        )}

        {orgs.isLoading ? <Loading /> : orgs.error ? (
          <Empty title="Couldn't load organisations" body={friendly(orgs.error)} />
        ) : !orgs.data?.length ? (
          <Empty stage={[{ label: "Create", state: "current" }, { label: "Invite", state: "todo" }, { label: "Credits", state: "todo" }]}
                 title="No organisations yet" body="Create a college or a company to get started.">
            <Button onClick={() => setCreating(true)}>New organisation</Button>
          </Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="hr-label">Organisation</TableHead><TableHead className="hr-label">Plan</TableHead>
                <TableHead className="hr-label text-right">Credits</TableHead>
                <TableHead className="hr-label">Valid until</TableHead><TableHead className="hr-label">Pending invites</TableHead>
                <TableHead className="hr-label text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orgs.data.map((o) => (
                <TableRow key={o.id}>
                  <TableCell className="py-2.5">
                    <div className="font-medium">{o.name}</div>
                    <div className="flex gap-1.5 mt-1 items-center">
                      <Chip>{ORG_TYPE_LABEL[o.type] ?? o.type}</Chip>
                      {o.status === "suspended" && <Chip tone="red">Suspended</Chip>}
                      {o.is_demo && <Chip tone="muted">Demo</Chip>}
                    </div>
                  </TableCell>
                  <TableCell className="py-2.5">
                    <span className="hr-data text-sm">{o.plan_id}</span>
                    {o.seat_limit ? <span className="text-xs text-[var(--hr-muted)]"> · {o.seat_limit} seats</span> : null}
                  </TableCell>
                  <TableCell className="py-2.5 text-right"><span className="hr-data text-sm">{num(o.credits_balance)}</span></TableCell>
                  <TableCell className="py-2.5"><span className="hr-data text-sm">{fmtDate(o.plan_ends_at)}</span></TableCell>
                  <TableCell className="py-2.5 text-xs text-[var(--hr-muted)]">
                    {pendingFor(o.id).map((i) => <div key={i.id}>{i.email} · {ROLE_LABEL[i.role]}</div>)}
                  </TableCell>
                  <TableCell className="py-2.5 text-right whitespace-nowrap">
                    <Button size="sm" variant="ghost" onClick={() => setInviting(o)}>Invite</Button>
                    <Button size="sm" variant="ghost" onClick={() => setCrediting(o)}>Credits</Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfiguring(o)}>Costs &amp; limits</Button>
                    <Button size="sm" variant="ghost" onClick={() => setStatus(o, o.status === "active" ? "suspended" : "active")}>
                      {o.status === "active" ? "Suspend" : "Reactivate"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
      <CreateOrgDialog open={creating} onOpenChange={setCreating} plans={plans.data ?? []}
        onCreated={(c) => {
          toast({ title: `${c.name} created`, description: `${c.credits} credits${c.inviteLink ? (c.emailed ? " · invite emailed" : " · invite link below") : ""}` });
          if (c.inviteLink && !c.emailed) setLastLink({ email: "the admin", link: c.inviteLink });
          refresh();
        }} />
      <InviteStaffDialog org={inviting} onClose={() => setInviting(null)}
        onInvited={(r) => { toast({ title: r.emailed ? `Invite emailed to ${r.email}` : "Invite created" }); if (!r.emailed) setLastLink(r); refresh(); }} />
      <CreditsDialog org={crediting} onClose={() => setCrediting(null)} onChanged={refresh} />
      {configuring && <SettingsDialog key={configuring.id} org={configuring} onClose={() => setConfiguring(null)} onSaved={refresh} />}
    </V1Shell>
  );
}
