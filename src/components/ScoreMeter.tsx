import { motion } from "framer-motion";

interface ScoreMeterProps {
  score: number;
  label: string;
  size?: number;
  color?: string;
}

export function ScoreMeter({ score, label, size = 120, color }: ScoreMeterProps) {
  const radius = 45;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;

  const getColor = () => {
    if (color) return color;
    if (score >= 80) return "hsl(var(--success))";
    if (score >= 60) return "hsl(var(--warning))";
    return "hsl(var(--destructive))";
  };

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative" style={{ width: size, height: size }}>
        <svg viewBox="0 0 100 100" className="transform -rotate-90" style={{ width: size, height: size }}>
          <circle cx="50" cy="50" r={radius} fill="none" stroke="hsl(var(--border))" strokeWidth="6" />
          <motion.circle
            cx="50"
            cy="50"
            r={radius}
            fill="none"
            stroke={getColor()}
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={circumference}
            initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset: offset }}
            transition={{ duration: 1.5, ease: "easeOut" }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <motion.span
            className="text-2xl font-bold text-foreground"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
          >
            {score}
          </motion.span>
        </div>
      </div>
      <span className="text-xs font-medium text-muted-foreground text-center leading-tight">{label}</span>
    </div>
  );
}
