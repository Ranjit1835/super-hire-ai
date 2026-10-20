// Routes owned by the "interview" area of B2B V1 (track C). Registered in src/b2b/routes.tsx (only when VITE_B2B_ENABLED=true).
import { lazy, Suspense, type ReactNode } from "react";
import type { RouteObject } from "react-router-dom";
import { Loading } from "../layout/V1Shell";

const StartPage = lazy(() => import("./StartPage"));
const RoomPage = lazy(() => import("./RoomPage"));
const LiveSpikePage = lazy(() => import("./LiveSpikePage"));

const page = (el: ReactNode) => <Suspense fallback={<Loading />}>{el}</Suspense>;

export const interviewRoutes: RouteObject[] = [
  // Students sign in; candidates arrive with an anonymous session from the token flow (track E).
  { path: "/interview/v1/start", element: page(<StartPage />) },
  { path: "/interview/v1/i/:interviewId", element: page(<RoomPage />) },
  // Dev-only Gemini Live spike (latency measurements); not routed in production builds.
  ...(import.meta.env.DEV || import.meta.env.VITE_B2B_LIVE_SPIKE === "true"
    ? [{ path: "/interview/v1/live-spike", element: page(<LiveSpikePage />) }]
    : []),
];
