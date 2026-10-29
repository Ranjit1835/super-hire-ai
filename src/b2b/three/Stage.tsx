// A 3D stage for screens where nobody is working (invite, onboarding, system-check intro, interview start, empty
// states). Decision D3: it shows the viewer's own steps as extruded blocks (done gold, current orange, later graphite),
// with the step names as real text under it; never the logo. Static blocks first; WebGL only when the device can
// afford it and motion is welcome. Never in the test runner, a running interview, tables or forms. `frozen` stops it.
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useReducedMotion } from "../motion";

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

function StaticStage({ steps }: { steps: StageStep[] }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center gap-3 px-6" aria-hidden>
      {steps.map((s, i) => (
        <span key={i} className="block h-10 w-14" style={{ background: FLAT[s.state], transform: s.state === "current" ? "translateY(-8px)" : undefined }} />
      ))}
    </div>
  );
}

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
  return (
    <div className={cn("flex flex-col", className)}>
      <div ref={ref} className="relative flex-1 min-h-0 overflow-hidden" aria-hidden>
        {use3D && visible ? (
          <Suspense fallback={<StaticStage steps={steps} />}>
            <StageScene steps={steps} running={!frozen && pageVisible} />
          </Suspense>
        ) : (
          <StaticStage steps={steps} />
        )}
      </div>
      {labelled && (
        <ol className="flex justify-center gap-3 px-4 pb-3 text-center" aria-label="Your steps">
          {steps.map((s, i) => (
            <li key={i} className={cn("w-[4.5rem] text-[11px] leading-tight",
              s.state === "current" ? "text-foreground font-semibold" : "text-[var(--hr-muted)]")}>
              {s.label}{s.state === "done" ? <span className="sr-only"> (done)</span> : s.state === "current" ? <span className="sr-only"> (now)</span> : null}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
