import { motion } from "framer-motion";
import { useMemo } from "react";

interface Props {
  count?: number;
  className?: string;
  colors?: string[];
}

/** Floating sparkle/particle dots — decorative background element */
export function SparkleParticles({ count = 20, className = "", colors = ["#8B5CF6", "#06B6D4", "#EC4899", "#ffffff"] }: Props) {
  const particles = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        id: i,
        x: Math.random() * 100,
        y: Math.random() * 100,
        size: 2 + Math.random() * 3,
        color: colors[Math.floor(Math.random() * colors.length)],
        duration: 4 + Math.random() * 6,
        delay: Math.random() * 4,
      })),
    [count, colors]
  );

  return (
    <div className={`absolute inset-0 overflow-hidden pointer-events-none ${className}`} aria-hidden>
      {particles.map((p) => (
        <motion.div
          key={p.id}
          className="absolute rounded-full"
          style={{
            width: p.size,
            height: p.size,
            left: `${p.x}%`,
            top: `${p.y}%`,
            backgroundColor: p.color,
          }}
          animate={{
            y: [0, -20, 10, -15, 0],
            x: [0, 10, -8, 5, 0],
            opacity: [0, 0.8, 0.4, 0.7, 0],
            scale: [0.5, 1.2, 0.8, 1, 0.5],
          }}
          transition={{
            duration: p.duration,
            repeat: Infinity,
            delay: p.delay,
            ease: "easeInOut",
          }}
        />
      ))}
    </div>
  );
}
