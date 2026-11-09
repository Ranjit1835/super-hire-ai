// Gallery routes: /__b2b/gallery (index) and /__b2b/gallery/:group/:scene. Registered only when the build sets
// VITE_B2B_GALLERY=true (capture builds); production builds drop the whole gallery.
import { lazy, Suspense, type ComponentType } from "react";
import { Link, useParams, type RouteObject } from "react-router-dom";
import { Loading } from "../layout/V1Shell";

export const GALLERY_ENABLED = import.meta.env.VITE_B2B_GALLERY === "true";

/** One module per area, each exporting `scenes`: { [name]: Component }. Areas own their own module. */
const GROUPS: Record<string, () => Promise<{ scenes: Record<string, ComponentType> }>> = {
  admin: () => import("./admin"),
  college: () => import("./college"),
  assess: () => import("./assess"),
  runner: () => import("./runner"),
  proctor: () => import("./proctor"),
  interview: () => import("./interview"),
  student: () => import("./student"),
  company: () => import("./company"),
  candidate: () => import("./candidate"),
};

const cache = new Map<string, ComponentType>();
function load(group: string, scene: string): ComponentType {
  const key = `${group}/${scene}`;
  if (!cache.has(key)) {
    cache.set(key, lazy(async () => {
      const mod = await GROUPS[group]?.();
      const C = mod?.scenes[scene];
      return { default: C ?? (() => <p className="p-8">No scene {key}</p>) };
    }));
  }
  return cache.get(key)!;
}

function GalleryScene() {
  const { group = "", scene = "" } = useParams();
  const C = load(group, scene);
  return <Suspense fallback={<Loading />}><C /></Suspense>;
}

function GalleryIndex() {
  return (
    <ul className="p-8 space-y-1 text-sm">
      {Object.keys(GROUPS).map((g) => <li key={g}><Link className="underline" to={`/__b2b/gallery/${g}/index`}>{g}</Link></li>)}
    </ul>
  );
}

export const galleryRoutes: RouteObject[] = GALLERY_ENABLED
  ? [{ path: "/__b2b/gallery", element: <GalleryIndex /> }, { path: "/__b2b/gallery/:group/:scene", element: <GalleryScene /> }]
  : [];
