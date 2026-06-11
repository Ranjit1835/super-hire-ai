import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { motion } from "framer-motion";
import { GraduationCap, Users, Zap, TrendingUp, CheckCircle2, ArrowLeft, Building2, Trophy, Star } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { AnimatedGradientMesh, SparkleParticles, CountingNumber } from "@/components/premium";
import { SEOHead } from "@/components/SEOHead";

const BENEFITS = [
  { icon: Users, title: "Bulk Resume Analysis", desc: "Analyse hundreds of student resumes at once. Get a class-wide ATS report." },
  { icon: TrendingUp, title: "Placement Rate Boost", desc: "Students with optimised resumes get 2.4x more interview callbacks." },
  { icon: Zap, title: "AI-Powered Feedback", desc: "Instant, actionable feedback on format, keywords, and ATS compatibility." },
  { icon: Trophy, title: "Leaderboard & Gamification", desc: "Public opt-in leaderboard to inspire friendly competition among students." },
  { icon: Star, title: "Branded Reports", desc: "White-label reports with your college logo for placement brochures." },
  { icon: Building2, title: "Recruiter Connect", desc: "Partner recruiters can directly shortlist high-scoring candidates." },
];

const TESTIMONIALS = [
  { name: "Priya Sharma", role: "Placement Officer, IIT Indore", text: "HireResume helped 340 students improve their ATS scores by an average of 22 points before our placement drive. Our placement rate hit 91% — a record high." },
  { name: "Rahul Mehta", role: "TPO, BITS Pilani Hyderabad", text: "The bulk analysis dashboard is a game changer. I could see every student's weak points and run targeted workshops in a day." },
];

const PLANS = [
  { name: "Starter", price: "Free", students: "Up to 50 students", features: ["Basic ATS analysis", "Class-wide report", "Email support"], highlighted: false },
  { name: "Growth", price: "₹4,999/mo", students: "Up to 500 students", features: ["All Starter features", "AI resume fix credits", "Leaderboard", "Placement drive portal", "Phone support"], highlighted: true },
  { name: "Enterprise", price: "Custom", students: "Unlimited", features: ["All Growth features", "White-label branding", "Dedicated account manager", "Recruiter connect", "API access"], highlighted: false },
];

const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07 } },
};

const fadeItem = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0 },
};

