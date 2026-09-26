import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { motion } from "framer-motion";
import { GraduationCap, Users, Zap, TrendingUp, CheckCircle2, Building2, Trophy, Star } from "lucide-react";
import { AnimatedGradientMesh, SparkleParticles } from "@/components/premium";
import { SEOHead } from "@/components/SEOHead";
import { PublicNavbar } from "@/components/PublicNavbar";
import { PublicFooter } from "@/components/PublicFooter";
import { b2bDb } from "@/features/b2b/lib/db";

const BENEFITS = [
  { icon: Users, title: "Bulk Student Onboarding", desc: "Upload a CSV of your batch. Students get invite links, give consent, and appear in your dashboard as they join." },
  { icon: Zap, title: "Adaptive AI Voice Interviews", desc: "Students practise out loud. The interviewer asks follow-ups, gets harder or easier with each answer, and stays within the topics you choose." },
  { icon: TrendingUp, title: "Readiness Dashboard", desc: "See every student's readiness by module at a glance, filter by batch or gap, and spot who needs help before the drive." },
  { icon: Star, title: "Evidence-Based Reports", desc: "Each report quotes the student's own answers as evidence for every score, so faculty can trust and discuss it." },
  { icon: Trophy, title: "Your Modules and Company-Style Practice", desc: "Use ready-made modules (SQL, Java, Python, DSA, HR) or build your own. Company-style fresher rounds are practice, not official tests." },
  { icon: Building2, title: "Excel and PDF Exports", desc: "Download batch summaries and student reports with your institution's logo for placement meetings." },
];

const PLANS = [
  { name: "Pilot", price: "Free", students: "30 days · up to 150 students", features: ["6 AI interviews per student", "Readiness dashboard", "Company-style practice packs", "Excel and PDF exports"], highlighted: true },
  { name: "Basic", price: "₹149", students: "per student per year · any batch size", features: ["4 AI interviews per student", "Student reports", "Your own modules"], highlighted: false },
  { name: "Pro", price: "₹299", students: "per student per year · any batch size", features: ["10 AI interviews per student", "Readiness dashboard", "Company-style practice packs", "Excel and PDF exports"], highlighted: false },
];

const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07 } },
};

const fadeItem = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0 },
};

const ENQUIRY_EMAIL = "support@hiresume.in";

const REASONS: Record<string, string> = {
  MISSING_FIELDS: "Please fill in your name, role and institution.",
  INVALID_EMAIL: "Please enter a valid email address.",
  INVALID_PHONE: "Please enter a valid phone number, or leave it empty.",
  TOO_LONG: "One of the fields is too long — please shorten your message.",
  ALREADY_RECEIVED: "We've already received enquiries from this email today — we'll be in touch.",
  RATE_LIMITED: "Too many enquiries from your network just now. Please try again later or email us.",
};

