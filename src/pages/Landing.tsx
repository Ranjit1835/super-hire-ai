import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { FileText, Target, Zap, Download, ArrowRight, CheckCircle2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

const features = [
  { icon: Target, title: "ATS Simulation", desc: "Deep ATS parsing simulation with keyword extraction & section detection scoring" },
  { icon: FileText, title: "Recruiter Scan", desc: "6-second recruiter psychology simulation — are you passing the first glance?" },
  { icon: Zap, title: "AI Fix Engine", desc: "Auto-rewrite your resume with optimized bullets, summary, and keywords" },
  { icon: Download, title: "PDF Templates", desc: "3 ATS-friendly templates with instant download — Classic, Modern, Executive" },
];

const stats = [
  { value: "5-Layer", label: "Deep Analysis" },
  { value: "95%+", label: "ATS Accuracy" },
  { value: "3", label: "PDF Templates" },
  { value: "<30s", label: "Analysis Time" },
];

export default function Landing() {
  const navigate = useNavigate();
  const { user } = useAuth();

  return (
    <div className="min-h-screen bg-background">
      {/* Nav */}
      <nav className="fixed top-0 w-full z-50 glass-strong">
        <div className="container flex items-center justify-between h-16">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
              <Zap className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="font-bold text-lg text-foreground">Super Hire AI</span>
          </div>
          <Button onClick={() => navigate(user ? "/dashboard" : "/auth")} size="sm">
            {user ? "Dashboard" : "Get Started"}
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </nav>

      {/* Hero */}
      <section className="pt-32 pb-20 px-4">
        <div className="container max-w-4xl text-center">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-border bg-secondary text-xs font-medium text-muted-foreground mb-6">
              <CheckCircle2 className="h-3 w-3 text-primary" />
              AI-Powered Resume Intelligence
            </div>
            <h1 className="text-4xl sm:text-6xl font-extrabold tracking-tight mb-6">
              Your Resume, <br />
              <span className="gradient-text">Recruiter-Tested</span>
            </h1>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto mb-8">
              5-layer deep analysis engine that simulates ATS parsing, recruiter psychology, keyword intelligence, and quantification scoring. Then auto-fixes everything.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Button size="lg" onClick={() => navigate(user ? "/dashboard" : "/auth")} className="text-base px-8">
                Analyze My Resume <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
              <Button size="lg" variant="outline" onClick={() => document.getElementById("features")?.scrollIntoView({ behavior: "smooth" })}>
                See How It Works
              </Button>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Stats */}
      <section className="py-12 border-y border-border bg-secondary/30">
        <div className="container">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            {stats.map((s, i) => (
              <motion.div key={i} className="text-center" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 + i * 0.1 }}>
                <div className="text-3xl font-bold gradient-text">{s.value}</div>
                <div className="text-sm text-muted-foreground mt-1">{s.label}</div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="py-24 px-4">
        <div className="container max-w-5xl">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold mb-4">Not a Formatting Checker.</h2>
            <p className="text-muted-foreground text-lg">A recruiter-grade evaluation engine built to dominate.</p>
          </div>
          <div className="grid md:grid-cols-2 gap-6">
            {features.map((f, i) => (
              <motion.div
                key={i}
                className="glass rounded-xl p-6 hover:border-primary/30 transition-colors"
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.1 }}
                viewport={{ once: true }}
              >
                <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
                  <f.icon className="h-5 w-5 text-primary" />
                </div>
                <h3 className="font-semibold text-lg mb-2">{f.title}</h3>
                <p className="text-muted-foreground text-sm">{f.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-24 px-4">
        <div className="container max-w-3xl text-center">
          <div className="glass rounded-2xl p-12 gradient-border">
            <h2 className="text-3xl font-bold mb-4">Ready to Dominate?</h2>
            <p className="text-muted-foreground mb-8">Upload your resume and get a detailed, recruiter-grade analysis in under 30 seconds.</p>
            <Button size="lg" onClick={() => navigate(user ? "/dashboard" : "/auth")} className="text-base px-8">
              Start Free Analysis <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 border-t border-border">
        <div className="container text-center text-sm text-muted-foreground">
          © 2026 Super Hire AI. All rights reserved.
        </div>
      </footer>
    </div>
  );
}
