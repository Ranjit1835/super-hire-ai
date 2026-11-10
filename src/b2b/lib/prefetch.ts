// Fetch each portal's other pages while the browser is idle, so moving between tabs never waits on a new download.
// The 2026-11-10 production test saw page downloads stall for 10-30 s on one connection while the server answered in
// 0.2 s; with the code already here, a stalled connection only delays data, which shows its own loading state.
// Same import() paths as the route files, so Vite hands back the same chunks. Each set runs once per page load.

const done = new Set<string>();

function whenIdle(fn: () => void) {
  const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
  if (w.requestIdleCallback) w.requestIdleCallback(fn, { timeout: 4000 });
  else setTimeout(fn, 1500);
}

export function prefetch(key: string, loaders: (() => Promise<unknown>)[]) {
  if (typeof window === "undefined" || done.has(key) || import.meta.env.MODE === "test") return;
  done.add(key);
  whenIdle(() => { for (const load of loaders) load().catch(() => { done.delete(key); }); });
}

export const prefetchCollegePortal = () => prefetch("college", [
  () => import("../college/StudentsPage"), () => import("../college/DrivesPage"), () => import("../college/DriveDetailPage"),
  () => import("../college/DriveFormPage"), () => import("../college/AnalyticsPage"), () => import("../college/SettingsPage"),
  () => import("../assessments/TestsPage"), () => import("../bank/BankPage"),
]);

export const prefetchCompanyPortal = () => prefetch("company", [
  () => import("../company/RolesPage"), () => import("../company/RolePage"), () => import("../company/RoleFormPage"),
  () => import("../company/SettingsPage"), () => import("../assessments/TestsPage"), () => import("../bank/BankPage"),
]);