export default function CollegePlacement() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [form, setForm] = useState({ name: "", role: "", college: "", email: "", phone: "", students: "", message: "" });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    await new Promise(r => setTimeout(r, 800));
    setSubmitted(true);
    setSubmitting(false);
    toast({ title: "Request received!", description: "We'll reach out within 24 hours." });
  };

  return (
    <div className="min-h-screen bg-background relative">
      <SEOHead
        title="College Placement Program - Bulk Resume Analysis for Universities | HireResume"
        description="Boost your college placement rates with AI-powered bulk resume analysis. ATS optimization, leaderboard gamification, and actionable feedback for every student."
        path="/college-placement"
        keywords="college placement program, bulk resume analysis, university placement cell, student resume optimization, campus placement tools"
        breadcrumbs={[{ name: "Home", path: "/" }, { name: "College Placement", path: "/college-placement" }]}
      />
      <AnimatedGradientMesh />

      {/* Header */}
      <header className="border-b border-violet-500/10 glass-strong sticky top-0 z-50 relative">
        <div className="container flex items-center h-14">
          <button onClick={() => navigate("/")} className="flex items-center gap-2 mr-4 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="h-4 w-4" /> Home
          </button>
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-violet-600 to-cyan-600 flex items-center justify-center shadow-lg shadow-violet-500/20">
              <Zap className="h-4 w-4 text-white" />
            </div>
            <span className="font-bold text-foreground">HireResume</span>
            <Badge className="bg-violet-500/10 text-violet-300 border-violet-500/20 text-xs ml-1">For Colleges</Badge>
          </div>
        </div>
      </header>

      <main className="relative z-10">
        {/* Hero */}
        <section className="py-20 px-4 text-center relative overflow-hidden">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="max-w-3xl mx-auto relative"
          >
            <SparkleParticles count={8} colors={["#8B5CF6", "#06B6D4", "#EC4899"]} />
            <Badge className="mb-4 bg-violet-500/15 text-violet-300 border-violet-500/25">College Placement Partnership</Badge>
            <h1 className="text-4xl sm:text-5xl font-bold mb-6 leading-tight tracking-tight">
              Help Your Students Land<br />
              <span className="gradient-text-new">Jobs They Deserve</span>
            </h1>
            <p className="text-lg text-muted-foreground mb-8 max-w-xl mx-auto leading-relaxed">
              Partner with HireResume to give your placement cell an AI-powered edge. Bulk resume analysis, actionable insights, and direct recruiter connect.
            </p>
            <div className="flex flex-wrap gap-4 justify-center">
              <motion.button
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                onClick={() => document.getElementById("partner-form")?.scrollIntoView({ behavior: "smooth" })}
                className="px-6 py-3 rounded-xl text-sm font-semibold bg-gradient-to-r from-violet-600 to-cyan-600 text-white hover:shadow-xl hover:shadow-violet-500/25 transition-all flex items-center gap-2"
              >
                <GraduationCap className="h-5 w-5" /> Partner With Us
              </motion.button>
              <motion.button
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                onClick={() => navigate("/")}
                className="px-6 py-3 rounded-xl text-sm font-medium border border-violet-500/20 text-foreground hover:bg-violet-500/5 transition-all"
              >
                Try Free Analysis
              </motion.button>
            </div>
            <div className="flex flex-wrap gap-8 justify-center mt-12">
              {[
                { value: 50, suffix: "+", label: "Colleges Onboarded" },
                { value: 12000, suffix: "+", label: "Students Analysed" },
                { value: 22, suffix: "", label: "Avg ATS Score Gain", prefix: "+" },
              ].map((stat) => (
                <div key={stat.label} className="text-center">
                  <div className="text-2xl font-bold font-mono gradient-text-new">
                    {stat.prefix}<CountingNumber value={stat.value} />{stat.suffix}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">{stat.label}</div>
                </div>
              ))}
            </div>
          </motion.div>
        </section>

        {/* Benefits */}
        <section className="py-16 px-4">
          <div className="container max-w-5xl">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="text-center mb-12"
            >
              <h2 className="text-3xl font-bold mb-3 text-foreground">Everything Your Placement Cell Needs</h2>
              <p className="text-muted-foreground">Built specifically for TPOs and placement officers at Indian colleges.</p>
            </motion.div>
            <motion.div
              variants={stagger}
              initial="hidden"
              whileInView="show"
              viewport={{ once: true }}
              className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6"
            >
              {BENEFITS.map((b) => (
                <motion.div key={b.title} variants={fadeItem}>
                  <motion.div
                    whileHover={{ y: -4 }}
                    className="glass rounded-xl border border-violet-500/10 card-hover-glow h-full p-6"
                  >
                    <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-violet-600/15 to-cyan-600/15 border border-violet-500/20 flex items-center justify-center mb-4">
                      <b.icon className="h-5 w-5 text-violet-400" />
                    </div>
                    <h3 className="font-semibold mb-2 text-foreground">{b.title}</h3>
                    <p className="text-sm text-muted-foreground">{b.desc}</p>
                  </motion.div>
                </motion.div>
              ))}
            </motion.div>
          </div>
        </section>

        {/* Testimonials */}
        <section className="py-12 px-4">
          <div className="container max-w-4xl">
            <div className="grid sm:grid-cols-2 gap-6">
              {TESTIMONIALS.map((t, i) => (
                <motion.div
                  key={t.name}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.1 }}
                >
                  <div className="glass rounded-xl border border-violet-500/10 h-full p-6">
                    <div className="flex gap-1 mb-3">{[...Array(5)].map((_, j) => <Star key={j} className="h-4 w-4 text-yellow-400 fill-yellow-400" />)}</div>
                    <p className="text-sm text-muted-foreground mb-4 italic leading-relaxed">"{t.text}"</p>
                    <div>
                      <p className="font-semibold text-sm text-foreground">{t.name}</p>
                      <p className="text-xs text-muted-foreground">{t.role}</p>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* Pricing */}
        <section className="py-16 px-4">
          <div className="container max-w-5xl">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="text-center mb-12"
            >
              <h2 className="text-3xl font-bold mb-3 text-foreground">Simple, Transparent Pricing</h2>
              <p className="text-muted-foreground">Start free. Scale as your placement drive grows.</p>
            </motion.div>
            <div className="grid sm:grid-cols-3 gap-6">
              {PLANS.map((plan, i) => (
                <motion.div
                  key={plan.name}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.07 }}
                >
                  <motion.div
                    whileHover={{ y: -4 }}
                    className={`glass rounded-2xl border h-full relative overflow-hidden ${
                      plan.highlighted
                        ? "border-violet-500/40 shadow-lg shadow-violet-500/10 neon-glow"
                        : "border-violet-500/10 card-hover-glow"
                    }`}
                  >
                    {plan.highlighted && (
                      <Badge className="absolute -top-0 left-1/2 -translate-x-1/2 translate-y-3 bg-gradient-to-r from-violet-600 to-cyan-600 text-white border-0 text-xs">Most Popular</Badge>
                    )}
                    <div className="p-6 pt-8">
                      <h3 className="text-lg font-semibold text-foreground">{plan.name}</h3>
                      <div className="text-3xl font-bold mt-2 gradient-text-new">{plan.price}</div>
                      <p className="text-sm text-muted-foreground mt-1">{plan.students}</p>
                    </div>
                    <div className="px-6 pb-6">
                      <ul className="space-y-2 mb-6">
                        {plan.features.map(f => (
                          <li key={f} className="flex items-center gap-2 text-sm text-foreground">
                            <CheckCircle2 className="h-4 w-4 text-violet-400 shrink-0" />
                            {f}
                          </li>
                        ))}
                      </ul>
                      <motion.button
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={() => document.getElementById("partner-form")?.scrollIntoView({ behavior: "smooth" })}
                        className={`w-full py-2.5 rounded-lg text-sm font-semibold transition-all ${
                          plan.highlighted
                            ? "bg-gradient-to-r from-violet-600 to-cyan-600 text-white hover:shadow-lg hover:shadow-violet-500/25"
                            : "border border-violet-500/20 text-foreground hover:bg-violet-500/5"
                        }`}
                      >
                        Get Started
                      </motion.button>
                    </div>
                  </motion.div>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* Partner Form */}
        <section id="partner-form" className="py-16 px-4">
          <div className="container max-w-xl">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="text-center mb-8"
            >
              <h2 className="text-3xl font-bold mb-3 text-foreground">Partner With Us</h2>
              <p className="text-muted-foreground">Fill this form and our team will contact you within 24 hours with a personalised demo.</p>
            </motion.div>
            {submitted ? (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-12">
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: "spring", stiffness: 300 }}
                >
                  <CheckCircle2 className="h-16 w-16 text-emerald-400 mx-auto mb-4" />
                </motion.div>
                <h3 className="text-xl font-bold mb-2 text-foreground">Request Submitted!</h3>
                <p className="text-muted-foreground">We'll reach out to {form.email} within 24 hours.</p>
              </motion.div>
            ) : (
              <div className="glass rounded-2xl border border-violet-500/15 overflow-hidden">
                <div className="p-6">
                  <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="grid sm:grid-cols-2 gap-4">
                      <div>
                        <label className="text-sm font-medium mb-1 block text-foreground">Your Name *</label>
                        <Input required placeholder="Dr. Priya Sharma" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="bg-white/5 border-violet-500/15 focus:border-violet-500/40" />
                      </div>
                      <div>
                        <label className="text-sm font-medium mb-1 block text-foreground">Role *</label>
                        <Input required placeholder="Placement Officer / TPO" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))} className="bg-white/5 border-violet-500/15 focus:border-violet-500/40" />
                      </div>
                    </div>
                    <div>
                      <label className="text-sm font-medium mb-1 block text-foreground">College Name *</label>
                      <Input required placeholder="IIT Delhi / BITS Pilani / VIT..." value={form.college} onChange={e => setForm(f => ({ ...f, college: e.target.value }))} className="bg-white/5 border-violet-500/15 focus:border-violet-500/40" />
                    </div>
                    <div className="grid sm:grid-cols-2 gap-4">
                      <div>
                        <label className="text-sm font-medium mb-1 block text-foreground">Work Email *</label>
                        <Input required type="email" placeholder="tpo@college.ac.in" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} className="bg-white/5 border-violet-500/15 focus:border-violet-500/40" />
                      </div>
                      <div>
                        <label className="text-sm font-medium mb-1 block text-foreground">Phone</label>
                        <Input type="tel" placeholder="+91 9999999999" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} className="bg-white/5 border-violet-500/15 focus:border-violet-500/40" />
                      </div>
                    </div>
                    <div>
                      <label className="text-sm font-medium mb-1 block text-foreground">Number of Students</label>
                      <Input placeholder="e.g. 500" value={form.students} onChange={e => setForm(f => ({ ...f, students: e.target.value }))} className="bg-white/5 border-violet-500/15 focus:border-violet-500/40" />
                    </div>
                    <div>
                      <label className="text-sm font-medium mb-1 block text-foreground">Message (optional)</label>
                      <Textarea placeholder="Tell us about your placement drive timeline or specific requirements..." value={form.message} onChange={e => setForm(f => ({ ...f, message: e.target.value }))} rows={3} className="bg-white/5 border-violet-500/15 focus:border-violet-500/40" />
                    </div>
                    <motion.button
                      whileHover={{ scale: 1.01 }}
                      whileTap={{ scale: 0.99 }}
                      type="submit"
                      disabled={submitting}
                      className="w-full py-3 rounded-lg text-sm font-semibold bg-gradient-to-r from-violet-600 to-cyan-600 text-white hover:shadow-lg hover:shadow-violet-500/25 transition-all disabled:opacity-50"
                    >
                      {submitting ? "Submitting..." : "Submit Partnership Request"}
                    </motion.button>
                  </form>
                </div>
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
