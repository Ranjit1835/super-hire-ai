import { motion } from "framer-motion";
import { ReactNode } from "react";

interface Props {
  children: ReactNode;
  onClick?: () => void;
  className?: string;
  size?: "sm" | "md" | "lg";
  variant?: "primary" | "accent";
}

/** Button with gradient shimmer on hover + scale animation */
export function ShimmerButton({ children, onClick, className = "", size = "md", variant = "primary" }: Props) {
  const sizeClass = {
    sm: "px-4 py-2 text-sm",
    md: "px-6 py-3 text-base",
    lg: "px-8 py-4 text-lg",
  }[size];

  const gradientClass = variant === "primary"
    ? "from-violet-600 via-violet-500 to-cyan-500"
    : "from-pink-500 via-violet-500 to-cyan-500";

  return (
    <motion.button
      onClick={onClick}
      whileHover={{ scale: 1.03 }}
      whileTap={{ scale: 0.97 }}
      className={`
        relative inline-flex items-center justify-center gap-2
        ${sizeClass} rounded-xl font-semibold text-white
        bg-gradient-to-r ${gradientClass}
        shadow-lg shadow-violet-500/25
        hover:shadow-xl hover:shadow-violet-500/30
        overflow-hidden transition-shadow
        ${className}
      `}
    >
      {/* Shimmer sweep */}
      <motion.div
        className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent"
        initial={{ x: "-100%" }}
        whileHover={{ x: "100%" }}
        transition={{ duration: 0.6, ease: "easeInOut" }}
      />
      <span className="relative z-10 flex items-center gap-2">{children}</span>
    </motion.button>
  );
}
