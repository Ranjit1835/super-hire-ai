import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Upload, CheckCircle2, FileSearch, Target, BarChart3, ArrowRight, Shield, Clock, Star } from "lucide-react";
import { motion } from "framer-motion";
import { AnimatedGradientMesh } from "@/components/premium";
import { SEOHead } from "@/components/SEOHead";
import { PublicNavbar } from "@/components/PublicNavbar";
import { PublicFooter } from "@/components/PublicFooter";
import { ScanningAnimation } from "@/components/ScanningAnimation";
import { UploadFailurePanel } from "@/components/UploadFailurePanel";
import { useGuestResumeUpload } from "@/hooks/useGuestResumeUpload";

const FEATURES = [
  { icon: FileSearch, title: "Keyword Gap Analysis", desc: "Identifies missing job-specific keywords that ATS systems look for. Compare your resume against any job description." },
  { icon: Target, title: "ATS Formatting Check", desc: "Detects tables, columns, headers, and graphics that break ATS parsing. Get a clear pass/fail on every section." },
  { icon: BarChart3, title: "Impact Score", desc: "Measures how well your bullet points quantify achievements. Weak verbs and vague descriptions get flagged instantly." },
  { icon: Shield, title: "Recruiter Scan Simulation", desc: "A quick view of what stands out — and what gets missed — when a recruiter skims your resume." },
  { icon: Clock, title: "Results in Seconds", desc: "Upload your PDF and get a complete ATS score breakdown in about 15 seconds." },
  { icon: Star, title: "100% Free Analysis", desc: "The full ATS score check is free — no signup and no credit card. You only pay if you want AI to rewrite your resume." },
];

const ATS_SYSTEMS = [
  "Workday", "Greenhouse", "Lever", "Taleo", "iCIMS", "BambooHR",
  "SmartRecruiters", "JazzHR", "Jobvite", "Bullhorn", "ADP", "SAP SuccessFactors",
];

const HOW_IT_WORKS = [
  { step: "1", title: "Upload Your Resume", desc: "Drop your PDF resume — we support all standard resume formats." },
  { step: "2", title: "AI Analyzes in Seconds", desc: "Our AI checks keywords, formatting, impact metrics, and ATS compatibility." },
  { step: "3", title: "Get Your ATS Score", desc: "See your score out of 100 with detailed breakdown and specific improvement suggestions." },
];

