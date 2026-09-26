import { motion } from "framer-motion";
import { XCircle, CheckCircle2 } from "lucide-react";

const mistakes = [
  "Missing the keywords recruiters search for",
  "Layouts the software can't read — tables, columns, text in headers",
  "Bullet points that list duties but show no measurable impact",
  "Generic summaries that don't say what you're good at",
];

export function WhyRejectedSection() {
  return (
    <section className="py-12 sm:py-20 px-4 border-y border-border bg-secondary/10">
      <div className="container max-w-3xl">
        <div className="text-center mb-6 sm:mb-10">
          <h2 className="text-2xl sm:text-3xl font-bold mb-3">Why ATS Systems Reject Resumes</h2>
          <p className="text-muted-foreground">The most common reasons a resume gets filtered out before a recruiter reads it</p>
        </div>

        <motion.div
          className="rounded-2xl border border-destructive/20 bg-destructive/5 p-5 sm:p-6"
          initial={{ opacity: 0, y: 10 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
        >
          <ul className="space-y-3">
            {mistakes.map((m) => (
              <li key={m} className="flex items-start gap-3">
                <XCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" aria-hidden />
                <span className="text-sm">{m}</span>
              </li>
            ))}
          </ul>
          <p className="flex items-start gap-3 mt-5 pt-4 border-t border-destructive/15 text-sm font-medium">
            <CheckCircle2 className="h-5 w-5 text-success shrink-0" aria-hidden />
            HiResume checks for all of these and tells you exactly what to change.
          </p>
        </motion.div>
      </div>
    </section>
  );
}
