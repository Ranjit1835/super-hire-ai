// A 3D stage for screens where nobody is working (invite, onboarding, system-check intro, interview start, empty
// states). Decision D3: it shows the viewer's own steps as extruded blocks (done gold, current orange, later graphite),
// with the step names as real text under it; never the logo. Static blocks first; WebGL only when the device can
// afford it and motion is welcome. Never in the test runner, a running interview, tables or forms. `frozen` stops it.
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useReducedMotion } from "../motion";
import { blockCentre, blockFraction, frameAspect, pitchFraction } from "./layout";

export interface StageStep { label?: string; state: "done" | "current" | "todo" }

/** Used when a caller has no real sequence yet: three blocks, the first one current. */
export const NEUTRAL_STEPS: StageStep[] = [{ state: "current" }, { state: "todo" }, { state: "todo" }];

const StageScene = lazy(() => import("./StageScene"));

/** WebGL2, at least 4 cores and (where the browser says) 4 GB of memory. */
export function canAfford3D(): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") return false;
  if (/jsdom/i.test(navigator.userAgent)) return false; // test DOM: no WebGL, and no noisy canvas warnings
  const nav = navigator as Navigator & { deviceMemory?: number };
  if ((nav.hardwareConcurrency ?? 4) < 4) return false;
  if (nav.deviceMemory !== undefined && nav.deviceMemory < 4) return false;
  try {
    const c = document.createElement("canvas");
    return !!c.getContext("webgl2");
  } catch {
    return false;
  }
}

const FLAT: Record<StageStep["state"], string> = { done: "var(--hr-gold)", current: "var(--hr-orange)", todo: "#2B3550" };

/** The no-WebGL stage: flat blocks at the same positions the 3D scene uses, so labels line up either way. */
function StaticStage({ steps }: { steps: StageStep[] }) {
  const n = steps.length;
  return (
    <div className="absolute inset-0" aria-hidden>
      {steps.map((s, i) => (
        <span key={i} className="absolute top-1/2 block h-[32%]"
              style={{ left: `${blockCentre(i, n) * 100}%`, width: `${blockFraction(n) * 100}%`, background: FLAT[s.state],
                       transform: `translate(-50%, ${s.state === "current" ? "-62%" : "-50%"})` }} />
      ))}
    </div>
  );
}

/** Height kept free under the frame for the step labels (two lines of 11px text plus padding). */
const LABEL_SPACE = 36;

export function Stage({ steps = NEUTRAL_STEPS, frozen = false, className }: { steps?: StageStep[]; frozen?: boolean; className?: string }) {
  const reduced = useReducedMotion();
  const [afford] = useState(canAfford3D);
  const [visible, setVisible] = useState(false);
  const [pageVisible, setPageVisible] = useState(() => typeof document === "undefined" || !document.hidden);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.1 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    const on = () => setPageVisible(!document.hidden);
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);

  const labelled = steps.some((s) => s.label);
  const use3D = afford && !reduced;
  const n = steps.length;

  // The frame keeps the scene's own aspect ratio (the largest box that fits the area), so the camera fit, the static
  // blocks and the labels all use the same coordinates. Labels sit directly under the frame, not at the area's foot.
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      const aspect = frameAspect(n);
      const W = el.clientWidth, H = Math.max(0, el.clientHeight - (labelled ? LABEL_SPACE : 0));
      const w = Math.min(W, H * aspect);
      setBox(w > 0 ? { w, h: w / aspect } : null);
    };
    fit();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [n, labelled]);

  return (
    <div className={cn("flex flex-col", className)}>
      <div ref={ref} className="relative flex-1 min-h-0 overflow-hidden flex flex-col items-center justify-center">
        <div className="relative shrink-0" aria-hidden style={box ? { width: box.w, height: box.h } : { width: "100%", height: "100%" }}>
          {use3D && visible && box ? (
            <Suspense fallback={<StaticStage steps={steps} />}>
              <StageScene steps={steps} running={!frozen && pageVisible} />
            </Suspense>
          ) : (
            <StaticStage steps={steps} />
          )}
        </div>
        {labelled && (
          <ol className="relative shrink-0 text-center" style={{ width: box?.w ?? "100%", height: LABEL_SPACE }} aria-label="Your steps">
            {steps.map((s, i) => (
              <li key={i} className={cn("absolute top-1 -translate-x-1/2 text-[11px] leading-tight",
                s.state === "current" ? "text-foreground font-semibold" : "text-[var(--hr-muted)]")}
                  style={{ left: `${blockCentre(i, n) * 100}%`, width: `${pitchFraction(n) * 100}%` }}>
                {s.label}{s.state === "done" ? <span className="sr-only"> (done)</span> : s.state === "current" ? <span className="sr-only"> (now)</span> : null}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
