import { useState } from "react";
import { motion } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { ChevronDown } from "lucide-react";

export const faqs = [
  {
    q: "Is HiResume's ATS resume checker really free?",
    a: "Yes. The ATS score analysis — including keyword match, formatting check, and section detection — is completely free with no signup required. You get your score in about 15 seconds. Paid plans unlock the AI rewrite, recruiter scan simulation, and voice interview practice.",
  },
  {
    q: "What is an ATS score and why does it matter?",
    a: "ATS stands for Applicant Tracking System — software many companies use to collect applications and let recruiters search and filter them. If the system can't read your resume properly, or it lacks the skills the recruiter searches for, you may not be shortlisted even when you're qualified. HiResume's ATS score shows how readable your resume is to this kind of software and how well it covers the keywords a job needs, so you know what to fix.",
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
    q: "Is HiResume suitable for freshers with no work experience?",
    a: "Yes. HiResume looks at the sections that matter most for freshers — education, skills, projects and internships — and shows how to present them clearly, with specific suggestions for weak or vague points. Our guide on writing a fresher resume walks through it step by step.",
  },
  {
    q: "How is HiResume different from other resume checkers?",
    a: "Along with the ATS score, HiResume gives you: (1) a keyword gap analysis against a specific job description, (2) a recruiter scan view of what stands out when someone skims your resume, (3) an AI rewrite of your resume rather than just a list of tips, and (4) voice-based mock interview practice. It covers the path from resume to interview in one place.",
  },
  {
    q: "What payment methods do you accept?",
    a: "We accept all major debit/credit cards (Visa, Mastercard), UPI, net banking, and digital wallets via our secure payment gateway. Pricing is available in both USD and INR, automatically detected based on your location. All transactions are secured with 256-bit encryption.",
  },
  {
    q: "Does HiResume work for international job seekers?",
    a: "Yes. The advice is based on how applicant tracking systems read resumes in general, so it applies whether you're applying in India or abroad. Prices are shown in rupees in India and in US dollars elsewhere.",
  },
];

/** schema.org FAQPage for the questions shown in <FAQSection /> — attach only on pages that render it. */
export const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: faqs.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
};

export function FAQSection() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section className="py-16 sm:py-20 px-4" id="faq">
      <div className="container max-w-3xl">
        <div className="text-center mb-12">
          <Badge className="mb-3 bg-primary/10 text-primary border-primary/20 text-xs">FAQ</Badge>
          <h2 className="text-2xl sm:text-3xl font-bold mb-3">Frequently Asked Questions</h2>
          <p className="text-muted-foreground text-sm">
            Everything you need to know about HiResume's ATS checker and AI interview tools.
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

              {/* Answers stay in the DOM (collapsed with CSS) so crawlers and FAQ rich results can read them. */}
              <div
                className={`grid transition-[grid-template-rows,opacity] duration-200 ease-in-out ${open === i ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}
                aria-hidden={open !== i}
              >
                <div className="overflow-hidden">
                  <p className="px-5 pb-4 text-sm text-muted-foreground leading-relaxed border-t border-border/40 pt-3">
                    {faq.a}
                  </p>
                </div>
              </div>
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
