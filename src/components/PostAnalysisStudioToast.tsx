import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, X, ArrowRight } from "lucide-react";
import { useNavigate } from "react-router-dom";

const SESSION_KEY = "studio_post_analysis_shown";

/**
 * Slide-in toast after analysis completes — once per session.
 * Auto-dismisses after 8 seconds.
 */
export function PostAnalysisStudioToast() {
  const [show, setShow] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (sessionStorage.getItem(SESSION_KEY)) return;
    const timer = setTimeout(() => setShow(true), 1500);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!show) return;
    const auto = setTimeout(() => dismiss(), 8000);
    return () => clearTimeout(auto);
  }, [show]);

  const dismiss = () => {
    setShow(false);
    sessionStorage.setItem(SESSION_KEY, "true");
  };

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ x: 320, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 320, opacity: 0 }}
          transition={{ type: "spring", stiffness: 260, damping: 24 }}
          className="fixed bottom-20 right-4 z-[55] max-w-sm"
        >
          <div className="glass rounded-xl p-4 shadow-2xl shadow-violet-500/10 border-violet-500/20">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-violet-600 to-cyan-600 flex items-center justify-center flex-shrink-0 shadow-lg shadow-violet-500/20">
                <Sparkles className="w-4 h-4 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground mb-0.5">Want AI to fix these issues?</p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Open Resume Studio to edit your resume conversationally with AI.
                </p>
              </div>
              <button
                onClick={dismiss}
                className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-white/5 flex-shrink-0 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => { dismiss(); navigate("/studio"); }}
              className="mt-3 w-full py-2.5 rounded-lg text-xs font-semibold bg-gradient-to-r from-violet-600 to-cyan-600 text-white hover:shadow-lg hover:shadow-violet-500/25 transition-all flex items-center justify-center gap-1.5"
            >
              Open Studio <ArrowRight className="w-3 h-3" />
            </motion.button>
            {/* Auto-dismiss progress bar */}
            <motion.div
              initial={{ scaleX: 1 }}
              animate={{ scaleX: 0 }}
              transition={{ duration: 8, ease: "linear" }}
              className="mt-2 h-0.5 rounded-full bg-gradient-to-r from-violet-500 to-cyan-500 origin-left"
            />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
