import { memo, useEffect, useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FileText, Search, Brain, BarChart3, Target, Cpu, Sparkles } from "lucide-react";

const stages = [
  { icon: FileText, label: "Parsing document structure..." },
  { icon: Search, label: "Extracting measurable impact metrics..." },
  { icon: BarChart3, label: "Evaluating keyword density..." },
  { icon: Brain, label: "Simulating ATS parsing behavior..." },
  { icon: Target, label: "Running recruiter 6-second scan..." },
  { icon: Cpu, label: "Calculating interview probability..." },
  { icon: Sparkles, label: "Optimizing scoring model..." },
];

function AnimatedCounter({ target, label, delay }: { target: number; label: string; delay: number }) {
  const [value, setValue] = useState(0);
  const started = useRef(false);

  useEffect(() => {
    const timeout = setTimeout(() => {
      started.current = true;
      let start = 0;
      const duration = 2000;
      const step = (ts: number) => {
        if (!start) start = ts;
        const progress = Math.min((ts - start) / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        setValue(Math.round(eased * target));
        if (progress < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }, delay);
    return () => clearTimeout(timeout);
  }, [target, delay]);

  return (
    <div className="text-center">
      <div className="text-2xl font-bold tabular-nums text-foreground">
        {started.current ? value : "—"}
      </div>
      <div className="text-[10px] text-muted-foreground uppercase tracking-wider mt-1">{label}</div>
    </div>
  );
}

export const ScanningAnimation = memo(function ScanningAnimation() {
  const [stage, setStage] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setStage((s) => (s + 1) % stages.length);
    }, 2500);
    return () => clearInterval(interval);
  }, []);

  const current = stages[stage];

  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] gap-8 px-4">
      {/* Document scanner */}
      <div className="relative w-52 h-72">
        {/* Pulsing border */}
        <div className="absolute inset-0 rounded-xl border-2 border-primary/30 animate-pulse" />
        {/* Document body */}
        <div className="absolute inset-[2px] rounded-xl border border-border/40 bg-card/40 overflow-hidden backdrop-blur-sm">
          {/* Fake text lines that blur/resolve */}
          {Array.from({ length: 14 }).map((_, i) => (
            <motion.div
              key={i}
              className="h-2 bg-muted-foreground/10 rounded mx-4 mt-3"
              style={{ width: `${45 + ((i * 17) % 45)}%` }}
              animate={{ opacity: [0.3, 0.7, 0.3] }}
              transition={{ duration: 2, delay: i * 0.15, repeat: Infinity }}
            />
          ))}

          {/* Scan line with glow */}
          <motion.div
            className="absolute left-0 right-0 h-[2px]"
            style={{
              background: "linear-gradient(90deg, transparent 0%, hsl(var(--primary)) 30%, hsl(var(--primary)) 70%, transparent 100%)",
              boxShadow: "0 0 12px 4px hsl(var(--primary) / 0.3), 0 0 24px 8px hsl(var(--primary) / 0.15)",
            }}
            animate={{ top: ["0%", "100%", "0%"] }}
            transition={{ duration: 3.5, repeat: Infinity, ease: "linear" }}
          />

          {/* Glow region following scan line */}
          <motion.div
            className="absolute left-0 right-0 h-16 pointer-events-none"
            style={{
              background: "linear-gradient(180deg, hsl(var(--primary) / 0.08) 0%, transparent 100%)",
            }}
            animate={{ top: ["-16%", "84%", "-16%"] }}
            transition={{ duration: 3.5, repeat: Infinity, ease: "linear" }}
          />
        </div>
      </div>

      {/* Stage indicator with blinking cursor */}
      <AnimatePresence mode="wait">
        <motion.div
          key={stage}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.3 }}
          className="flex items-center gap-3"
        >
          <current.icon className="h-5 w-5 text-primary" />
          <span className="text-sm font-medium text-muted-foreground">
            {current.label}
            <motion.span
              className="inline-block w-[2px] h-4 bg-primary ml-1 align-middle"
              animate={{ opacity: [1, 0, 1] }}
              transition={{ duration: 0.8, repeat: Infinity }}
            />
          </span>
        </motion.div>
      </AnimatePresence>

      {/* Metric counters */}
      <div className="grid grid-cols-4 gap-6 sm:gap-10">
        <AnimatedCounter target={75 + Math.floor(Math.random() * 8)} label="Structure" delay={800} />
        <AnimatedCounter target={65 + Math.floor(Math.random() * 10)} label="Keywords" delay={1400} />
        <AnimatedCounter target={70 + Math.floor(Math.random() * 8)} label="Impact" delay={2000} />
        <AnimatedCounter target={68 + Math.floor(Math.random() * 12)} label="ATS Prob." delay={2600} />
      </div>

      {/* AI Engine badge */}
      <motion.div
        className="flex items-center gap-2 px-4 py-2 rounded-full border border-primary/20 bg-primary/5"
        animate={{ boxShadow: ["0 0 0px hsl(var(--primary) / 0)", "0 0 12px hsl(var(--primary) / 0.15)", "0 0 0px hsl(var(--primary) / 0)"] }}
        transition={{ duration: 2, repeat: Infinity }}
      >
        <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />
        <span className="text-xs font-medium text-primary">AI Engine Running</span>
      </motion.div>

      {/* Progress dots */}
      <div className="flex gap-1.5">
        {stages.map((_, i) => (
          <motion.div
            key={i}
            className={`h-1.5 rounded-full transition-colors ${i <= stage ? "bg-primary" : "bg-border"}`}
            animate={{ width: i === stage ? 16 : 6 }}
            transition={{ duration: 0.3 }}
          />
        ))}
      </div>
    </div>
  );
});
