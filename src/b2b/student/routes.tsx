// Routes owned by the "student" area of B2B V1. Registered in src/b2b/routes.tsx (only when VITE_B2B_ENABLED=true).
import { lazy, Suspense, type ReactNode } from "react";
import type { RouteObject } from "react-router-dom";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { Loading } from "../layout/V1Shell";

const StudentHome = lazy(() => import("./StudentHome"));
const StudentDrivePage = lazy(() => import("./StudentDrivePage"));
const InterviewPlaceholder = lazy(() => import("./InterviewPlaceholder"));

const page = (el: ReactNode) => <ProtectedRoute><Suspense fallback={<Loading />}>{el}</Suspense></ProtectedRoute>;

export const studentRoutes: RouteObject[] = [
  { path: "/learn/v1", element: page(<StudentHome />) },
  { path: "/learn/v1/drives/:driveId", element: page(<StudentDrivePage />) },
  { path: "/learn/v1/drives/:driveId/interview", element: page(<InterviewPlaceholder />) },
];
