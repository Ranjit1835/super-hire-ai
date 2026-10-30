import type { ReactNode } from "react";
import { Navigate, useParams } from "react-router-dom";
import { V1Shell, Loading, Empty, CreditsTag } from "../layout/V1Shell";
import { useCompanyAccess, useCompanyOrg, useMyCompanies, type CompanyRole } from "./queries";

export const companyTabs = (orgId: string, editor: boolean) => [
  { to: `/co/${orgId}/roles`, label: "Roles" },
  ...(editor ? [{ to: `/assess/tests/${orgId}`, label: "Tests" }, { to: `/assess/bank/${orgId}`, label: "Question bank" }] : []),
  { to: `/co/${orgId}/settings`, label: "Credits & team" },
];

const ROLE_TEXT: Record<CompanyRole, string> = { org_admin: "Company admin", recruiter: "Recruiter", hiring_manager: "Hiring manager" };

export interface CompanyCtx { orgId: string; orgName: string; isAdmin: boolean; isEditor: boolean; role: CompanyRole | null; /** Super admin: the only role that manages staff (R3.3). */ isSuper: boolean }

/** Portal frame for company admins, recruiters and hiring managers. */
export function CompanyShell({ children, actions }: { children: (ctx: CompanyCtx) => ReactNode; actions?: ReactNode }) {
  const { orgId = "" } = useParams();
  const access = useCompanyAccess(orgId);
  const org = useCompanyOrg(access.data?.staff ? orgId : undefined);
  if (access.isLoading || (access.data?.staff && org.isLoading)) return <V1Shell title="Company portal"><Loading /></V1Shell>;
  if (!access.data?.staff || (org.data && org.data.type !== "company")) {
    return (
      <V1Shell title="Company portal">
        <Empty title="You don't have access to this company" body="Ask your company admin to invite you as a recruiter or hiring manager." />
      </V1Shell>
    );
  }
  const name = org.data?.name ?? "Company";
  const a = access.data;
  return (
    <V1Shell title={name} subtitle={a.isSuper && !a.role ? "Super admin" : a.role ? ROLE_TEXT[a.role] : undefined}
             tabs={companyTabs(orgId, a.isEditor)} actions={actions} aside={<CreditsTag value={org.data?.credits_balance} />}>
      {children({ orgId, orgName: name, isAdmin: a.isAdmin, isEditor: a.isEditor, role: a.role, isSuper: a.isSuper })}
    </V1Shell>
  );
}

/** /co: my company (or a list when there are several). */
export function CompanyRedirect() {
  const mine = useMyCompanies();
  if (mine.isLoading) return <V1Shell title="Company portal"><Loading /></V1Shell>;
  const list = mine.data ?? [];
  if (list.length === 1) return <Navigate to={`/co/${list[0].id}/roles`} replace />;
  return (
    <V1Shell title="Company portal">
      {list.length === 0 ? (
        <Empty stage title="No company yet" body="This account isn't on a company team." />
      ) : (
        <ul className="divide-y divide-[var(--hr-rule)]">
          {list.map((o) => (
            <li key={o.id}>
              <a className="hr-display text-[15px] block py-3 hover:text-[var(--hr-orange)]" href={`/co/${o.id}/roles`}>{o.name}</a>
            </li>
          ))}
        </ul>
      )}
    </V1Shell>
  );
}
