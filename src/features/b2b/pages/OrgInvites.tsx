import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Copy, Mail, MoreHorizontal, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { CenteredSpinner, EmptyState } from "../components/B2BShell";
import { useOrgInvites } from "../hooks/useB2B";
import { invitesApi } from "../lib/api";
import { formatDate, friendlyDbError } from "../lib/format";
import type { OrgInvite } from "../types";
import { displayStatus, type InviteDisplayStatus } from "../lib/status";
import { useOrgContext } from "../components/OrgContext";

type DisplayStatus = InviteDisplayStatus;

const STATUS_BADGE: Record<DisplayStatus, string> = {
  pending: "border-sky-500/40 text-sky-300",
  accepted: "border-emerald-500/40 text-emerald-300",
  revoked: "border-border text-muted-foreground",
  expired: "border-amber-500/40 text-amber-300",
};
const STATUS_LABEL: Record<DisplayStatus, string> = {
  pending: "Invited", accepted: "Joined", revoked: "Withdrawn", expired: "Link expired",
};

/** /org/:orgId/invites */
export default function OrgInvites() {
  const { org, canManage } = useOrgContext();
  const q = useOrgInvites(org.id);
  const qc = useQueryClient();
  const { toast } = useToast();
  const [status, setStatus] = useState<"all" | DisplayStatus>("all");
  const [batch, setBatch] = useState("all");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const batchName = useMemo(() => new Map((q.data?.batches ?? []).map((b) => [b.id, b.name])), [q.data]);
  const counts = useMemo(() => {
    const c: Record<DisplayStatus, number> = { pending: 0, accepted: 0, revoked: 0, expired: 0 };
    for (const i of q.data?.invites ?? []) c[displayStatus(i)]++;
    return c;
  }, [q.data]);
  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (q.data?.invites ?? []).filter((i) =>
      (status === "all" || displayStatus(i) === status) &&
      (batch === "all" || i.batch_id === batch) &&
      (!term || [i.full_name, i.email, i.roll_no].some((v) => v.toLowerCase().includes(term))));
  }, [q.data, status, batch, search]);

  const run = async (id: string, fn: () => Promise<void>) => {
    setBusy(id);
    try {
      await fn();
      qc.invalidateQueries({ queryKey: ["b2b", "org-invites", org.id] });
    } catch (e) {
      toast({ title: "That didn't work", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const copyNewLink = (i: OrgInvite) => run(i.id, async () => {
    const { link } = await invitesApi.resend(i.id, false);
    await navigator.clipboard.writeText(link);
    toast({ title: "New link copied", description: `Send it to ${i.full_name}. Their previous link no longer works.` });
  });
  const resendEmail = (i: OrgInvite) => run(i.id, async () => {
    const r = await invitesApi.resend(i.id, true);
    if (r.email.error) {
      await navigator.clipboard.writeText(r.link).catch(() => {});
      toast({ title: "Email not sent", description: `${r.email.error} A new link was copied to your clipboard.`, variant: "destructive" });
    } else toast({ title: "Invite email sent", description: i.email });
  });
  const revoke = (i: OrgInvite) => run(i.id, async () => {
    if (!window.confirm(`Withdraw ${i.full_name}'s invite? Their link will stop working.`)) return;
    await invitesApi.revoke(i.id);
    toast({ title: "Invite withdrawn" });
  });

  if (q.isLoading) return <CenteredSpinner />;
  if (q.error) return <EmptyState title="Couldn't load invites" body={friendlyDbError(q.error)} />;
  if (!q.data?.invites.length) {
    return (
      <EmptyState title="No invites yet" body="Upload your student roster to invite a batch.">
        {canManage && <Button asChild><Link to={`/org/${org.id}/import`}>Add students</Link></Button>}
      </EmptyState>
    );
  }

  return (
    <>
      <div className="flex flex-wrap gap-2 mb-4 text-sm">
        {(["accepted", "pending", "expired", "revoked"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatus(status === s ? "all" : s)}
            className={`rounded-full border px-3 py-1 ${status === s ? "bg-white/10 border-violet-400" : "border-border/60 hover:bg-white/5"}`}
            aria-pressed={status === s}
          >
            {STATUS_LABEL[s]} <span className="tabular-nums text-muted-foreground">{counts[s]}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 mb-3">
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, email or roll no" className="max-w-xs" aria-label="Search invites" />
        <Select value={batch} onValueChange={setBatch}>
          <SelectTrigger className="w-48" aria-label="Filter by batch"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All batches</SelectItem>
            {(q.data.batches ?? []).map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-lg border border-border/60 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Roll no</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Batch</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Email</TableHead>
              {canManage && <TableHead className="w-12"><span className="sr-only">Actions</span></TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((i) => {
              const ds = displayStatus(i);
              return (
                <TableRow key={i.id}>
                  <TableCell className="tabular-nums">{i.roll_no}</TableCell>
                  <TableCell>
                    {i.full_name}
                    <div className="text-xs text-muted-foreground">{i.email}</div>
                  </TableCell>
                  <TableCell>{(i.batch_id && batchName.get(i.batch_id)) ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={STATUS_BADGE[ds]}>{STATUS_LABEL[ds]}</Badge>
                    {ds === "accepted" && <div className="text-xs text-muted-foreground mt-0.5">{formatDate(i.accepted_at)}</div>}
                  </TableCell>
                  <TableCell className="text-xs">
                    {i.email_error ? <span className="text-amber-300" title={i.email_error}>Not sent</span>
                      : i.email_sent_at ? <span className="text-muted-foreground">Sent {formatDate(i.email_sent_at)}</span>
                      : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  {canManage && (
                    <TableCell>
                      {(ds === "pending" || ds === "expired") && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" disabled={busy === i.id} aria-label={`Actions for ${i.full_name}`}>
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => copyNewLink(i)}><Copy className="h-4 w-4 mr-2" /> Copy new link</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => resendEmail(i)}><Mail className="h-4 w-4 mr-2" /> Resend email</DropdownMenuItem>
                            {ds === "pending" && (
                              <DropdownMenuItem onClick={() => revoke(i)} className="text-red-300"><XCircle className="h-4 w-4 mr-2" /> Withdraw invite</DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      {rows.length === 0 && <p className="text-sm text-muted-foreground mt-3">No invites match these filters.</p>}
    </>
  );
}
