import { createContext, useContext } from "react";
import type { OrgMemberRole, Organization } from "../types";

export type ViewerRole = OrgMemberRole | "super_admin";

export interface OrgCtx {
  org: Organization;
  role: ViewerRole;
  /** Can import / invite / revoke (org admin or super-admin). */
  canManage: boolean;
}

export const OrgContext = createContext<OrgCtx | null>(null);

export function useOrgContext(): OrgCtx {
  const v = useContext(OrgContext);
  if (!v) throw new Error("useOrgContext must be used inside <OrgLayout>");
  return v;
}
