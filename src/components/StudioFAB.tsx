import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, X, ArrowRight } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

const DISMISSED_KEY = "studio_fab_dismissed";

export function StudioFAB() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const [dismissed, setDismissed] = useState(false);
  const [isFirstVisit, setIsFirstVisit] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    setDismissed(sessionStorage.getItem(DISMISSED_KEY) === "true");
    setIsFirstVisit(!localStorage.getItem("studio_fab_seen"));
  }, []);

  // Don't show on studio pages, auth pages, or when not logged in
  const hideOn = ["/studio", "/auth", "/verify-otp", "/reset-password", "/auth/callback"];
  if (hideOn.some((p) => location.pathname.startsWith(p))) return null;
  if (!user || dismissed) return null;

  const handleDismiss = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDismissed(true);
    sessionStorage.setItem(DISMISSED_KEY, "true");
    localStorage.setItem("studio_fab_seen", "true");
  };

  const handleClick = () => {
    localStorage.setItem("studio_fab_seen", "true");
    navigate("/studio");
  };

  return (
    <motion.div
      initial={{ scale: 0, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: "spring", stiffness: 260, damping: 20, delay: 1 }}
      className="fixed bottom-6 right-6 z-[55] flex items-center gap-2"
    >
      {/* First visit tooltip */}
      <AnimatePresence>
        {isFirstVisit && !expanded && (
          <motion.div
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 10 }}
            className="glass rounded-xl px-3 py-2 shadow-xl max-w-[180px] border-violet-500/20"
          >
            <p className="text-[11px] text-muted-foreground leading-tight">
              <strong className="text-violet-400">New!</strong> Chat with AI to edit your resume in real-time
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.button
        onClick={handleClick}
        onMouseEnter={() => setExpanded(true)}
        onMouseLeave={() => setExpanded(false)}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        className="relative group flex items-center gap-2 rounded-2xl bg-gradient-to-r from-violet-600 to-cyan-600 text-white shadow-lg shadow-violet-500/25 hover:shadow-xl hover:shadow-violet-500/30 transition-all overflow-hidden"
      >
        {/* Shimmer sweep */}
        <motion.div
          className="absolute inset-0 bg-gradient-to-r from-transparent via-white/15 to-transparent"
          animate={{ x: ["-100%", "100%"] }}
          transition={{ duration: 3, repeat: Infinity, ease: "linear", repeatDelay: 3 }}
        />

        {/* Pulse ring on first visit */}
        {isFirstVisit && (
          <motion.span
            className="absolute inset-0 rounded-2xl border-2 border-violet-400"
            animate={{ scale: [1, 1.15, 1], opacity: [0.5, 0, 0.5] }}
            transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
          />
        )}

        <div className={`relative z-10 flex items-center gap-2 ${expanded ? "pl-4 pr-3 py-3" : "p-3"}`}>
          <Sparkles className="w-4 h-4" />
          <AnimatePresence>
            {expanded && (
              <motion.span
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: "auto", opacity: 1 }}
                exit={{ width: 0, opacity: 0 }}
                className="text-sm font-semibold whitespace-nowrap overflow-hidden"
              >
                Resume Studio
              </motion.span>
            )}
          </AnimatePresence>
        </div>

        {/* Dismiss X */}
        <button
          onClick={handleDismiss}
          className="absolute -top-1 -right-1 p-0.5 rounded-full bg-background/80 border border-border/50 opacity-0 group-hover:opacity-100 hover:bg-background transition-opacity"
        >
          <X className="w-2.5 h-2.5 text-muted-foreground" />
        </button>
      </motion.button>
    </motion.div>
  );
}
