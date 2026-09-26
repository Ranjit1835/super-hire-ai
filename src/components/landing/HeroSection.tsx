import { useRef, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Upload, ArrowRight, Sparkles } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { SparkleParticles } from "@/components/premium";

interface HeroSectionProps {
  dragOver: boolean;
  setDragOver: (v: boolean) => void;
  onDrop: (e: React.DragEvent) => void;
  onFileSelect: (file: File) => void;
  fileInputRef: React.RefObject<HTMLInputElement>;
}

export function HeroSection({ dragOver, setDragOver, onDrop, onFileSelect, fileInputRef }: HeroSectionProps) {
  const uploadRef = useRef<HTMLDivElement>(null);
  const [showStickyCta, setShowStickyCta] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const el = uploadRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => setShowStickyCta(!entry.isIntersecting),
      { threshold: 0 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <>
      <section className="relative pt-24 sm:pt-36 pb-12 sm:pb-20 px-4 overflow-hidden">
        {/* Animated mesh background for hero */}
        <div className="absolute inset-0 -z-10" aria-hidden>
          <motion.div
            className="absolute w-[600px] h-[600px] rounded-full opacity-20 blur-[100px]"
            style={{ background: "radial-gradient(circle, #8B5CF6 0%, transparent 70%)", top: "-15%", left: "-5%" }}
            animate={{ x: [0, 30, -20, 0], y: [0, -20, 15, 0] }}
            transition={{ duration: 40, repeat: Infinity, ease: "linear" }}
          />
          <motion.div
            className="absolute w-[500px] h-[500px] rounded-full opacity-15 blur-[100px]"
            style={{ background: "radial-gradient(circle, #06B6D4 0%, transparent 70%)", bottom: "-10%", right: "-5%" }}
            animate={{ x: [0, -25, 20, 0], y: [0, 30, -15, 0] }}
            transition={{ duration: 35, repeat: Infinity, ease: "linear" }}
          />
          <motion.div
            className="absolute w-[400px] h-[400px] rounded-full opacity-10 blur-[80px]"
            style={{ background: "radial-gradient(circle, #EC4899 0%, transparent 70%)", top: "50%", left: "60%" }}
            animate={{ x: [0, 40, -30, 0], y: [0, -25, 20, 0] }}
            transition={{ duration: 45, repeat: Infinity, ease: "linear" }}
          />
        </div>

        <SparkleParticles count={15} className="z-0" />

        <div className="container max-w-3xl text-center relative z-10">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.1, duration: 0.4 }}
              className="hidden sm:inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-violet-500/30 bg-violet-500/10 text-sm text-violet-300 mb-6"
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span>AI-Powered Resume Intelligence</span>
            </motion.div>

            <h1 className="text-3xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight mb-5 leading-[1.1]">
              <span className="gradient-text-new">From Resume</span> to{" "}
              <span className="gradient-text-accent">Interview-Ready</span>
              <br />
              <span className="text-foreground">in Minutes</span>
            </h1>
            <p className="text-lg sm:text-2xl font-semibold text-foreground mb-2 sm:mb-3">
              Check Your Resume Score in Seconds.
            </p>
            <p className="text-base sm:text-lg text-muted-foreground max-w-2xl mx-auto mb-6 sm:mb-8 leading-relaxed">
              Upload your PDF to see your ATS score, the keywords you're missing and exactly what to fix.
            </p>
          </motion.div>

          <motion.div
            ref={uploadRef}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            className={`max-w-lg mx-auto rounded-2xl sm:border-2 sm:border-dashed sm:p-6 transition-colors ${dragOver ? "sm:border-violet-500 sm:bg-violet-500/10" : "sm:border-border/40"}`}
          >
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => fileInputRef.current?.click()}
              className="relative w-full inline-flex items-center justify-center gap-2 px-6 py-4 rounded-xl text-base sm:text-lg font-semibold bg-gradient-to-r from-violet-600 to-cyan-600 text-white shadow-lg shadow-violet-500/25 hover:shadow-xl hover:shadow-violet-500/30 transition-shadow overflow-hidden"
            >
              <motion.div
                className="absolute inset-0 bg-gradient-to-r from-transparent via-white/15 to-transparent"
                animate={{ x: ["-100%", "100%"] }}
                transition={{ duration: 3, repeat: Infinity, ease: "linear", repeatDelay: 2 }}
              />
              <Upload className="h-5 w-5 relative z-10" />
              <span className="relative z-10">Upload your resume (PDF)</span>
              <ArrowRight className="h-4 w-4 relative z-10" />
            </motion.button>
            <p className="hidden sm:block text-sm text-muted-foreground mt-3">or drag and drop it here</p>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,.pdf"
              className="hidden"
              aria-label="Upload resume PDF"
              onChange={(e) => {
                if (e.target.files?.[0]) onFileSelect(e.target.files[0]);
                e.target.value = "";
              }}
            />
          </motion.div>

          <p className="text-sm text-muted-foreground mt-4">
            Free · No signup · Results in about 15 seconds
          </p>
          <p className="text-sm text-muted-foreground mt-3">
            Want to edit your resume with AI instead?{" "}
            <button type="button" onClick={() => navigate("/studio")} className="text-violet-300 hover:text-violet-200 underline underline-offset-2 inline-flex items-center gap-1">
              <Sparkles className="h-3.5 w-3.5" /> Try Resume Studio
            </button>
          </p>
        </div>
      </section>

      {/* Sticky CTA — appears after scrolling past the upload zone */}
      <AnimatePresence>
        {showStickyCta && (
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            transition={{ type: "spring", stiffness: 260, damping: 22 }}
            className="fixed bottom-0 left-0 right-0 z-50 glass-strong border-t border-violet-500/20 px-4 py-3 flex items-center justify-between gap-3"
          >
            <p className="text-sm font-medium hidden sm:block text-muted-foreground">Free ATS resume score — no sign-up needed</p>
            <Button
              className="w-full sm:w-auto bg-gradient-to-r from-violet-600 to-cyan-600 border-0"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="h-4 w-4 mr-2" /> Check my resume — free
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
