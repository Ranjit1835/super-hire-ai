import { motion } from "framer-motion";

/**
 * Aurora gradient mesh background — three animated blob layers
 * with grain overlay and vignette. Renders behind page content.
 */
export function AnimatedGradientMesh({ className = "" }: { className?: string }) {
  return (
    <div className={`fixed inset-0 -z-10 overflow-hidden ${className}`} aria-hidden>
      {/* Violet blob */}
      <motion.div
        className="absolute w-[700px] h-[700px] rounded-full opacity-20 blur-[120px]"
        style={{ background: "radial-gradient(circle, #8B5CF6 0%, transparent 70%)", top: "-10%", left: "10%" }}
        animate={{ rotate: [0, 360], x: [0, 40, -20, 0], y: [0, -30, 20, 0] }}
        transition={{ duration: 60, repeat: Infinity, ease: "linear" }}
      />
      {/* Cyan blob */}
      <motion.div
        className="absolute w-[600px] h-[600px] rounded-full opacity-15 blur-[120px]"
        style={{ background: "radial-gradient(circle, #06B6D4 0%, transparent 70%)", bottom: "-5%", right: "5%" }}
        animate={{ rotate: [360, 0], x: [0, -30, 20, 0], y: [0, 40, -20, 0] }}
        transition={{ duration: 55, repeat: Infinity, ease: "linear" }}
      />
      {/* Pink blob */}
      <motion.div
        className="absolute w-[500px] h-[500px] rounded-full opacity-10 blur-[100px]"
        style={{ background: "radial-gradient(circle, #EC4899 0%, transparent 70%)", top: "40%", left: "50%" }}
        animate={{ x: [0, 60, -40, 0], y: [0, -50, 30, 0] }}
        transition={{ duration: 50, repeat: Infinity, ease: "linear" }}
      />
      {/* Grain overlay */}
      <svg className="absolute inset-0 w-full h-full opacity-[0.03] pointer-events-none">
        <filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.65" numOctaves="3" stitchTiles="stitch" /></filter>
        <rect width="100%" height="100%" filter="url(#grain)" />
      </svg>
      {/* Vignette */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,hsl(240_10%_5%/0.4)_70%,hsl(240_10%_5%/0.8)_100%)]" />
    </div>
  );
}