export default function ATSChecker() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const { processing, failure, upload, retry } = useGuestResumeUpload();
  const pickFile = () => fileInputRef.current?.click();

  if (processing) {
    return (
      <div className="min-h-screen bg-background">
        <PublicNavbar />
        <ScanningAnimation />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background relative">
      <SEOHead
        title="Free ATS Resume Checker - Check Your ATS Score Instantly | HiResume"
        description="Check your resume's ATS score free, with no signup. See what applicant tracking software reads, which keywords you're missing and how to fix formatting and weak bullet points."
        path="/ats-checker"
        keywords="ATS resume checker, ATS score checker, free resume checker, ATS resume scan, check ATS score, resume ATS compatibility, applicant tracking system checker"
        breadcrumbs={[{ name: "Home", path: "/" }, { name: "ATS Resume Checker", path: "/ats-checker" }]}
      />
      <AnimatedGradientMesh />

      <PublicNavbar />

      {/* Hero */}
      <section className="relative pt-28 sm:pt-36 pb-16 px-4">
        <div className="container max-w-4xl text-center relative z-10">
          <Badge className="mb-4 bg-primary/10 text-primary border-primary/20">Free ATS Resume Checker</Badge>
          <h1 className="text-3xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight mb-5 leading-[1.1]">
            Check Your <span className="gradient-text-new">ATS Resume Score</span> in Seconds
          </h1>
          <p className="text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto mb-8">
            Many companies screen applications with an Applicant Tracking System (ATS). Upload your resume to see what it reads, which keywords you're missing and what to fix — free, no signup.
          </p>

          {/* Upload CTA */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="max-w-md mx-auto"
          >
            {failure ? (
              <UploadFailurePanel failure={failure} onRetry={retry} onPickAnother={pickFile} />
            ) : (
              <button
                type="button"
                onClick={pickFile}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) void upload(f); }}
                className={`w-full rounded-xl border-2 border-dashed transition-colors py-10 px-4 text-center focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${dragOver ? "border-primary bg-primary/5" : "border-primary/30 hover:border-primary/60"}`}
              >
                <Upload className="h-10 w-10 text-primary mx-auto mb-3" aria-hidden />
                <span className="block font-semibold mb-1">Upload your resume PDF</span>
                <span className="block text-sm text-muted-foreground">Tap to choose a file or drag it here · free, no signup</span>
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,.pdf"
              className="hidden"
              aria-label="Upload resume PDF"
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void upload(f); }}
            />
          </motion.div>
        </div>
      </section>

      {/* ATS Systems We Check Against */}
      <section className="py-12 px-4 border-y border-border/30">
        <div className="container max-w-4xl text-center">
          <p className="text-sm text-muted-foreground mb-4">Applicant tracking systems your resume may pass through include</p>
          <div className="flex flex-wrap justify-center gap-3">
            {ATS_SYSTEMS.map((name) => (
              <Badge key={name} variant="outline" className="text-xs px-3 py-1">{name}</Badge>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-16 sm:py-20 px-4">
        <div className="container max-w-4xl">
          <div className="text-center mb-12">
            <h2 className="text-2xl sm:text-3xl font-bold mb-3">How the ATS Resume Checker Works</h2>
            <p className="text-muted-foreground">Three steps to know if your resume will pass ATS filters</p>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {HOW_IT_WORKS.map((item, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
              >
                <Card className="h-full border-border hover:border-primary/30 transition-colors">
                  <CardContent className="pt-6">
                    <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                      <span className="text-lg font-bold text-primary">{item.step}</span>
                    </div>
                    <h3 className="font-bold mb-2">{item.title}</h3>
                    <p className="text-sm text-muted-foreground">{item.desc}</p>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Feature Grid */}
      <section className="py-16 sm:py-20 px-4 bg-secondary/10 border-y border-border">
        <div className="container max-w-5xl">
          <div className="text-center mb-12">
            <h2 className="text-2xl sm:text-3xl font-bold mb-3">What Our ATS Checker Analyzes</h2>
            <p className="text-muted-foreground">A comprehensive scan that goes beyond basic keyword matching</p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {FEATURES.map((f, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 15 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.06 }}
              >
                <Card className="h-full border-border hover:border-primary/20 transition-colors">
                  <CardContent className="pt-5">
                    <f.icon className="h-6 w-6 text-primary mb-3" />
                    <h3 className="font-bold text-sm mb-1.5">{f.title}</h3>
                    <p className="text-xs text-muted-foreground leading-relaxed">{f.desc}</p>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-16 sm:py-20 px-4">
        <div className="container max-w-3xl">
          <h2 className="text-2xl sm:text-3xl font-bold text-center mb-10">ATS Resume Checker FAQ</h2>
          <div className="space-y-4">
            {[
              { q: "What is an ATS and why does it matter?", a: "An ATS (Applicant Tracking System) is software companies use to collect applications and let recruiters search and filter them. If it can't read your resume properly, or your resume lacks the skills recruiters search for, you may not be shortlisted. Our checker shows you what to fix." },
              { q: "Is the ATS resume checker really free?", a: "Yes. You get your full ATS score, keyword analysis, formatting check and impact assessment with no signup and no credit card. You only pay if you want AI to fix and rewrite your resume." },
              { q: "What resume format should I use for ATS?", a: "Use a single-column PDF with standard section headings (Experience, Education, Skills). Avoid tables, text boxes, headers/footers, and graphics. Our checker flags all formatting issues automatically." },
              { q: "How accurate is the ATS score?", a: "The score is an AI assessment of how readable your resume is to applicant tracking software and how well it covers the keywords a role needs. Treat it as a guide to what to fix — no tool can predict exactly how a particular company's system or recruiter will rank you." },
              { q: "Can I check multiple resumes?", a: "Yes. Tailor your resume for each job application and check the ATS score each time — checks are free." },
            ].map((faq, i) => (
              <Card key={i} className="border-border">
                <CardContent className="pt-5">
                  <h3 className="font-bold text-sm mb-2">{faq.q}</h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">{faq.a}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="py-16 px-4 bg-primary/5 border-t border-border">
        <div className="container max-w-2xl text-center">
          <h2 className="text-2xl sm:text-3xl font-bold mb-4">Ready to Check Your ATS Score?</h2>
          <p className="text-muted-foreground mb-6">Upload your resume and get results in about 15 seconds. Free forever.</p>
          <Button size="lg" onClick={pickFile} className="gap-2">
            Check My Resume Now <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </section>

      <PublicFooter />
    </div>
  );
}
