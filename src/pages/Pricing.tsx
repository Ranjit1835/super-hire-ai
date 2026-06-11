import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Zap, Package, Crown, FileEdit, Mic, ArrowRight, Globe, GraduationCap, ArrowLeft, MessageSquare } from "lucide-react";
import { motion } from "framer-motion";
import { AnimatedGradientMesh } from "@/components/premium";
import { SEOHead } from "@/components/SEOHead";
import { useAuth } from "@/contexts/AuthContext";
import { useCurrency } from "@/hooks/useCurrency";

const COMPARISON = [
  { feature: "ATS Resume Score Check", free: true, fix: true, combo: true, unlimited: true },
  { feature: "Keyword Gap Analysis", free: true, fix: true, combo: true, unlimited: true },
  { feature: "AI Resume Rewrite & Fix", free: false, fix: true, combo: true, unlimited: true },
  { feature: "5 PDF Template Options", free: false, fix: true, combo: true, unlimited: true },
  { feature: "Resume Builder (50+ Templates)", free: false, fix: false, combo: false, unlimited: true },
  { feature: "AI Mock Interview", free: false, fix: false, combo: true, unlimited: true },
  { feature: "Voice Interview Practice", free: false, fix: false, combo: false, unlimited: true },
  { feature: "Resume Studio (AI Coach)", free: false, fix: false, combo: false, unlimited: true },
  { feature: "Priority AI Processing", free: false, fix: false, combo: false, unlimited: true },
];

