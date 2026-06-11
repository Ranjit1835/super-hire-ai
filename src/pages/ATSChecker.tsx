import { useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Upload, CheckCircle2, Zap, FileSearch, Target, BarChart3, ArrowRight, Shield, Clock, Star } from "lucide-react";
import { motion } from "framer-motion";
import { AnimatedGradientMesh } from "@/components/premium";
import { SEOHead } from "@/components/SEOHead";

const FEATURES = [
  { icon: FileSearch, title: "Keyword Gap Analysis", desc: "Identifies missing job-specific keywords that ATS systems look for. Compare your resume against any job description." },
  { icon: Target, title: "ATS Formatting Check", desc: "Detects tables, columns, headers, and graphics that break ATS parsing. Get a clear pass/fail on every section." },
  { icon: BarChart3, title: "Impact Score", desc: "Measures how well your bullet points quantify achievements. Weak verbs and vague descriptions get flagged instantly." },
  { icon: Shield, title: "Recruiter Scan Simulation", desc: "See what a recruiter notices in the first 6 seconds. Our AI simulates real recruiter eye-tracking patterns." },
  { icon: Clock, title: "10-Second Results", desc: "Upload your PDF and get a complete ATS score breakdown in under 10 seconds. No waiting, no queues." },
  { icon: Star, title: "100% Free Analysis", desc: "The full ATS score check is free — no signup, no credit card, no limits on how many resumes you check." },
];

const ATS_SYSTEMS = [
  "Workday", "Greenhouse", "Lever", "Taleo", "iCIMS", "BambooHR",
  "SmartRecruiters", "JazzHR", "Jobvite", "Bullhorn", "ADP", "SAP SuccessFactors",
];

const HOW_IT_WORKS = [
  { step: "1", title: "Upload Your Resume", desc: "Drop your PDF resume — we support all standard resume formats." },
  { step: "2", title: "AI Analyzes in 10 Seconds", desc: "Our AI checks keywords, formatting, impact metrics, and ATS compatibility." },
  { step: "3", title: "Get Your ATS Score", desc: "See your score out of 100 with detailed breakdown and specific improvement suggestions." },
];

export default function ATSChecker() {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="min-h-screen bg-background relative">
      <SEOHead
        title="Free ATS Resume Checker - Check Your ATS Score Instantly | HireResume"
        description="Check your ATS resume score for free in 10 seconds. Our AI analyzes keywords, formatting, and impact metrics against real ATS systems like Workday, Greenhouse, and Lever."
        path="/ats-checker"
        keywords="ATS resume checker, ATS score checker, free resume checker, ATS resume scan, check ATS score, resume ATS compatibility, applicant tracking system checker"
        breadcrumbs={[{ name: "Home", path: "/" }, { name: "ATS Resume Checker", path: "/ats-checker" }]}
      />
      <AnimatedGradientMesh />

      {/* Header */}
      <nav className="fixed top-0 w-full z-50 glass-strong border-b border-border/30">
        <div className="container flex items-center justify-between h-16 px-4">
          <a href="/" className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-violet-600 to-cyan-600 flex items-center justify-center shadow-lg shadow-violet-500/20">
              <Zap className="h-4 w-4 text-white" />
            </div>
            <span className="font-bold text-lg text-foreground tracking-tight">HireResume</span>
          </a>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => navigate("/pricing")}>Pricing</Button>
            <Button size="sm" onClick={() => navigate("/auth")}>Sign In</Button>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative pt-28 sm:pt-36 pb-16 px-4">
        <div className="container max-w-4xl text-center relative z-10">
          <Badge className="mb-4 bg-primary/10 text-primary border-primary/20">Free ATS Resume Checker</Badge>
          <h1 className="text-3xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight mb-5 leading-[1.1]">
            Check Your <span className="gradient-text-new">ATS Resume Score</span> in 10 Seconds
          </h1>
          <p className="text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto mb-8">
            75% of resumes are rejected by ATS before a human sees them. Upload your resume and find out if yours will pass — completely free.
          </p>

          {/* Upload CTA */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="max-w-md mx-auto"
          >
            <Card className="border-2 border-dashed border-primary/30 hover:border-primary/60 transition-colors cursor-pointer"
              onClick={() => navigate("/")}
            >
              <CardContent className="py-10 text-center">
                <Upload className="h-10 w-10 text-primary mx-auto mb-3" />
                <p className="font-semibold mb-1">Upload Your Resume PDF</p>
                <p className="text-sm text-muted-foreground">Get your ATS score instantly — no signup required</p>
              </CardContent>
            </Card>
            <input ref={fileInputRef} type="file" accept=".pdf" className="hidden" />
          </motion.div>
        </div>
      </section>

      {/* ATS Systems We Check Against */}
      <section className="py-12 px-4 border-y border-border/30">
        <div className="container max-w-4xl text-center">
          <p className="text-sm text-muted-foreground mb-4">We check compatibility with real ATS systems used by top employers</p>
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
              { q: "What is an ATS and why does it matter?", a: "ATS (Applicant Tracking System) is software used by 98% of Fortune 500 companies to automatically filter resumes. If your resume doesn't match the job's keywords and formatting requirements, it gets rejected before a human ever sees it. Our checker tells you exactly what to fix." },
              { q: "Is the ATS resume checker really free?", a: "Yes, 100% free. You get your full ATS score, keyword analysis, formatting check, and impact assessment — no signup, no credit card, no limits. You only pay if you want AI to automatically fix and rewrite your resume." },
              { q: "What resume format should I use for ATS?", a: "Use a single-column PDF with standard section headings (Experience, Education, Skills). Avoid tables, text boxes, headers/footers, and graphics. Our checker flags all formatting issues automatically." },
              { q: "How accurate is the ATS score?", a: "Our AI is trained on the parsing rules of major ATS systems including Workday, Greenhouse, Lever, iCIMS, and Taleo. The score reflects real-world ATS compatibility — not a generic checklist." },
              { q: "Can I check multiple resumes?", a: "Yes! There's no limit on free checks. Tailor your resume for each job application and check the ATS score each time." },
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
          <p className="text-muted-foreground mb-6">Upload your resume and get results in 10 seconds. Free forever.</p>
          <Button size="lg" onClick={() => navigate("/")} className="gap-2">
            Check My Resume Now <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 px-4 border-t border-border text-center">
        <div className="container max-w-4xl flex flex-wrap justify-center gap-4 text-xs text-muted-foreground">
          <a href="/" className="hover:text-foreground transition-colors">Home</a>
          <a href="/ats-checker" className="hover:text-foreground transition-colors">ATS Checker</a>
          <a href="/pricing" className="hover:text-foreground transition-colors">Pricing</a>
          <a href="/blog" className="hover:text-foreground transition-colors">Blog</a>
          <a href="/about" className="hover:text-foreground transition-colors">About</a>
          <a href="/college-placement" className="hover:text-foreground transition-colors">College Placement</a>
          <a href="/leaderboard" className="hover:text-foreground transition-colors">Leaderboard</a>
        </div>
        <p className="text-xs text-muted-foreground/60 mt-4">&copy; {new Date().getFullYear()} HireResume. All rights reserved.</p>
      </footer>
    </div>
  );
}
