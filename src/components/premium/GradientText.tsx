import { motion } from "framer-motion";
import { ReactNode } from "react";

interface Props {
  children: ReactNode;
  className?: string;
  as?: "h1" | "h2" | "h3" | "h4" | "span" | "p";
  gradient?: string;
  animate?: boolean;
}

/** Gradient heading wrapper with optional letter-by-letter animation */
export function GradientText({
  children,
  className = "",
  as: Tag = "h1",
  gradient = "linear-gradient(135deg, #8B5CF6, #06B6D4)",
  animate = false,
}: Props) {
  if (animate && typeof children === "string") {
    return (
      <Tag className={className} style={{ backgroundImage: gradient, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>
        {children.split("").map((char, i) => (
          <motion.span
            key={i}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.03, duration: 0.3 }}
          >
            {char}
          </motion.span>
        ))}
      </Tag>
    );
  }

  return (
    <Tag
      className={className}
      style={{
        backgroundImage: gradient,
        WebkitBackgroundClip: "text",
        WebkitTextFillColor: "transparent",
        backgroundClip: "text",
      }}
    >
      {children}
    </Tag>
  );
}
