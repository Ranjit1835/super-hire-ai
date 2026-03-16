import { Upload, BarChart3, Wrench } from "lucide-react";
import { motion } from "framer-motion";

const steps = [
  { icon: Upload, title: "Upload Your Resume", desc: "Drop your PDF resume — takes 2 seconds." },
  { icon: BarChart3, title: "Get ATS Score & Analysis", desc: "Instant 5-layer analysis with detailed scores." },
  { icon: Wrench, title: "Fix & Optimize", desc: "AI rewrites your resume for maximum interview chances." },
];

export function HowItWorksSection() {
  return (
    <section className="py-16 sm:py-20 px-4 border-y border-border bg-secondary/10">
      <div className="container max-w-4xl">
        <h2 className="text-2xl sm:text-3xl font-bold text-center mb-12">How It Works</h2>
        <div className="grid md:grid-cols-3 gap-8">
          {steps.map((step, i) => (
            <motion.div
              key={i}
              className="text-center"
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.15 }}
              viewport={{ once: true }}
            >
              <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
                <step.icon className="h-7 w-7 text-primary" />
              </div>
              <div className="text-sm font-bold text-primary mb-2">Step {i + 1}</div>
              <h3 className="font-semibold text-lg mb-2">{step.title}</h3>
              <p className="text-sm text-muted-foreground">{step.desc}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
