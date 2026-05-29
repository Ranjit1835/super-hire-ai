import { motion, HTMLMotionProps } from "framer-motion";
import { forwardRef, ReactNode } from "react";

interface Props extends Omit<HTMLMotionProps<"div">, "children"> {
  children: ReactNode;
  className?: string;
  hoverLift?: boolean;
  glowColor?: string;
}

/** Glassmorphism card with hover lift + glow */
export const GlassCard = forwardRef<HTMLDivElement, Props>(
  ({ children, className = "", hoverLift = true, glowColor = "139,92,246", ...rest }, ref) => {
    return (
      <motion.div
        ref={ref}
        className={`
          rounded-2xl border backdrop-blur-xl
          bg-[rgba(20,20,35,0.6)]
          border-[rgba(${glowColor},0.15)]
          shadow-[inset_0_1px_0_rgba(${glowColor},0.1)]
          ${hoverLift ? "hover:shadow-[0_8px_30px_rgba(${glowColor},0.15)] hover:-translate-y-1" : ""}
          transition-all duration-300
          ${className}
        `}
        whileHover={hoverLift ? { y: -4, boxShadow: `0 8px 30px rgba(${glowColor}, 0.15)` } : undefined}
        {...rest}
      >
        {children}
      </motion.div>
    );
  }
);
GlassCard.displayName = "GlassCard";
