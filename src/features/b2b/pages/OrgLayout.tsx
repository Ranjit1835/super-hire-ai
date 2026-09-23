import { Navigate, Outlet, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { B2BShell, CenteredSpinner, EmptyState, type ShellTab } from "../components/B2BShell";
import { useIsSuperAdmin, useMyMemberships } from "../hooks/useB2B";
import { b2bDb } from "../lib/db";
import type { Organization } from "../types";
import { OrgContext, type ViewerRole } from "../components/OrgContext";

/** /org → the first institution the user staffs. */
export function OrgRedirect() {
  const memberships = useMyMemberships();
  const isSuper = useIsSuperAdmin();
  if (memberships.isLoading || isSuper.isLoading) return <CenteredSpinner />;
  const staff = memberships.data?.find((m) => m.role !== "student");
  if (staff) return <Navigate to={`/org/${staff.org_id}`} replace />;
  if (memberships.data?.some((m) => m.role === "student")) return <Navigate to="/learn" replace />;
  if (isSuper.data) return <Navigate to="/admin/orgs" replace />;
  return <Navigate to="/dashboard" replace />;
}

/** /org/:orgId/* — loads the org once, resolves the viewer's role, renders tabs. */
export function OrgLayout() {
  const { orgId } = useParams();
  const memberships = useMyMemberships();
  const isSuper = useIsSuperAdmin();
  const org = useQuery({
    queryKey: ["b2b", "org", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await b2bDb.from("organizations").select("*").eq("id", orgId!).maybeSingle();
      if (error) throw error;
      return data as Organization | null;
    },
  });

  if (org.isLoading || memberships.isLoading || isSuper.isLoading) return <CenteredSpinner />;

  const membership = memberships.data?.find((m) => m.org_id === orgId);
  const role: ViewerRole | null = isSuper.data ? "super_admin" : membership?.role ?? null;

  if (!org.data || !role) {
    return (
      <B2BShell title="Institution">
        <EmptyState title="You don't have access to this institution" body="Ask your placement office to add you, or sign in with a different account." />
      </B2BShell>
    );
  }
  if (role === "student") return <Navigate to="/learn" replace />;

  const canManage = role === "org_admin" || role === "super_admin";
  const base = `/org/${org.data.id}`;
  const tabs: ShellTab[] = [
    { to: base, label: "Overview", end: true },
    { to: `${base}/modules`, label: "Modules" },
    { to: `${base}/invites`, label: "Invites" },
    ...(canManage ? [{ to: `${base}/import`, label: "Add students" }] : []),
  ];

  return (
    <OrgContext.Provider value={{ org: org.data, role, canManage }}>
      <B2BShell
        title={org.data.name}
        subtitle={role === "super_admin" ? "Viewing as super-admin" : role === "trainer" ? "Trainer (view only)" : "Institution admin"}
        logoUrl={org.data.logo_url}
        isDemo={org.data.is_demo}
        tabs={tabs}
      >
        <Outlet />
      </B2BShell>
    </OrgContext.Provider>
  );
}
