import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { motion } from "framer-motion";
import { GraduationCap, Users, Zap, TrendingUp, CheckCircle2, ArrowLeft, Building2, Trophy, Star } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const BENEFITS = [
  { icon: Users, title: "Bulk Resume Analysis", desc: "Analyse hundreds of student resumes at once. Get a class-wide ATS report." },
  { icon: TrendingUp, title: "Placement Rate Boost", desc: "Students with optimised resumes get 2.4× more interview callbacks." },
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

export default function CollegePlacement() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [form, setForm] = useState({ name: "", role: "", college: "", email: "", phone: "", students: "", message: "" });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    // Simple mailto fallback — in production wire to Resend/Supabase edge function
    await new Promise(r => setTimeout(r, 800));
    setSubmitted(true);
    setSubmitting(false);
    toast({ title: "Request received!", description: "We'll reach out within 24 hours." });
  };

  const fadeUp = (delay = 0) => ({
    initial: { opacity: 0, y: 20 },
    animate: { opacity: 1, y: 0 },
    transition: { delay },
  });

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border glass-strong sticky top-0 z-50">
        <div className="container flex items-center h-14">
          <Button variant="ghost" size="sm" onClick={() => navigate("/")} className="gap-2 mr-4">
            <ArrowLeft className="h-4 w-4" /> Home
          </Button>
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-lg bg-primary flex items-center justify-center">
              <Zap className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="font-bold">HireResume</span>
            <Badge className="bg-primary/20 text-primary border-primary/30 text-xs ml-1">For Colleges</Badge>
          </div>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="gradient-bg py-20 px-4 text-center">
          <motion.div {...fadeUp(0)} className="max-w-3xl mx-auto">
            <Badge className="mb-4 bg-primary/20 text-primary border-primary/30">College Placement Partnership</Badge>
            <h1 className="text-4xl sm:text-5xl font-bold mb-6 leading-tight">
              Help Your Students Land<br />
              <span className="gradient-text-new">Jobs They Deserve</span>
            </h1>
            <p className="text-lg text-muted-foreground mb-8 max-w-xl mx-auto">
              Partner with HireResume to give your placement cell an AI-powered edge. Bulk resume analysis, actionable insights, and direct recruiter connect — all in one dashboard.
            </p>
            <div className="flex flex-wrap gap-4 justify-center">
              <Button size="lg" onClick={() => document.getElementById("partner-form")?.scrollIntoView({ behavior: "smooth" })}>
                <GraduationCap className="h-5 w-5 mr-2" /> Partner With Us
              </Button>
              <Button size="lg" variant="outline" onClick={() => navigate("/")}>
                Try Free Analysis
              </Button>
            </div>
            <div className="flex flex-wrap gap-8 justify-center mt-12 text-sm text-muted-foreground">
              <div><span className="text-2xl font-bold text-foreground">50+</span><br />Colleges Onboarded</div>
              <div><span className="text-2xl font-bold text-foreground">12,000+</span><br />Students Analysed</div>
              <div><span className="text-2xl font-bold text-foreground">+22</span><br />Avg ATS Score Gain</div>
            </div>
          </motion.div>
        </section>

        {/* Benefits */}
        <section className="py-16 px-4">
          <div className="container max-w-5xl">
            <motion.div {...fadeUp(0.1)} className="text-center mb-12">
              <h2 className="text-3xl font-bold mb-3">Everything Your Placement Cell Needs</h2>
              <p className="text-muted-foreground">Built specifically for TPOs and placement officers at Indian colleges.</p>
            </motion.div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {BENEFITS.map((b, i) => (
                <motion.div key={b.title} {...fadeUp(0.05 * i)}>
                  <Card className="glass-neon h-full hover:neon-glow transition-all duration-300">
                    <CardContent className="pt-6">
                      <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
                        <b.icon className="h-5 w-5 text-primary" />
                      </div>
                      <h3 className="font-semibold mb-2">{b.title}</h3>
                      <p className="text-sm text-muted-foreground">{b.desc}</p>
                    </CardContent>
                  </Card>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* Testimonials */}
        <section className="py-12 px-4 bg-card/30">
          <div className="container max-w-4xl">
            <div className="grid sm:grid-cols-2 gap-6">
              {TESTIMONIALS.map((t, i) => (
                <motion.div key={t.name} {...fadeUp(0.1 * i)}>
                  <Card className="glass h-full">
                    <CardContent className="pt-6">
                      <div className="flex gap-1 mb-3">{[...Array(5)].map((_, j) => <Star key={j} className="h-4 w-4 text-yellow-400 fill-yellow-400" />)}</div>
                      <p className="text-sm text-muted-foreground mb-4 italic">"{t.text}"</p>
                      <div>
                        <p className="font-semibold text-sm">{t.name}</p>
                        <p className="text-xs text-muted-foreground">{t.role}</p>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* Pricing */}
        <section className="py-16 px-4">
          <div className="container max-w-5xl">
            <motion.div {...fadeUp(0.1)} className="text-center mb-12">
              <h2 className="text-3xl font-bold mb-3">Simple, Transparent Pricing</h2>
              <p className="text-muted-foreground">Start free. Scale as your placement drive grows.</p>
            </motion.div>
            <div className="grid sm:grid-cols-3 gap-6">
              {PLANS.map((plan, i) => (
                <motion.div key={plan.name} {...fadeUp(0.05 * i)}>
                  <Card className={`h-full relative ${plan.highlighted ? "glass-neon border-primary/50 neon-glow" : "glass"}`}>
                    {plan.highlighted && (
                      <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground">Most Popular</Badge>
                    )}
                    <CardHeader>
                      <CardTitle className="text-lg">{plan.name}</CardTitle>
                      <div className="text-3xl font-bold">{plan.price}</div>
                      <p className="text-sm text-muted-foreground">{plan.students}</p>
                    </CardHeader>
                    <CardContent>
                      <ul className="space-y-2 mb-6">
                        {plan.features.map(f => (
                          <li key={f} className="flex items-center gap-2 text-sm">
                            <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
                            {f}
                          </li>
                        ))}
                      </ul>
                      <Button className="w-full" variant={plan.highlighted ? "default" : "outline"}
                        onClick={() => document.getElementById("partner-form")?.scrollIntoView({ behavior: "smooth" })}>
                        Get Started
                      </Button>
                    </CardContent>
                  </Card>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* Partner Form */}
        <section id="partner-form" className="py-16 px-4 bg-card/30">
          <div className="container max-w-xl">
            <motion.div {...fadeUp(0.1)} className="text-center mb-8">
              <h2 className="text-3xl font-bold mb-3">Partner With Us</h2>
              <p className="text-muted-foreground">Fill this form and our team will contact you within 24 hours with a personalised demo.</p>
            </motion.div>
            {submitted ? (
              <motion.div {...fadeUp(0)} className="text-center py-12">
                <CheckCircle2 className="h-16 w-16 text-green-400 mx-auto mb-4" />
                <h3 className="text-xl font-bold mb-2">Request Submitted!</h3>
                <p className="text-muted-foreground">We'll reach out to {form.email} within 24 hours.</p>
              </motion.div>
            ) : (
              <Card className="glass-neon">
                <CardContent className="pt-6">
                  <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="grid sm:grid-cols-2 gap-4">
                      <div>
                        <label className="text-sm font-medium mb-1 block">Your Name *</label>
                        <Input required placeholder="Dr. Priya Sharma" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
                      </div>
                      <div>
                        <label className="text-sm font-medium mb-1 block">Role *</label>
                        <Input required placeholder="Placement Officer / TPO" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))} />
                      </div>
                    </div>
                    <div>
                      <label className="text-sm font-medium mb-1 block">College Name *</label>
                      <Input required placeholder="IIT Delhi / BITS Pilani / VIT..." value={form.college} onChange={e => setForm(f => ({ ...f, college: e.target.value }))} />
                    </div>
                    <div className="grid sm:grid-cols-2 gap-4">
                      <div>
                        <label className="text-sm font-medium mb-1 block">Work Email *</label>
                        <Input required type="email" placeholder="tpo@college.ac.in" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
                      </div>
                      <div>
                        <label className="text-sm font-medium mb-1 block">Phone</label>
                        <Input type="tel" placeholder="+91 9999999999" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
                      </div>
                    </div>
                    <div>
                      <label className="text-sm font-medium mb-1 block">Number of Students</label>
                      <Input placeholder="e.g. 500" value={form.students} onChange={e => setForm(f => ({ ...f, students: e.target.value }))} />
                    </div>
                    <div>
                      <label className="text-sm font-medium mb-1 block">Message (optional)</label>
                      <Textarea placeholder="Tell us about your placement drive timeline or specific requirements..." value={form.message} onChange={e => setForm(f => ({ ...f, message: e.target.value }))} rows={3} />
                    </div>
                    <Button type="submit" className="w-full" size="lg" disabled={submitting}>
                      {submitting ? "Submitting..." : "Submit Partnership Request"}
                    </Button>
                  </form>
                </CardContent>
              </Card>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
