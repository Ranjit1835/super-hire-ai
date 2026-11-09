import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loading, Empty } from "../layout/V1Shell";
import { Chip } from "../ui/broadcast";
import { CompanyShell } from "./CompanyShell";
import { fmtDate, useRoles } from "./queries";

const STATUS: Record<string, string> = { draft: "Draft", open: "Open", closed: "Closed" };

export default function RolesPage() {
  return <CompanyShell>{({ orgId, isEditor }) => <Roles orgId={orgId} isEditor={isEditor} />}</CompanyShell>;
}

export function Roles({ orgId, isEditor }: { orgId: string; isEditor: boolean }) {
  const roles = useRoles(orgId);
  if (roles.isLoading) return <Loading />;
  if (roles.error) return <p role="alert" className="text-sm text-destructive">{(roles.error as Error).message}</p>;
  const list = roles.data ?? [];
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="hr-display text-[22px]">Roles</h2>
        {isEditor && <Button asChild><Link to={`/co/${orgId}/roles/new`}>New role from a JD</Link></Button>}
      </div>
      {list.length === 0 ? (
        <Empty stage title="No roles yet"
               body={isEditor ? "Paste a job description and HiResume suggests a skills matrix you can edit." : "Roles assigned to you will show here."}>
          {isEditor && <Button asChild><Link to={`/co/${orgId}/roles/new`}>New role from a JD</Link></Button>}
        </Empty>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="hr-label">Role</TableHead>
              <TableHead className="hr-label">Created</TableHead>
              <TableHead className="hr-label text-right">Invited</TableHead>
              <TableHead className="hr-label text-right">Completed</TableHead>
              <TableHead className="hr-label">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  <Link to={`/co/${orgId}/roles/${r.id}`} className="hr-display text-[15px] hover:text-[var(--hr-orange)]">{r.title}</Link>
                </TableCell>
                <TableCell className="text-sm text-[var(--hr-muted)]">{fmtDate(r.created_at)}</TableCell>
                <TableCell className="hr-data text-sm text-right">{r.counts.total}</TableCell>
                <TableCell className="hr-data text-sm text-right">
                  <span className={r.counts.completed > 0 ? "text-[var(--hr-gold)]" : undefined}>{r.counts.completed}</span>
                </TableCell>
                <TableCell><Chip tone={r.status === "open" ? "blue" : "muted"} solid={r.status === "open"}>{STATUS[r.status]}</Chip></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
