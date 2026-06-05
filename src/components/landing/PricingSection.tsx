import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Zap, Package, Crown, GraduationCap, FileEdit, Mic, ArrowRight } from "lucide-react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

const plans = [
  {
    id: "resume-fix",
    icon: <Zap className="h-5 w-5 text-primary" />,
    iconBg: "bg-primary/10",
    name: "Resume Fix",
    price: "₹99",
    studentPrice: null,
    period: "one-time",
    description: "Fix one resume with AI",
    features: [
      "ATS keyword optimization",
      "Quantified bullet points",
      "Professional formatting",
      "5 PDF template options",
    ],
    highlight: false,
    badge: null,
  },
  {
    id: "resume-build",
    icon: <FileEdit className="h-5 w-5 text-orange-500" />,
    iconBg: "bg-orange-500/10",
    name: "Resume Build",
    price: "₹299",
    studentPrice: null,
    period: "one-time",
    description: "Build a new resume from scratch",
    features: [
      "50+ ATS-ready templates",
      "Step-by-step AI guidance",
      "PDF download",
      "Recruiter-ready structure",
    ],
    highlight: false,
    badge: null,
  },
  {
    id: "ai-interview",
    icon: <Mic className="h-5 w-5 text-green-500" />,
    iconBg: "bg-green-500/10",
    name: "AI Interview",
    price: "₹599",
    studentPrice: null,
    period: "per session",
    description: "AI-powered mock interview",
    features: [
      "Role-specific questions",
      "Real-time AI feedback",
      "Performance scoring",
      "Detailed improvement tips",
    ],
    highlight: false,
    badge: null,
  },
  {
    id: "combo",
    icon: <Package className="h-5 w-5 text-blue-500" />,
    iconBg: "bg-blue-500/10",
    name: "Combo Plan",
    price: "₹599",
    studentPrice: null,
    period: "one-time",
    description: "Resume Fix + AI Interview",
    features: [
      "Everything in Resume Fix",
      "1 AI Interview session",
      "Interview + Resume analysis",
      "Save ₹99 vs buying separately",
    ],
    highlight: false,
    badge: "POPULAR",
  },
  {
    id: "unlimited",
    icon: <Crown className="h-5 w-5 text-primary" />,
    iconBg: "bg-primary/20",
    name: "Unlimited Plan",
    price: "₹1,999",
    studentPrice: null,
    period: "/year",
    description: "Full access for serious job-seekers",
    features: [
      "3 resume builds/month",
      "2 AI interviews/month",
      "Priority AI processing",
      "365-day access",
    ],
    highlight: true,
    badge: "BEST VALUE",
  },
];

export function PricingSection() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const handleCta = (planId: string) => {
    const isInterview = planId === "ai-interview";
    if (user) {
      navigate(isInterview ? "/voice-interview" : "/dashboard");
    } else {
      navigate(isInterview ? "/auth?redirect=/voice-interview" : "/auth");
    }
  };

  return (
    <section className="py-16 sm:py-20 px-4 border-y border-border bg-secondary/10" id="pricing">
      <div className="container max-w-6xl">
        <div className="text-center mb-10">
          <Badge className="mb-3 bg-primary/10 text-primary border-primary/20 text-xs">Pricing</Badge>
          <h2 className="text-2xl sm:text-3xl font-bold mb-3">Simple, Transparent Pricing</h2>
          <p className="text-muted-foreground text-sm">Pay only for what you need. No subscriptions, no hidden fees.</p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
          {plans.map((plan, i) => (
            <motion.div
              key={plan.id}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.07 }}
            >
              <Card className={`relative h-full flex flex-col transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg ${plan.highlight ? "border-2 border-primary/50 bg-primary/5" : "border-border"}`}>
                {plan.badge && (
                  <Badge className={`absolute -top-2.5 right-3 text-[10px] ${plan.highlight ? "bg-primary text-primary-foreground" : "bg-blue-500 text-white"}`}>
                    {plan.badge}
                  </Badge>
                )}
                <CardContent className="pt-5 pb-5 flex flex-col flex-1">
                  <div className={`h-9 w-9 rounded-lg ${plan.iconBg} flex items-center justify-center mb-3`}>
                    {plan.icon}
                  </div>
                  <p className="font-bold text-sm mb-0.5">{plan.name}</p>
                  <p className="text-xs text-muted-foreground mb-3">{plan.description}</p>

                  <div className="mb-3">
                    <span className="text-2xl font-black">{plan.price}</span>
                    <span className="text-xs text-muted-foreground ml-1">{plan.period}</span>
                    {plan.studentPrice && (
                      <div className="mt-1 flex items-center gap-1.5">
                        <Badge variant="outline" className="text-[10px] text-primary border-primary/30 px-1.5 py-0">
                          <GraduationCap className="h-2.5 w-2.5 mr-0.5" /> {plan.studentPrice} for students
                        </Badge>
                      </div>
                    )}
                  </div>

                  <ul className="space-y-1.5 flex-1 mb-4">
                    {plan.features.map((f, j) => (
                      <li key={j} className="flex items-start gap-2 text-xs text-muted-foreground">
                        <CheckCircle2 className="h-3.5 w-3.5 text-success shrink-0 mt-0.5" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                  <Button
                    size="sm"
                    variant={plan.highlight ? "default" : "outline"}
                    className="w-full text-xs"
                    onClick={() => handleCta(plan.id)}
                  >
                    Get Started <ArrowRight className="h-3 w-3 ml-1" />
                  </Button>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>

        <div className="text-center mt-8 space-y-2">
          <p className="text-xs text-muted-foreground">
            Secured by Razorpay · All prices inclusive of taxes · Student discount applied automatically
          </p>
          <p className="text-xs text-primary font-medium">
            Start with the free ATS check — pay only when you're ready to fix or build.
          </p>
        </div>
      </div>
    </section>
  );
}
