// Gallery kit (dev/capture builds only, VITE_B2B_GALLERY=true): renders a real B2B page at its real route pattern,
// inside the app's router, with its own query cache seeded from fixtures. No network, no sign-in.
import { useState, type ReactNode } from "react";
import { MemoryRouter, Route, Routes, UNSAFE_LocationContext, UNSAFE_RouteContext } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

export function Scene({ path, route, element, seed }: {
  /** The URL the page believes it is on, e.g. /c/<org>/drives/<drive>. */
  path: string;
  /** The route pattern from the area's routes file, e.g. /c/:orgId/drives/:driveId. */
  route: string;
  element: ReactNode;
  /** Put every query the page reads into the cache (exact keys from the area's queries.ts). */
  seed: (qc: QueryClient) => void;
}) {
  const [qc] = useState(() => {
    const c = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, gcTime: Infinity, retry: false, refetchOnWindowFocus: false, refetchOnMount: false } } });
    seed(c);
    return c;
  });
  return (
    // A scene gets its own memory router (the app router is detached for this subtree), so the page sees its real
    // URL and params. Links inside a scene move the scene's router, not the app's.
    <UNSAFE_LocationContext.Provider value={null as never}>
     <UNSAFE_RouteContext.Provider value={{ outlet: null, matches: [], isDataRoute: false }}>
      <MemoryRouter initialEntries={[path]}>
        <QueryClientProvider client={qc}>
          <Routes><Route path={route} element={element} /><Route path="*" element={<p className="p-8">Left the scene</p>} /></Routes>
        </QueryClientProvider>
      </MemoryRouter>
     </UNSAFE_RouteContext.Provider>
    </UNSAFE_LocationContext.Provider>
  );
}

/** Shared demo ids and dates (synthetic; never shown as real customers). */
export const DEMO = {
  org: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  company: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  drive: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  assessment: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  module: "ffffffff-ffff-4fff-8fff-ffffffffffff",
  role: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  opens: "2026-10-23T14:30:00Z",
  closes: "2026-10-24T16:30:00Z",
  created: "2026-10-20T05:30:00Z",
  collegeName: "Walkthrough College",
  companyName: "Demo Startup",
} as const;

/** Five demo students used across the college scenes (fixture data from docs/b2b/fixtures). */
export const STUDENTS = [
  { id: "10000000-0000-4000-8000-000000000001", roll: "21CSE001", name: "Asha Reddy", email: "s1@demo.test", cgpa: 8.6 },
  { id: "10000000-0000-4000-8000-000000000002", roll: "21CSE002", name: "Bala Kumar", email: "s2@demo.test", cgpa: 7.9 },
  { id: "10000000-0000-4000-8000-000000000003", roll: "21CSE003", name: "Chitra N", email: "s3@demo.test", cgpa: 7.4 },
  { id: "10000000-0000-4000-8000-000000000004", roll: "21CSE004", name: "Dinesh P", email: "s4@demo.test", cgpa: 7.2 },
  { id: "10000000-0000-4000-8000-000000000005", roll: "21CSE005", name: "Esha M", email: "s5@demo.test", cgpa: 8.1 },
] as const;
