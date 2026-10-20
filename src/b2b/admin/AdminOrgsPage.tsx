import { useState } from "react";
import { Navigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { V1Shell, Loading, Empty } from "../layout/V1Shell";
import { adminApi } from "../lib/api";
import type { OrgRow } from "../types";
import { CreateOrgDialog } from "./CreateOrgDialog";
import { CreditsDialog, InviteStaffDialog } from "./OrgActions";
import { ORG_TYPE_LABEL, ROLE_LABEL, fmtDate, friendly, num, useIsSuperAdmin, useOrgs, usePlans, useStaffInvites } from "./queries";

export const ADMIN_TABS = [
  { to: "/admin/orgs", label: "Organisations" },
  { to: "/admin/usage", label: "Usage" },
  { to: "/admin/costs", label: "AI costs" },
  { to: "/admin/enquiries", label: "Enquiries" },
];

export default function AdminOrgsPage() {
  const isSuper = useIsSuperAdmin();
  const enabled = isSuper.data === true;
  const orgs = useOrgs(enabled);
  const plans = usePlans(enabled);
  const invites = useStaffInvites(enabled);
  const qc = useQueryClient();
  const { toast } = useToast();
  const [creating, setCreating] = useState(false);
  const [inviting, setInviting] = useState<OrgRow | null>(null);
  const [crediting, setCrediting] = useState<OrgRow | null>(null);
  const [lastLink, setLastLink] = useState<{ email: string; link: string } | null>(null);

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

  return (
    <V1Shell title="Super admin" subtitle="Colleges and companies" tabs={ADMIN_TABS}
             actions={<Button size="sm" onClick={() => setCreating(true)}><Plus className="h-4 w-4 mr-1" />New organisation</Button>}>
      {lastLink && (
        <div role="status" className="mb-4 rounded-lg border border-primary/40 bg-primary/10 p-3 text-sm">
          Invite link for <b>{lastLink.email}</b> (email isn't configured yet, share it directly):
          <div className="mt-1 flex gap-2 items-center">
            <code className="truncate text-xs">{lastLink.link}</code>
            <Button size="sm" variant="outline" onClick={() => { void navigator.clipboard?.writeText(lastLink.link); toast({ title: "Link copied" }); }}>Copy</Button>
          </div>
        </div>
      )}
      {orgs.isLoading ? <Loading /> : orgs.error ? (
        <Empty title="Couldn't load organisations" body={friendly(orgs.error)} />
      ) : !orgs.data?.length ? (
        <Empty title="No organisations yet" body="Create a college or a company to get started.">
          <Button onClick={() => setCreating(true)}>New organisation</Button>
        </Empty>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Organisation</TableHead><TableHead>Plan</TableHead><TableHead className="text-right">Credits</TableHead>
              <TableHead>Valid until</TableHead><TableHead>Pending invites</TableHead><TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {orgs.data.map((o) => (
              <TableRow key={o.id}>
                <TableCell>
                  <div className="font-medium">{o.name}</div>
                  <div className="flex gap-1 mt-1">
                    <Badge variant="outline">{ORG_TYPE_LABEL[o.type] ?? o.type}</Badge>
                    {o.status === "suspended" && <Badge variant="destructive">Suspended</Badge>}
                    {o.is_demo && <Badge variant="outline">Demo</Badge>}
                  </div>
                </TableCell>
                <TableCell>{o.plan_id}{o.seat_limit ? ` · ${o.seat_limit} seats` : ""}</TableCell>
                <TableCell className="text-right tabular-nums">{num(o.credits_balance)}</TableCell>
                <TableCell>{fmtDate(o.plan_ends_at)}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {pendingFor(o.id).map((i) => <div key={i.id}>{i.email} · {ROLE_LABEL[i.role]}</div>)}
                </TableCell>
                <TableCell className="text-right whitespace-nowrap">
                  <Button size="sm" variant="ghost" onClick={() => setInviting(o)}>Invite</Button>
                  <Button size="sm" variant="ghost" onClick={() => setCrediting(o)}>Credits</Button>
                  <Button size="sm" variant="ghost" onClick={() => setStatus(o, o.status === "active" ? "suspended" : "active")}>
                    {o.status === "active" ? "Suspend" : "Reactivate"}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <CreateOrgDialog open={creating} onOpenChange={setCreating} plans={plans.data ?? []}
        onCreated={(c) => {
          toast({ title: `${c.name} created`, description: `${c.credits} credits${c.inviteLink ? (c.emailed ? " · invite emailed" : " · invite link below") : ""}` });
          if (c.inviteLink && !c.emailed) setLastLink({ email: "the admin", link: c.inviteLink });
          refresh();
        }} />
      <InviteStaffDialog org={inviting} onClose={() => setInviting(null)}
        onInvited={(r) => { toast({ title: r.emailed ? `Invite emailed to ${r.email}` : "Invite created" }); if (!r.emailed) setLastLink(r); refresh(); }} />
      <CreditsDialog org={crediting} onClose={() => setCrediting(null)} onChanged={refresh} />
    </V1Shell>
  );
}
