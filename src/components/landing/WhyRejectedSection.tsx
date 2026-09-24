import { motion } from "framer-motion";
import { XCircle, AlertTriangle } from "lucide-react";

const mistakes = [
  "Missing job-specific keywords that ATS filters for",
  "Bad formatting — tables, columns, headers that ATS can't parse",
  "Weak experience descriptions without measurable impact",
  "Generic summaries that don't differentiate you",
  "No quantified achievements or metrics",
];

export function WhyRejectedSection() {
  return (
    <section className="py-16 sm:py-20 px-4 border-y border-border bg-secondary/10">
      <div className="container max-w-3xl">
        <div className="text-center mb-10">
          <h2 className="text-2xl sm:text-3xl font-bold mb-3">Why ATS Systems Reject Resumes</h2>
          <p className="text-muted-foreground">75% of resumes are rejected before a human ever sees them</p>
        </div>

        <div className="space-y-3">
          {mistakes.map((m, i) => (
            <motion.div
              key={i}
              className="flex items-start gap-3 p-4 rounded-xl border border-destructive/20 bg-destructive/5"
              initial={{ opacity: 0, x: -10 }}
              whileInView={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.1 }}
              viewport={{ once: true }}
            >
              <XCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
              <p className="text-sm">{m}</p>
            </motion.div>
          ))}
        </div>

        <div className="flex items-center gap-2 mt-6 p-4 rounded-xl bg-primary/5 border border-primary/20">
          <AlertTriangle className="h-5 w-5 text-primary shrink-0" />
          <p className="text-sm font-medium">HiResume automatically detects all these issues and tells you exactly how to fix them.</p>
        </div>
      </div>
    </section>
  );
}
