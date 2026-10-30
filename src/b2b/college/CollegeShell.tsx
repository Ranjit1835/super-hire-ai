import type { ReactNode, SelectHTMLAttributes } from "react";
import { Navigate, useParams } from "react-router-dom";
import { cn } from "@/lib/utils";
import { V1Shell, Loading, Empty, CreditsTag } from "../layout/V1Shell";
import { useCollegeAccess, useMyColleges, useOrg } from "./queries";

export const collegeTabs = (orgId: string) => [
  { to: `/c/${orgId}/students`, label: "Students" },
  { to: `/c/${orgId}/drives`, label: "Drives" },
  { to: `/assess/tests/${orgId}`, label: "Tests" },
  { to: `/assess/bank/${orgId}`, label: "Question bank" },
  { to: `/c/${orgId}/analytics`, label: "Analytics" },
  { to: `/c/${orgId}/settings`, label: "Credits & team" },
];

export interface CollegeCtx { orgId: string; isAdmin: boolean; orgName: string; /** Super admin: the only role that manages staff (R3.3). */ isSuper: boolean }

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
    <V1Shell title={name} subtitle={access.data.isAdmin ? "TPO admin" : "Trainer"} tabs={collegeTabs(orgId)} actions={actions}
             aside={<CreditsTag value={org.data?.credits_balance} />}>
      {children({ orgId, isAdmin: access.data.isAdmin, orgName: name, isSuper: access.data.isSuper })}
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

/** Native select, broadcast-world: square corners, ground surface, keyboard- and test-friendly. */
export function NativeSelect({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "h-10 w-full border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
      {...props}
    />
  );
}

/** A filter toggle: square frame, orange when on. No rounded pill (hard edges only). */
export function CheckChip({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className={cn(
      "inline-flex items-center gap-1.5 min-h-9 border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] cursor-pointer transition-colors focus-within:ring-2 focus-within:ring-[var(--hr-orange)]",
      checked ? "border-[var(--hr-orange)] text-[var(--hr-orange)] bg-[var(--hr-orange)]/10" : "border-[var(--hr-rule)] text-[var(--hr-muted)] hover:text-foreground")}>
      <input type="checkbox" className="sr-only peer" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span aria-hidden className={cn("h-3 w-3 shrink-0 border", checked ? "border-[var(--hr-orange)] bg-[var(--hr-orange)]" : "border-[var(--hr-rule)]")} />
      {label}
    </label>
  );
}

export function toggle<T>(list: T[], v: T, on: boolean): T[] {
  return on ? (list.includes(v) ? list : [...list, v]) : list.filter((x) => x !== v);
}
