// Routes owned by the "company" area of B2B V1 (startup portal, candidate token flow, share links).
// Registered in src/b2b/routes.tsx (only when VITE_B2B_ENABLED=true).
import { lazy, Suspense, type ReactNode } from "react";
import { Navigate, useParams, type RouteObject } from "react-router-dom";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { Loading } from "../layout/V1Shell";

const RolesPage = lazy(() => import("./RolesPage"));
const RoleFormPage = lazy(() => import("./RoleFormPage"));
const RolePage = lazy(() => import("./RolePage"));
const ReportPage = lazy(() => import("./ReportPage"));
const SettingsPage = lazy(() => import("./SettingsPage"));
const PortalRedirect = lazy(() => import("./PortalRedirect"));
const CompanyRedirect = lazy(() => import("./CompanyShell").then((m) => ({ default: m.CompanyRedirect })));
const TokenFlowPage = lazy(() => import("../candidate/TokenFlowPage"));
const ResumeLastToken = lazy(() => import("../candidate/TokenFlowPage").then((m) => ({ default: m.ResumeLastToken })));
const SharePage = lazy(() => import("../candidate/SharePage"));

const page = (el: ReactNode) => <ProtectedRoute><Suspense fallback={<Loading />}>{el}</Suspense></ProtectedRoute>;
// Candidates and share-link viewers have no account: no ProtectedRoute.
const open = (el: ReactNode) => <Suspense fallback={<Loading />}>{el}</Suspense>;

function OrgIndex() {
  const { orgId } = useParams();
  return <Navigate to={`/co/${orgId}/roles`} replace />;
}

export const companyRoutes: RouteObject[] = [
  { path: "/co", element: page(<CompanyRedirect />) },
  { path: "/co/:orgId", element: page(<OrgIndex />) },
  { path: "/co/:orgId/roles", element: page(<RolesPage />) },
  { path: "/co/:orgId/roles/new", element: page(<RoleFormPage />) },
  { path: "/co/:orgId/roles/:roleId", element: page(<RolePage />) },
  { path: "/co/:orgId/roles/:roleId/edit", element: page(<RoleFormPage />) },
  { path: "/co/:orgId/candidates/:roleCandidateId", element: page(<ReportPage />) },
  { path: "/co/:orgId/settings", element: page(<SettingsPage />) },
  { path: "/portal/:orgId", element: page(<PortalRedirect />) },
  { path: "/t", element: open(<ResumeLastToken />) },
  { path: "/t/:token", element: open(<TokenFlowPage />) },
  { path: "/share/:token", element: open(<SharePage />) },
];
