import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loading, Empty } from "../layout/V1Shell";
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
        <h2 className="text-lg font-semibold">Roles</h2>
        {isEditor && <Button asChild><Link to={`/co/${orgId}/roles/new`}>New role from a JD</Link></Button>}
      </div>
      {list.length === 0 ? (
        <Empty title="No roles yet" body={isEditor ? "Paste a job description and HiResume suggests a skills matrix you can edit." : "Roles assigned to you will show here."} />
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {list.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 p-4">
              <div className="min-w-0 flex-1">
                <Link to={`/co/${orgId}/roles/${r.id}`} className="font-medium hover:underline">{r.title}</Link>
                <p className="text-xs text-muted-foreground">Created {fmtDate(r.created_at)} · {r.counts.total} invited · {r.counts.completed} completed</p>
              </div>
              <Badge variant={r.status === "open" ? "default" : "secondary"}>{STATUS[r.status]}</Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
