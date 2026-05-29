import { useEffect, useRef, useState } from "react";

interface Props {
  target: number;
  suffix?: string;
  prefix?: string;
  duration?: number;
  className?: string;
  triggerOnView?: boolean;
}

/** Animated counting number with intersection observer trigger */
export function CountingNumber({ target, suffix = "", prefix = "", duration = 1800, className = "", triggerOnView = true }: Props) {
  const [count, setCount] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const started = useRef(false);

  useEffect(() => {
    if (!triggerOnView) {
      runAnimation();
      return;
    }
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !started.current) {
          started.current = true;
          runAnimation();
        }
      },
      { threshold: 0.3 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [target, triggerOnView]);

  function runAnimation() {
    const steps = 60;
    const increment = target / steps;
    let current = 0;
    const timer = setInterval(() => {
      current = Math.min(current + increment, target);
      setCount(Math.floor(current));
      if (current >= target) clearInterval(timer);
    }, duration / steps);
  }

  return (
    <span ref={ref} className={`font-mono tabular-nums ${className}`}>
      {prefix}{count.toLocaleString("en-IN")}{suffix}
    </span>
  );
}
