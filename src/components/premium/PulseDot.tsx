import { motion } from "framer-motion";

interface Props {
  color?: string;
  size?: number;
  className?: string;
}

/** Pulsing dot for NEW badges and status indicators */
export function PulseDot({ color = "#8B5CF6", size = 8, className = "" }: Props) {
  return (
    <span className={`relative inline-flex ${className}`}>
      <motion.span
        className="absolute inline-flex rounded-full"
        style={{ width: size, height: size, backgroundColor: color }}
        animate={{ scale: [1, 1.8, 1], opacity: [0.7, 0, 0.7] }}
        transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
      />
      <span
        className="relative inline-flex rounded-full"
        style={{ width: size, height: size, backgroundColor: color }}
      />
    </span>
  );
}
