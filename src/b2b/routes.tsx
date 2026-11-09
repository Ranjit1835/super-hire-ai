// All B2B V1 routes. Each area owns its own routes file so parallel tracks don't edit the same lines.
// App.tsx renders these only when VITE_B2B_ENABLED=true (production: off).
import type { ReactNode } from "react";
import { Route, type RouteObject } from "react-router-dom";
import { collegeRoutes } from "./college/routes";
import { companyRoutes } from "./company/routes";
import { runnerRoutes } from "./runner/routes";
import { proctorRoutes } from "./proctor/routes";
import { interviewRoutes } from "./interview/routes";
import { studentRoutes } from "./student/routes";
import { galleryRoutes } from "./gallery/routes";

export const v1Routes: RouteObject[] = [
  ...collegeRoutes, ...companyRoutes, ...runnerRoutes, ...proctorRoutes, ...interviewRoutes, ...studentRoutes, ...galleryRoutes,
];

/** Turn route objects into <Route> elements for the app's <Routes>. */
export function routeElements(routes: RouteObject[], prefix = "v1-"): ReactNode[] {
  return routes.map((r, i) =>
    r.index ? (
      <Route key={`${prefix}${i}`} index element={r.element} />
    ) : (
      <Route key={`${prefix}${i}`} path={r.path} element={r.element}>
        {r.children ? routeElements(r.children, `${prefix}${i}-`) : null}
      </Route>
    ),
  );
}
