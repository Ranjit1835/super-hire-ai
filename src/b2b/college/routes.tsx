// Routes owned by the "college" area of B2B V1. Registered in src/b2b/routes.tsx (only when VITE_B2B_ENABLED=true).
import { lazy, Suspense, type ReactNode } from "react";
import { Navigate, useParams, type RouteObject } from "react-router-dom";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { Loading } from "../layout/V1Shell";

const StudentsPage = lazy(() => import("./StudentsPage"));
const ImportPage = lazy(() => import("./ImportPage"));
const DrivesPage = lazy(() => import("./DrivesPage"));
const DriveFormPage = lazy(() => import("./DriveFormPage"));
const DriveDetailPage = lazy(() => import("./DriveDetailPage"));
const AnalyticsPage = lazy(() => import("./AnalyticsPage"));
const SimilarityPage = lazy(() => import("./SimilarityPage"));
const SettingsPage = lazy(() => import("./SettingsPage"));
const CollegeRedirect = lazy(() => import("./CollegeShell").then((m) => ({ default: m.CollegeRedirect })));

const page = (el: ReactNode) => <ProtectedRoute><Suspense fallback={<Loading />}>{el}</Suspense></ProtectedRoute>;

function OrgIndex() {
  const { orgId } = useParams();
  return <Navigate to={`/c/${orgId}/students`} replace />;
}

export const collegeRoutes: RouteObject[] = [
  { path: "/c", element: page(<CollegeRedirect />) },
  { path: "/c/:orgId", element: page(<OrgIndex />) },
  { path: "/c/:orgId/students", element: page(<StudentsPage />) },
  { path: "/c/:orgId/students/import", element: page(<ImportPage />) },
  { path: "/c/:orgId/drives", element: page(<DrivesPage />) },
  { path: "/c/:orgId/drives/new", element: page(<DriveFormPage />) },
  { path: "/c/:orgId/drives/:driveId", element: page(<DriveDetailPage />) },
  { path: "/c/:orgId/drives/:driveId/edit", element: page(<DriveFormPage />) },
  { path: "/c/:orgId/drives/:driveId/similarity", element: page(<SimilarityPage />) },
  { path: "/c/:orgId/analytics", element: page(<AnalyticsPage />) },
  { path: "/c/:orgId/settings", element: page(<SettingsPage />) },
];
