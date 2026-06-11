import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { ChevronDown } from "lucide-react";

const faqs = [
  {
    q: "Is HireResume's ATS resume checker really free?",
    a: "Yes. The ATS score analysis — including keyword match, formatting check, and section detection — is completely free with no signup required. You get your score in under 10 seconds. Paid plans unlock the AI rewrite, recruiter scan simulation, and voice interview practice.",
  },
  {
    q: "What is an ATS score and why does it matter?",
    a: "ATS stands for Applicant Tracking System. It's software that 98% of Fortune 500 companies use to automatically filter resumes before a human ever sees them. If your resume scores below 60, it gets rejected automatically — no matter how qualified you are. HireResume analyzes your resume against the same criteria these systems use.",
  },
  {
    q: "How does the AI resume rewrite work?",
    a: "Upload your resume and paste the job description. Our AI identifies missing keywords, weak bullet points, and formatting issues. It then rewrites your resume to match the job's language and pass ATS filters — while keeping your actual experience intact. The rewrite is delivered as a downloadable PDF.",
  },
  {
    q: "What's included in the AI Mock Interview?",
    a: "The AI interviewer asks role-specific questions for 10+ job profiles (Software Engineer, Data Analyst, Product Manager, DevOps, etc.). You can respond by typing or using your voice. The AI listens, asks follow-up questions, and scores your answers on communication, confidence, and depth. You get a full scorecard with improvement tips at the end.",
  },
  {
    q: "Is HireResume suitable for freshers with no work experience?",
    a: "Absolutely. We offer affordable student pricing and our AI knows how to highlight academic projects, internships, and skills effectively. Many freshers who used HireResume got their first job offer within 45 days of optimizing their resume.",
  },
  {
    q: "How is HireResume different from other resume checkers?",
    a: "Most resume checkers give you a generic score with vague tips. HireResume gives you: (1) a job-description-specific keyword gap analysis, (2) a recruiter eye-tracking simulation showing what a recruiter sees in 6 seconds, (3) an actual AI rewrite — not just suggestions, and (4) voice-based interview practice. It's a complete job-search toolkit, not just a checker.",
  },
  {
    q: "What payment methods do you accept?",
    a: "We accept all major debit/credit cards (Visa, Mastercard), UPI, net banking, and digital wallets via our secure payment gateway. Pricing is available in both USD and INR, automatically detected based on your location. All transactions are secured with 256-bit encryption.",
  },
  {
    q: "Does HireResume work for international job seekers?",
    a: "Yes! HireResume works for job seekers worldwide — US, UK, Europe, India, and beyond. Our AI understands ATS systems used globally including Workday, Greenhouse, Lever, iCIMS, and Taleo. Whether you're applying to companies in San Francisco or Bangalore, we optimize your resume for the right ATS.",
  },
];

export function FAQSection() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section className="py-16 sm:py-20 px-4" id="faq">
      <div className="container max-w-3xl">
        <div className="text-center mb-12">
          <Badge className="mb-3 bg-primary/10 text-primary border-primary/20 text-xs">FAQ</Badge>
          <h2 className="text-2xl sm:text-3xl font-bold mb-3">Frequently Asked Questions</h2>
          <p className="text-muted-foreground text-sm">
            Everything you need to know about HireResume's ATS checker and AI interview tools.
          </p>
        </div>

        <div className="space-y-3">
          {faqs.map((faq, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.06 }}
              className="glass rounded-xl overflow-hidden border border-border/60 hover:border-primary/30 transition-colors duration-200"
            >
              <button
                className="w-full text-left px-5 py-4 flex items-center justify-between gap-3 focus:outline-none"
                onClick={() => setOpen(open === i ? null : i)}
                aria-expanded={open === i}
              >
                <span className="text-sm font-semibold leading-snug">{faq.q}</span>
                <motion.div
                  animate={{ rotate: open === i ? 180 : 0 }}
                  transition={{ duration: 0.2 }}
                  className="shrink-0 text-muted-foreground"
                >
                  <ChevronDown className="h-4 w-4" />
                </motion.div>
              </button>

              <AnimatePresence initial={false}>
                {open === i && (
                  <motion.div
                    key="content"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.22, ease: "easeInOut" }}
                    className="overflow-hidden"
                  >
                    <p className="px-5 pb-4 text-sm text-muted-foreground leading-relaxed border-t border-border/40 pt-3">
                      {faq.a}
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          ))}
        </div>

        <p className="text-center text-xs text-muted-foreground mt-8">
          Still have questions?{" "}
          <a href="mailto:support@hiresume.in" className="text-primary hover:underline">
            Email us at support@hiresume.in
          </a>
        </p>
      </div>
    </section>
  );
}
