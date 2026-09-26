import { useEffect, useRef, useState } from "react";

interface Props {
  target: number;
  suffix?: string;
  prefix?: string;
  duration?: number;
  className?: string;
  triggerOnView?: boolean;
}

/**
 * Animated counting number, started when it scrolls into view.
 * Follows `target` when it changes after the first run (e.g. data that loads after the
 * number is already on screen) — it used to stay at the first value, typically 0.
 */
export function CountingNumber({ target, suffix = "", prefix = "", duration = 1800, className = "", triggerOnView = true }: Props) {
  const [count, setCount] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const visible = useRef(!triggerOnView);
  const countRef = useRef(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const run = () => {
      if (timer.current) clearInterval(timer.current);
      const from = countRef.current;
      const steps = 60;
      let step = 0;
      timer.current = setInterval(() => {
        step++;
        const value = step >= steps ? target : from + ((target - from) * step) / steps;
        countRef.current = value;
        setCount(Math.round(value));
        if (step >= steps && timer.current) { clearInterval(timer.current); timer.current = null; }
      }, duration / steps);
    };

    if (visible.current) {
      run();
    } else {
      const el = ref.current;
      if (!el) return;
      const obs = new IntersectionObserver(([entry]) => {
        if (entry.isIntersecting) { visible.current = true; obs.disconnect(); run(); }
      }, { threshold: 0.3 });
      obs.observe(el);
      return () => { obs.disconnect(); if (timer.current) clearInterval(timer.current); };
    }
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [target, duration]);

  return (
    <span ref={ref} className={`font-mono tabular-nums ${className}`}>
      {prefix}{count.toLocaleString("en-IN")}{suffix}
    </span>
  );
}
