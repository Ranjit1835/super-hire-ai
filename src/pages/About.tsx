import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Zap, ArrowLeft, Target, Users, Shield, Globe, BarChart3, Brain, ArrowRight } from "lucide-react";
import { motion } from "framer-motion";
import { AnimatedGradientMesh, CountingNumber } from "@/components/premium";
import { SEOHead } from "@/components/SEOHead";

const STATS = [
  { value: 10000, suffix: "+", label: "Resumes Analyzed" },
  { value: 75, suffix: "%", label: "Avg Score Improvement" },
  { value: 12, suffix: "+", label: "ATS Systems Covered" },
  { value: 4.8, suffix: "/5", label: "User Rating" },
];

const VALUES = [
  { icon: Target, title: "Accuracy First", desc: "Our AI is trained on real ATS parsing rules — not generic checklists. Every suggestion is backed by how actual hiring software works." },
  { icon: Shield, title: "Privacy by Default", desc: "Your resume is processed and never stored permanently. We don't sell data, train on your content, or share it with third parties." },
  { icon: Globe, title: "Built for Everyone", desc: "From freshers in Bangalore to senior engineers in San Francisco — HireResume works with ATS systems used worldwide." },
  { icon: Brain, title: "AI That Helps, Not Replaces", desc: "We enhance your real experience with better phrasing and keywords. We never fabricate achievements or misrepresent your background." },
];

export default function About() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background relative">
      <SEOHead
        title="About HireResume - AI-Powered Resume & Interview Platform"
        description="HireResume helps job seekers worldwide pass ATS filters and ace interviews. Learn about our mission, our AI technology, and why thousands trust us with their careers."
        path="/about"
        keywords="about HireResume, HireResume team, AI resume company, resume optimization platform, who built HireResume"
        breadcrumbs={[{ name: "Home", path: "/" }, { name: "About", path: "/about" }]}
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
            <Button variant="ghost" size="sm" onClick={() => navigate("/")}>
              <ArrowLeft className="h-3 w-3 mr-1" /> Home
            </Button>
            <Button size="sm" onClick={() => navigate("/auth")}>Sign In</Button>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="pt-28 sm:pt-36 pb-16 px-4 relative z-10">
        <div className="container max-w-3xl text-center">
          <Badge className="mb-4 bg-primary/10 text-primary border-primary/20">About Us</Badge>
          <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight mb-5 leading-[1.1]">
            Helping Job Seekers <span className="gradient-text-new">Beat the ATS</span> and Land Interviews
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            HireResume is an AI-powered platform that analyzes, optimizes, and builds resumes that pass Applicant Tracking Systems — plus mock interview practice to help you prepare for what comes next.
          </p>
        </div>
      </section>

      {/* Stats */}
      <section className="py-12 px-4 border-y border-border/30">
        <div className="container max-w-3xl">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 text-center">
            {STATS.map((stat, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 15 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
              >
                <div className="text-2xl sm:text-3xl font-black gradient-text-new">
                  <CountingNumber end={stat.value} suffix={stat.suffix} />
                </div>
                <p className="text-xs text-muted-foreground mt-1">{stat.label}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Mission */}
      <section className="py-16 sm:py-20 px-4">
        <div className="container max-w-3xl">
          <div className="text-center mb-12">
            <h2 className="text-2xl sm:text-3xl font-bold mb-4">Our Mission</h2>
            <p className="text-muted-foreground leading-relaxed max-w-2xl mx-auto">
              75% of resumes are rejected by ATS before a human ever sees them. That means qualified candidates get filtered out by software — not by skill. We built HireResume to fix that. Our AI understands what ATS systems look for and helps you present your real experience in a way that gets past the filters and onto a recruiter's desk.
            </p>
          </div>
        </div>
      </section>

      {/* Values */}
      <section className="py-16 sm:py-20 px-4 bg-secondary/10 border-y border-border">
        <div className="container max-w-4xl">
          <h2 className="text-2xl sm:text-3xl font-bold text-center mb-10">What We Stand For</h2>
          <div className="grid sm:grid-cols-2 gap-5">
            {VALUES.map((v, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 15 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.08 }}
              >
                <Card className="h-full border-border hover:border-primary/20 transition-colors">
                  <CardContent className="pt-6">
                    <v.icon className="h-6 w-6 text-primary mb-3" />
                    <h3 className="font-bold mb-2">{v.title}</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">{v.desc}</p>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* What We Offer */}
      <section className="py-16 sm:py-20 px-4">
        <div className="container max-w-3xl">
          <h2 className="text-2xl sm:text-3xl font-bold text-center mb-10">What HireResume Offers</h2>
          <div className="space-y-4">
            {[
              { icon: BarChart3, title: "Free ATS Resume Checker", desc: "Upload your resume and get an instant ATS score with keyword analysis, formatting check, and improvement suggestions — completely free.", link: "/ats-checker" },
              { icon: Zap, title: "AI Resume Fix & Builder", desc: "Our AI rewrites your resume with optimized keywords, quantified bullet points, and ATS-friendly formatting. Or build a new one from scratch with 50+ templates.", link: "/" },
              { icon: Users, title: "AI Mock Interview", desc: "Practice job interviews with an AI interviewer that asks role-specific questions, gives real-time feedback, and scores your performance.", link: "/" },
              { icon: Globe, title: "College Placement Program", desc: "Bulk resume analysis for universities and placement cells. Boost your students' placement rates with AI-powered feedback at scale.", link: "/college-placement" },
            ].map((item, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 10 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.06 }}
              >
                <Card className="border-border hover:border-primary/20 transition-colors cursor-pointer" onClick={() => navigate(item.link)}>
                  <CardContent className="pt-5 flex items-start gap-4">
                    <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <item.icon className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <h3 className="font-bold mb-1">{item.title}</h3>
                      <p className="text-sm text-muted-foreground">{item.desc}</p>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 px-4 bg-primary/5 border-t border-border">
        <div className="container max-w-2xl text-center">
          <h2 className="text-2xl sm:text-3xl font-bold mb-4">Ready to Optimize Your Resume?</h2>
          <p className="text-muted-foreground mb-6">Check your ATS score for free — no signup needed.</p>
          <Button size="lg" onClick={() => navigate("/")} className="gap-2">
            Check My Resume <ArrowRight className="h-4 w-4" />
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
        </div>
        <p className="text-xs text-muted-foreground/60 mt-4">&copy; {new Date().getFullYear()} HireResume. All rights reserved.</p>
      </footer>
    </div>
  );
}
