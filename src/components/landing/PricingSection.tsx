import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, GraduationCap } from "lucide-react";
import { motion } from "framer-motion";

const features = [
  "ATS keyword optimization",
  "Improved project descriptions",
  "Strong, quantified bullet points",
  "ATS-friendly formatting",
  "Professional resume structure",
  "5 downloadable PDF templates",
];

export function PricingSection() {
  return (
    <section className="py-16 sm:py-20 px-4 border-y border-border bg-secondary/10">
      <div className="container max-w-3xl">
        <h2 className="text-2xl sm:text-3xl font-bold text-center mb-4">What You Get With Resume Fix</h2>
        <p className="text-muted-foreground text-center mb-10">AI-powered resume optimization that gets you more interviews</p>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
        >
          <Card className="glass">
            <CardContent className="pt-6">
              <ul className="space-y-3 mb-8">
                {features.map((f, i) => (
                  <li key={i} className="flex items-center gap-3 text-sm">
                    <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>

              <div className="grid sm:grid-cols-2 gap-4">
                <Card className="border-border">
                  <CardContent className="pt-5 text-center">
                    <p className="text-sm font-medium text-muted-foreground mb-1">Standard Fix</p>
                    <p className="text-3xl font-black">₹299</p>
                    <p className="text-xs text-muted-foreground mt-1">One-time payment</p>
                  </CardContent>
                </Card>
                <Card className="border-primary/40 bg-primary/5 relative overflow-hidden">
                  <CardContent className="pt-5 text-center">
                    <Badge className="absolute top-2 right-2 bg-primary text-primary-foreground text-[10px]">
                      <GraduationCap className="h-3 w-3 mr-1" /> Student Price
                    </Badge>
                    <p className="text-sm font-medium text-muted-foreground mb-1">Student Discount</p>
                    <p className="text-3xl font-black text-primary">₹149</p>
                    <p className="text-xs text-muted-foreground mt-1">Special price for students</p>
                  </CardContent>
                </Card>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </section>
  );
}
