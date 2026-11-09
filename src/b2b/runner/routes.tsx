// Routes owned by the "runner" area of B2B V1 (track A: runner, question bank, test builder).
// Registered in src/b2b/routes.tsx (only when VITE_B2B_ENABLED=true).
import { lazy, Suspense, type ReactNode } from "react";
import type { RouteObject } from "react-router-dom";
import { Loading } from "../layout/V1Shell";

const StartPage = lazy(() => import("./StartPage"));
const RunnerPage = lazy(() => import("./RunnerPage"));
const BankPage = lazy(() => import("../bank/BankPage"));
const TestsPage = lazy(() => import("../assessments/TestsPage"));
const BuilderPage = lazy(() => import("../assessments/BuilderPage"));

const page = (el: ReactNode) => <Suspense fallback={<Loading />}>{el}</Suspense>;

export const runnerRoutes: RouteObject[] = [
  { path: "/assess/start", element: page(<StartPage />) },
  { path: "/assess/a/:attemptId", element: page(<RunnerPage />) },
  // Staff: question bank (":orgId" or "global" for the super admin's global bank) and the test builder.
  { path: "/assess/bank/:orgId", element: page(<BankPage />) },
  { path: "/assess/tests/:orgId", element: page(<TestsPage />) },
  { path: "/assess/tests/:orgId/new", element: page(<BuilderPage />) },
  { path: "/assess/tests/:orgId/:assessmentId", element: page(<BuilderPage />) },
];
