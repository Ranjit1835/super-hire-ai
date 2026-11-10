import type { ShellTab } from "../layout/V1Shell";
import { ADMIN_TABS } from "../admin/tabs";
import { collegeTabs } from "../college/CollegeShell";
import { companyTabs } from "../company/CompanyShell";
import { useCollegeAccess, useOrg } from "../college/queries";

/**
 * Tests and the question bank live outside the portals' own routes, but they are part of the same portal: show the
 * tabs of the portal this org belongs to (college or company, by role), so Students and Drives stay one click away.
 * The global bank belongs to the super admin's sections.
 */
export function useAssessTabs(orgParam: string): ShellTab[] {
  const global = orgParam === "global";
  const access = useCollegeAccess(global ? undefined : orgParam);
  const a = access.data;
  const org = useOrg(a && (a.isSuper || a.role) ? orgParam : undefined);
  if (global) return ADMIN_TABS;
  if (!a || !org.data) return [];
  if (org.data.type === "company") return companyTabs(orgParam, a.isSuper || a.role === "org_admin" || a.role === "recruiter");
  return collegeTabs(orgParam, a.isAdmin);
}