export default function Pricing() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { currency, setCurrency, pricing } = useCurrency();

  const plans = [
    {
      id: "free",
      icon: <Zap className="h-5 w-5 text-green-500" />,
      iconBg: "bg-green-500/10",
      name: "Free",
      price: "$0",
      period: "forever",
      description: "Check your ATS score — no limits",
      features: ["Unlimited ATS score checks", "Keyword gap analysis", "Formatting assessment", "Impact score breakdown", "No signup required"],
      highlight: false,
      badge: null,
    },
    {
      id: "resume-fix",
      icon: <Zap className="h-5 w-5 text-primary" />,
      iconBg: "bg-primary/10",
      name: "Resume Fix",
      price: pricing.RESUME_FIX.display,
      period: "one-time",
      description: "AI fixes one resume end-to-end",
      features: ["ATS keyword optimization", "Quantified bullet points", "Professional formatting", "5 PDF template options", "Downloadable PDF"],
      highlight: false,
      badge: null,
    },
    {
      id: "combo",
      icon: <Package className="h-5 w-5 text-blue-500" />,
      iconBg: "bg-blue-500/10",
      name: "Combo Plan",
      price: pricing.COMBO_PLAN.display,
      period: "one-time",
      description: "Resume Fix + AI Interview",
      features: ["Everything in Resume Fix", "1 AI Interview session", "Performance scoring", "Detailed feedback report", `Save vs buying separately`],
      highlight: false,
      badge: "POPULAR",
    },
    {
      id: "unlimited",
      icon: <Crown className="h-5 w-5 text-primary" />,
      iconBg: "bg-primary/20",
      name: "Unlimited Plan",
      price: pricing.UNLIMITED_PLAN.display,
      period: "/year",
      description: "Full access to everything",
      features: ["Unlimited resume fixes", "Unlimited AI interviews", "Resume Builder access", "Resume Studio (AI Coach)", "Voice interview practice", "Priority processing", "365-day access"],
      highlight: true,
      badge: "BEST VALUE",
    },
  ];

  const handleCta = (planId: string) => {
    if (user) navigate("/dashboard");
    else navigate("/auth");
  };

  const toggleCurrency = () => setCurrency(currency === "INR" ? "USD" : "INR");

  return (
    <div className="min-h-screen bg-background relative">
      <SEOHead
        title="Pricing - ATS Resume Checker & AI Interview Plans | HireResume"
        description="Simple, transparent pricing for HireResume. Free ATS resume score check forever. Resume Fix from $4, Combo Plan from $19, Unlimited from $39/year. No hidden fees."
        path="/pricing"
        keywords="HireResume pricing, resume checker pricing, ATS checker cost, AI resume optimizer price, resume builder pricing"
        breadcrumbs={[{ name: "Home", path: "/" }, { name: "Pricing", path: "/pricing" }]}
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
      <section className="pt-28 sm:pt-36 pb-10 px-4 text-center relative z-10">
        <div className="container max-w-3xl">
          <Badge className="mb-4 bg-primary/10 text-primary border-primary/20">Pricing</Badge>
          <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight mb-4">
            Simple, <span className="gradient-text-new">Transparent</span> Pricing
          </h1>
          <p className="text-lg text-muted-foreground max-w-xl mx-auto mb-4">
            Free ATS score check — forever. Pay only when you want AI to fix, build, or practice.
          </p>
          <button
            onClick={toggleCurrency}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors border border-border rounded-full px-4 py-1.5"
          >
            <Globe className="h-3.5 w-3.5" />
            {currency === "INR" ? "Show prices in USD" : "Show prices in INR"}
          </button>
        </div>
      </section>

      {/* Plan Cards */}
      <section className="pb-16 px-4">
        <div className="container max-w-5xl">
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {plans.map((plan, i) => (
              <motion.div
                key={plan.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.08 }}
              >
                <Card className={`relative h-full flex flex-col transition-all duration-200 hover:-translate-y-1 hover:shadow-lg ${plan.highlight ? "border-2 border-primary/50 bg-primary/5" : "border-border"}`}>
                  {plan.badge && (
                    <Badge className={`absolute -top-2.5 right-3 text-[10px] ${plan.highlight ? "bg-primary text-primary-foreground" : "bg-blue-500 text-white"}`}>
                      {plan.badge}
                    </Badge>
                  )}
                  <CardContent className="pt-6 pb-5 flex flex-col flex-1">
                    <div className={`h-10 w-10 rounded-lg ${plan.iconBg} flex items-center justify-center mb-3`}>
                      {plan.icon}
                    </div>
                    <p className="font-bold text-lg mb-0.5">{plan.name}</p>
                    <p className="text-xs text-muted-foreground mb-4">{plan.description}</p>

                    <div className="mb-4">
                      <span className="text-3xl font-black">{plan.price}</span>
                      <span className="text-sm text-muted-foreground ml-1">{plan.period}</span>
                    </div>

                    <ul className="space-y-2 flex-1 mb-5">
                      {plan.features.map((f, j) => (
                        <li key={j} className="flex items-start gap-2 text-sm text-muted-foreground">
                          <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0 mt-0.5" />
                          <span>{f}</span>
                        </li>
                      ))}
                    </ul>
                    <Button
                      size="sm"
                      variant={plan.highlight ? "default" : "outline"}
                      className="w-full"
                      onClick={() => handleCta(plan.id)}
                    >
                      {plan.id === "free" ? "Try Free" : "Get Started"} <ArrowRight className="h-3 w-3 ml-1" />
                    </Button>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Feature Comparison Table */}
      <section className="py-16 px-4 bg-secondary/10 border-y border-border">
        <div className="container max-w-4xl">
          <h2 className="text-2xl sm:text-3xl font-bold text-center mb-10">Feature Comparison</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-3 px-2 font-medium text-muted-foreground">Feature</th>
                  <th className="text-center py-3 px-2 font-medium">Free</th>
                  <th className="text-center py-3 px-2 font-medium">Fix</th>
                  <th className="text-center py-3 px-2 font-medium">Combo</th>
                  <th className="text-center py-3 px-2 font-medium text-primary">Unlimited</th>
                </tr>
              </thead>
              <tbody>
                {COMPARISON.map((row, i) => (
                  <tr key={i} className="border-b border-border/50">
                    <td className="py-3 px-2 text-muted-foreground">{row.feature}</td>
                    {[row.free, row.fix, row.combo, row.unlimited].map((val, j) => (
                      <td key={j} className="text-center py-3 px-2">
                        {val ? <CheckCircle2 className="h-4 w-4 text-green-500 mx-auto" /> : <span className="text-muted-foreground/40">—</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Pricing FAQ */}
      <section className="py-16 px-4">
        <div className="container max-w-3xl">
          <h2 className="text-2xl sm:text-3xl font-bold text-center mb-10">Pricing FAQ</h2>
          <div className="space-y-4">
            {[
              { q: "Is the ATS resume check really free?", a: "Yes — completely free, no signup, no limits. Check as many resumes as you want. You only pay when you want AI to fix or build your resume." },
              { q: "What payment methods do you accept?", a: "We accept Visa, Mastercard, UPI, net banking, and digital wallets via Razorpay. Prices are shown in USD or INR based on your location — toggle anytime." },
              { q: "Is there a student discount?", a: "Yes! Students get automatic discounts on the Unlimited Plan. The discount is applied based on your resume type during checkout." },
              { q: "Can I get a refund?", a: "Since our AI processes your resume immediately upon payment, we don't offer refunds. But the free ATS check lets you evaluate the quality before paying." },
              { q: "Do I need to subscribe?", a: "No subscriptions required. Resume Fix and Combo are one-time payments. The Unlimited Plan is an annual access pass — not an auto-renewing subscription." },
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
