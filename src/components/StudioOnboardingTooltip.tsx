import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, X, ArrowRight } from "lucide-react";
import { useLocation } from "react-router-dom";
import { isB2BPath } from "@/features/b2b/lib/paths";
import { useAuth } from "@/contexts/AuthContext";

// Only where a signed-in user already has a resume in front of them. It sits above the floating
// Studio button (StudioFAB, bottom-right) so it never covers page headings or forms.
const SHOW_ON = ["/dashboard", "/analysis/"];

const ONBOARDING_KEY = "studio_onboarding_shown";

export function StudioOnboardingTooltip() {
  const [show, setShow] = useState(false);
  const location = useLocation();
  const { user } = useAuth();
  const eligible = !!user && !isB2BPath(location.pathname) && SHOW_ON.some((p) => location.pathname.startsWith(p));

  useEffect(() => {
    if (!eligible) { setShow(false); return; }
    try { if (localStorage.getItem(ONBOARDING_KEY)) return; } catch { return; }
    const timer = setTimeout(() => setShow(true), 4000);
    return () => clearTimeout(timer);
  }, [eligible]);

  const handleDismiss = () => {
    setShow(false);
    try { localStorage.setItem(ONBOARDING_KEY, "true"); } catch { /* private mode */ }
  };

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: 8, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.95 }}
          transition={{ type: "spring", stiffness: 300, damping: 25 }}
          role="dialog"
          aria-label="Try Resume Studio"
          className="fixed bottom-24 right-4 sm:right-6 z-[65] max-w-[calc(100vw-2rem)] sm:max-w-xs"
        >
          <div className="glass rounded-xl p-4 shadow-2xl shadow-violet-500/10 border-violet-500/20">
            {/* Arrow pointing down at the floating Studio button */}
            <div className="absolute -bottom-2 right-8 w-4 h-4 glass border-r border-b border-violet-500/20 rotate-45" />

            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-600 to-cyan-600 flex items-center justify-center flex-shrink-0 shadow-lg shadow-violet-500/20">
                <Sparkles className="w-4 h-4 text-white" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold text-foreground mb-1">Try Resume Studio</p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Chat your resume to perfection. AI edits appear in real-time on a live preview.
                </p>
              </div>
              <button
                onClick={handleDismiss}
                aria-label="Dismiss"
                className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-white/5 flex-shrink-0 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => {
                handleDismiss();
                window.location.href = "/studio";
              }}
              className="mt-3 w-full py-2 rounded-lg text-xs font-semibold bg-gradient-to-r from-violet-600 to-cyan-600 text-white hover:shadow-lg hover:shadow-violet-500/25 transition-all flex items-center justify-center gap-1.5"
            >
              Open Studio <ArrowRight className="w-3 h-3" />
            </motion.button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
