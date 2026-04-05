import { motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";

const stats = [
  { value: 1200, suffix: "+", label: "Resumes Analyzed", sublabel: "and counting" },
  { value: 75, suffix: "%", label: "Rejected Without AI Fix", sublabel: "of all resumes submitted" },
  { value: 44, suffix: " pts", label: "Avg Score Improvement", sublabel: "after AI optimization" },
  { value: 10, suffix: "s", label: "To Get Your ATS Score", sublabel: "instant analysis, free" },
];

function CountUp({ target, suffix }: { target: number; suffix: string }) {
  const [count, setCount] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const started = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !started.current) {
        started.current = true;
        const duration = 1800;
        const steps = 60;
        const increment = target / steps;
        let current = 0;
        const timer = setInterval(() => {
          current = Math.min(current + increment, target);
          setCount(Math.floor(current));
          if (current >= target) clearInterval(timer);
        }, duration / steps);
      }
    }, { threshold: 0.5 });
    obs.observe(el);
    return () => obs.disconnect();
  }, [target]);

  return <span ref={ref}>{count.toLocaleString("en-IN")}{suffix}</span>;
}

export function StatsSection() {
  return (
    <section className="py-12 px-4 border-y border-border/40 bg-primary/5">
      <div className="container max-w-5xl">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          {stats.map((s, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1 }}
              className="text-center"
            >
              <div className="text-3xl sm:text-4xl font-black text-primary mb-1">
                <CountUp target={s.value} suffix={s.suffix} />
              </div>
              <p className="text-sm font-semibold text-foreground">{s.label}</p>
              <p className="text-xs text-muted-foreground">{s.sublabel}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
