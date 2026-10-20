import type { ReactNode, SelectHTMLAttributes } from "react";
import { Navigate, useParams } from "react-router-dom";
import { cn } from "@/lib/utils";
import { V1Shell, Loading, Empty } from "../layout/V1Shell";
import { useCollegeAccess, useMyColleges, useOrg } from "./queries";

export const collegeTabs = (orgId: string) => [
  { to: `/c/${orgId}/students`, label: "Students" },
  { to: `/c/${orgId}/drives`, label: "Drives" },
  { to: `/c/${orgId}/analytics`, label: "Analytics" },
  { to: `/c/${orgId}/settings`, label: "Credits & team" },
];

export interface CollegeCtx { orgId: string; isAdmin: boolean; orgName: string }

/** Portal frame for TPO admins and trainers; everyone else gets a polite dead end. */
export function CollegeShell({ children, actions }: { children: (ctx: CollegeCtx) => ReactNode; actions?: ReactNode }) {
  const { orgId = "" } = useParams();
  const access = useCollegeAccess(orgId);
  const org = useOrg(access.data?.staff ? orgId : undefined);
  if (access.isLoading || (access.data?.staff && org.isLoading)) return <V1Shell title="College portal"><Loading /></V1Shell>;
  if (!access.data?.staff) {
    return (
      <V1Shell title="College portal">
        <Empty title="You don't have access to this college" body="Ask your placement office (TPO) to invite you as an admin or trainer." />
      </V1Shell>
    );
  }
  const name = org.data?.name ?? "College";
  return (
    <V1Shell title={name} subtitle={access.data.isAdmin ? "TPO admin" : "Trainer"} tabs={collegeTabs(orgId)} actions={actions}>
      {children({ orgId, isAdmin: access.data.isAdmin, orgName: name })}
    </V1Shell>
  );
}

/** /c: go to my college (or list them when there are several). */
export function CollegeRedirect() {
  const mine = useMyColleges();
  if (mine.isLoading) return <V1Shell title="College portal"><Loading /></V1Shell>;
  const list = mine.data ?? [];
  if (list.length === 1) return <Navigate to={`/c/${list[0].id}/students`} replace />;
  return (
    <V1Shell title="College portal">
      {list.length === 0 ? (
        <Empty title="No college yet" body="This account isn't a TPO admin or trainer of any college." />
      ) : (
        <ul className="space-y-2">
          {list.map((o) => (
            <li key={o.id}><a className="underline" href={`/c/${o.id}/students`}>{o.name}</a></li>
          ))}
        </ul>
      )}
    </V1Shell>
  );
}

/** Native select styled like the shadcn inputs (keyboard- and test-friendly). */
export function NativeSelect({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn("h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring", className)}
      {...props}
    />
  );
}

export function CheckChip({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className={cn("inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm cursor-pointer",
      checked ? "border-primary bg-primary/10" : "border-border")}>
      <input type="checkbox" className="accent-current" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

export function toggle<T>(list: T[], v: T, on: boolean): T[] {
  return on ? (list.includes(v) ? list : [...list, v]) : list.filter((x) => x !== v);
}
