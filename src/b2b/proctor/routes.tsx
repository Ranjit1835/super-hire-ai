// Routes owned by the "proctor" area of B2B V1. Registered in src/b2b/routes.tsx (only when VITE_B2B_ENABLED=true).
import { lazy, Suspense, type ReactNode } from "react";
import type { RouteObject } from "react-router-dom";
import { ProtectedRoute } from "@/components/ProtectedRoute";

const CheckPage = lazy(() => import("./CheckPage"));
const ReviewPage = lazy(() => import("./ReviewPage"));

const page = (el: ReactNode) => <Suspense fallback={null}>{el}</Suspense>;

export const proctorRoutes: RouteObject[] = [
  // Public on purpose: anyone can test their computer before a proctored test.
  { path: "/proctor/check", element: page(<CheckPage />) },
  { path: "/proctor/review/:sessionId", element: <ProtectedRoute>{page(<ReviewPage />)}</ProtectedRoute> },
];
