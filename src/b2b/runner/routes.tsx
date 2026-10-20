// Routes owned by the "runner" area of B2B V1 (track A: runner, question bank, test builder).
// Registered in src/b2b/routes.tsx (only when VITE_B2B_ENABLED=true).
import { lazy, Suspense, type ReactNode } from "react";
import type { RouteObject } from "react-router-dom";
import { Loading } from "../layout/V1Shell";

const StartPage = lazy(() => import("./StartPage"));
const RunnerPage = lazy(() => import("./RunnerPage"));

const page = (el: ReactNode) => <Suspense fallback={<Loading />}>{el}</Suspense>;

export const runnerRoutes: RouteObject[] = [
  { path: "/assess/start", element: page(<StartPage />) },
  { path: "/assess/a/:attemptId", element: page(<RunnerPage />) },
];
