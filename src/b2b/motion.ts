// Motion tokens for the B2B app (mirrors the CSS custom properties in theme.css).
// Contract: enter 160-220ms ease-out, exit 120ms, press 0.97, numerals spring on first load and on data change only.
// Nothing animates in the test runner, a running interview, or on keyboard-driven actions.
import { useEffect, useState } from "react";

export const EASE_OUT = [0.2, 0.8, 0.2, 1] as const;
export const EASE_IN = [0.4, 0, 1, 1] as const;

export const DUR = { press: 0.1, exit: 0.12, enter: 0.18, panel: 0.22, strip: 0.24 } as const;

/** Headline numerals: firm, almost no overshoot. */
export const NUMERAL_SPRING = { type: "spring", stiffness: 400, damping: 32 } as const;

/** Route change: fade plus a 4px rise. */
export const ROUTE_ENTER = { initial: { opacity: 0, y: 4 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.16, ease: EASE_OUT } } as const;

const QUERY = "(prefers-reduced-motion: reduce)";

/** True when the visitor asked for reduced motion (live: follows the OS setting while mounted). */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.(QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(QUERY);
    if (!mq) return;
    const on = () => setReduced(mq.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return reduced;
}
