import { useRef, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Upload, ArrowRight } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

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
      <section className="pt-28 sm:pt-36 pb-16 sm:pb-20 px-4">
        <div className="container max-w-3xl text-center">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
            <h1 className="text-3xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight mb-5 leading-[1.15]">
              Is Your Resume Getting{" "}
              <span className="gradient-text-new">Rejected</span> by ATS?
            </h1>
            <p className="text-xl sm:text-2xl font-semibold text-foreground mb-3">
              Check Your Resume Score in 10 Seconds.
            </p>
            <p className="text-base sm:text-lg text-muted-foreground max-w-2xl mx-auto mb-8 leading-relaxed">
              Upload your resume and get an instant ATS score, detailed analysis, and AI-powered suggestions to improve your chances of getting interviews.
            </p>
          </motion.div>

          <div ref={uploadRef}>
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="max-w-lg mx-auto mb-4"
            >
              <Card
                className={`cursor-pointer transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5 border-2 border-dashed ${dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"}`}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={onDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                <CardContent className="flex flex-col items-center justify-center py-8 sm:py-10">
                  <div className="h-14 w-14 rounded-xl bg-primary/10 flex items-center justify-center mb-4">
                    <Upload className="h-6 w-6 text-primary" />
                  </div>
                  <Button size="lg" className="mb-3 text-base px-8 h-12">
                    Check My Resume Score <ArrowRight className="h-4 w-4 ml-1" />
                  </Button>
                  <p className="text-sm text-muted-foreground">Drop your PDF here or click to browse</p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf"
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files?.[0]) onFileSelect(e.target.files[0]);
                      e.target.value = "";
                    }}
                  />
                </CardContent>
              </Card>
            </motion.div>
            <p className="text-sm text-muted-foreground">
              Free ATS analysis. Pay only if you want us to fix your resume.
            </p>
          </div>
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
            className="fixed bottom-0 left-0 right-0 z-50 glass-strong border-t border-border/60 px-4 py-3 flex items-center justify-between gap-3"
          >
            <p className="text-sm font-medium hidden sm:block">Free ATS resume score — no sign-up needed</p>
            <Button
              className="w-full sm:w-auto"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="h-4 w-4 mr-2" /> Check My Resume Score
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