export default function CollegePlacement() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: "", role: "", college: "", email: "", phone: "", students: "", message: "" });
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [website, setWebsite] = useState(""); // honeypot — hidden from people, filled by bots

  const mailtoHref = () => {
    const body = [
      `Name: ${form.name}`, `Role: ${form.role}`, `Institution: ${form.college}`,
      `Email: ${form.email}`, `Phone: ${form.phone || "-"}`, `Students: ${form.students || "-"}`,
      "", form.message,
    ].join("\n");
    return `mailto:${ENQUIRY_EMAIL}?subject=${encodeURIComponent(`Institution enquiry: ${form.college}`)}&body=${encodeURIComponent(body)}`;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const { data, error: rpcError } = await b2bDb.rpc("submit_institution_enquiry", {
        _name: form.name, _role: form.role, _institution: form.college, _email: form.email,
        _phone: form.phone || null, _students: form.students || null, _message: form.message || null,
        _source: "/college-placement", _website: website,
      });
      if (rpcError) throw rpcError;
      const r = data as { ok: boolean; reason?: string };
      if (r.ok || r.reason === "ALREADY_RECEIVED") setSubmitted(true);
      else setError(REASONS[r.reason ?? ""] ?? "Something went wrong. Please try again.");
    } catch {
      setError("mailto");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background relative">
      <SEOHead
        title="AI Mock Interviews for Colleges & Placement Cells | HiResume"
        description="AI voice mock interviews for colleges and training institutes: onboard a batch by CSV, run adaptive interviews on your own modules, and track every student's placement readiness in one dashboard."
        path="/college-placement"
        keywords="placement training software, AI mock interview for colleges, campus placement readiness, placement cell software, mock interview platform for students"
        breadcrumbs={[{ name: "Home", path: "/" }, { name: "College Placement", path: "/college-placement" }]}
      />
      <AnimatedGradientMesh />

      <PublicNavbar />

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
              Give every student in your batch AI voice interview practice on the subjects you choose — and see who is placement-ready, and who needs help, before the drive.
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
              <p className="text-muted-foreground">Built for placement officers, training institutes and faculty in India.</p>
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

        {/* Pricing */}
        <section className="py-16 px-4">
          <div className="container max-w-5xl">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="text-center mb-12"
            >
              <h2 className="text-3xl font-bold mb-3 text-foreground">Plans for Institutions</h2>
              <p className="text-muted-foreground">Priced per student, per year. Start with a free 30-day pilot for one batch — no payment details needed.</p>
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
                      <Badge className="absolute -top-0 left-1/2 -translate-x-1/2 translate-y-3 bg-gradient-to-r from-violet-600 to-cyan-600 text-white border-0 text-xs">Recommended start</Badge>
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
                        Talk to us
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
              <p className="text-muted-foreground">Tell us about your institution and we'll get back to you by email.</p>
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
                <h3 className="text-xl font-bold mb-2 text-foreground">Thanks — we've received your enquiry</h3>
                <p className="text-muted-foreground">We'll reply to {form.email}. You can also reach us at <a className="text-primary hover:underline" href={`mailto:${ENQUIRY_EMAIL}`}>{ENQUIRY_EMAIL}</a>.</p>
              </motion.div>
            ) : (
              <div className="glass rounded-2xl border border-violet-500/15 overflow-hidden">
                <div className="p-6">
                  <form onSubmit={handleSubmit} className="space-y-4">
                    <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
                      <label>Website <input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} /></label>
                    </div>
                    <div className="grid sm:grid-cols-2 gap-4">
                      <div>
                        <label className="text-sm font-medium mb-1 block text-foreground">Your Name *</label>
                        <Input required placeholder="Your name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="bg-white/5 border-violet-500/15 focus:border-violet-500/40" />
                      </div>
                      <div>
                        <label className="text-sm font-medium mb-1 block text-foreground">Role *</label>
                        <Input required placeholder="Placement Officer / TPO" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))} className="bg-white/5 border-violet-500/15 focus:border-violet-500/40" />
                      </div>
                    </div>
                    <div>
                      <label className="text-sm font-medium mb-1 block text-foreground">College Name *</label>
                      <Input required placeholder="Your college or institute" value={form.college} onChange={e => setForm(f => ({ ...f, college: e.target.value }))} className="bg-white/5 border-violet-500/15 focus:border-violet-500/40" />
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
                    {error && (
                      <p role="alert" className="text-sm text-red-300">
                        {error === "mailto"
                          ? <>We couldn't send your enquiry just now. <a className="underline" href={mailtoHref()}>Email it to us instead</a>.</>
                          : error}
                      </p>
                    )}
                    <motion.button
                      whileHover={{ scale: 1.01 }}
                      whileTap={{ scale: 0.99 }}
                      type="submit"
                      disabled={submitting}
                      className="w-full py-3 rounded-lg text-sm font-semibold bg-gradient-to-r from-violet-600 to-cyan-600 text-white hover:shadow-lg hover:shadow-violet-500/25 transition-all disabled:opacity-50"
                    >
                      {submitting ? "Sending…" : "Send enquiry"}
                    </motion.button>
                  </form>
                </div>
              </div>
            )}
          </div>
        </section>
      </main>
      <PublicFooter />
    </div>
  );
}
