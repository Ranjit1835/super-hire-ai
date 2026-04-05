import { Button } from "@/components/ui/button";
import { ArrowRight, Upload, Zap } from "lucide-react";
import { motion } from "framer-motion";

interface BottomCtaSectionProps {
  onCtaClick: () => void;
}

export function BottomCtaSection({ onCtaClick }: BottomCtaSectionProps) {
  return (
    <section className="py-16 sm:py-20 px-4">
      <div className="container max-w-3xl text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="glass-neon rounded-2xl p-8 sm:p-12"
        >
          <div className="inline-flex items-center gap-1.5 bg-primary/10 border border-primary/20 rounded-full px-3 py-1 text-xs text-primary font-medium mb-4">
            <Zap className="h-3 w-3" /> Free — no sign-up needed
          </div>
          <h2 className="text-2xl sm:text-3xl font-bold mb-3 leading-tight">
            Your Dream Job Is One Resume Fix Away.
          </h2>
          <p className="text-muted-foreground mb-8 max-w-xl mx-auto text-sm leading-relaxed">
            Every day you apply with an unoptimized resume, you're invisible to ATS. Get your free score in 10 seconds and know exactly what to fix — before your next application.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Button size="lg" onClick={onCtaClick} className="text-base px-8 sm:px-10 h-12 w-full sm:w-auto">
              <Upload className="h-4 w-4 mr-2" /> Check My Resume Score <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-4">
            Free analysis · No credit card · Results in 10 seconds
          </p>
        </motion.div>
      </div>
    </section>
  );
}
