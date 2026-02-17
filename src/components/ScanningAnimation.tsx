import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FileText, Search, Brain, BarChart3, Target } from "lucide-react";

const stages = [
  { icon: FileText, label: "Parsing resume structure...", color: "text-blue-400" },
  { icon: Search, label: "Evaluating keyword density...", color: "text-emerald-400" },
  { icon: Brain, label: "Simulating ATS parsing...", color: "text-purple-400" },
  { icon: BarChart3, label: "Analyzing quantification depth...", color: "text-amber-400" },
  { icon: Target, label: "Calculating recruiter impact...", color: "text-primary" },
];

export function ScanningAnimation() {
  const [stage, setStage] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setStage((s) => (s + 1) % stages.length);
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  const current = stages[stage];

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-8">
      {/* Scanning visual */}
      <div className="relative w-48 h-64">
        {/* Document outline */}
        <div className="absolute inset-0 rounded-xl border-2 border-border/50 bg-card/30 overflow-hidden">
          {/* Fake text lines */}
          {Array.from({ length: 12 }).map((_, i) => (
            <div
              key={i}
              className="h-2 bg-muted-foreground/10 rounded mx-4 mt-3"
              style={{ width: `${50 + Math.random() * 40}%` }}
            />
          ))}

          {/* Scan line */}
          <motion.div
            className="absolute left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-primary to-transparent"
            animate={{ top: ["0%", "100%", "0%"] }}
            transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
          />

          {/* Glow effect */}
          <motion.div
            className="absolute left-0 right-0 h-12 bg-gradient-to-b from-primary/10 to-transparent"
            animate={{ top: ["-12%", "88%", "-12%"] }}
            transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
          />
        </div>
      </div>

      {/* Stage indicator */}
      <AnimatePresence mode="wait">
        <motion.div
          key={stage}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          className="flex items-center gap-3"
        >
          <current.icon className={`h-5 w-5 ${current.color}`} />
          <span className="text-sm font-medium text-muted-foreground">{current.label}</span>
        </motion.div>
      </AnimatePresence>

      {/* Progress dots */}
      <div className="flex gap-2">
        {stages.map((_, i) => (
          <motion.div
            key={i}
            className={`h-2 w-2 rounded-full ${i <= stage ? "bg-primary" : "bg-border"}`}
            animate={{ scale: i === stage ? 1.3 : 1 }}
          />
        ))}
      </div>
    </div>
  );
}
