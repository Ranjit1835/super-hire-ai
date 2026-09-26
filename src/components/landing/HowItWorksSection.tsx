import { Upload, BarChart3, Wrench } from "lucide-react";
import { motion } from "framer-motion";

const steps = [
  { icon: Upload, title: "Upload your resume", desc: "Your PDF — no signup needed." },
  { icon: BarChart3, title: "Get your ATS score", desc: "See what software reads, the keywords you're missing and what to fix." },
  { icon: Wrench, title: "Fix and practise", desc: "Let AI rewrite it, then practise the interview out loud." },
];

export function HowItWorksSection() {
  return (
    <section className="py-12 sm:py-20 px-4 border-y border-border bg-secondary/10">
      <div className="container max-w-4xl">
        <h2 className="text-2xl sm:text-3xl font-bold text-center mb-8 sm:mb-12">How It Works</h2>
        <ol className="grid md:grid-cols-3 gap-4 md:gap-8">
          {steps.map((step, i) => (
            <motion.li
              key={i}
              className="flex md:flex-col items-start md:items-center gap-4 md:gap-0 md:text-center"
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.15 }}
              viewport={{ once: true }}
            >
              <div className="h-12 w-12 md:h-16 md:w-16 shrink-0 rounded-2xl bg-primary/10 flex items-center justify-center md:mx-auto md:mb-4">
                <step.icon className="h-6 w-6 md:h-7 md:w-7 text-primary" aria-hidden />
              </div>
              <div>
                <div className="text-xs md:text-sm font-bold text-primary md:mb-2">Step {i + 1}</div>
                <h3 className="font-semibold md:text-lg md:mb-2">{step.title}</h3>
                <p className="text-sm text-muted-foreground">{step.desc}</p>
              </div>
            </motion.li>
          ))}
        </ol>
      </div>
    </section>
  );
}
