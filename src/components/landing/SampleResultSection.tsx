import { motion } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, XCircle, CheckCircle2, TrendingUp } from "lucide-react";

interface SampleResultSectionProps {
  onCtaClick: () => void;
}

export function SampleResultSection({ onCtaClick }: SampleResultSectionProps) {
  return (
    <section className="py-16 sm:py-20 px-4">
      <div className="container max-w-4xl">
        <h2 className="text-2xl sm:text-3xl font-bold text-center mb-4">See What You'll Get</h2>
        <p className="text-muted-foreground text-center mb-10">Here's a sample analysis result</p>

        <div className="grid md:grid-cols-2 gap-6">
          {/* Before */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
          >
            <Card className="border-destructive/30 bg-destructive/5">
              <CardContent className="pt-6">
                <div className="flex items-center gap-2 mb-4">
                  <XCircle className="h-5 w-5 text-destructive" />
                  <span className="font-semibold text-destructive">Before Optimization</span>
                </div>
                <div className="text-5xl font-black text-destructive mb-4">42<span className="text-xl font-normal text-muted-foreground">/100</span></div>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  <li className="flex items-start gap-2"><XCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" /> Missing critical job keywords</li>
                  <li className="flex items-start gap-2"><XCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" /> Weak project descriptions</li>
                  <li className="flex items-start gap-2"><XCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" /> Poor ATS-incompatible formatting</li>
                  <li className="flex items-start gap-2"><XCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" /> Generic summary with no impact</li>
                </ul>
              </CardContent>
            </Card>
          </motion.div>

          {/* After */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
          >
            <Card className="border-success/30 bg-success/5">
              <CardContent className="pt-6">
                <div className="flex items-center gap-2 mb-4">
                  <CheckCircle2 className="h-5 w-5 text-success" />
                  <span className="font-semibold text-success">After HiResume Fix</span>
                </div>
                <div className="text-5xl font-black text-success mb-4">86<span className="text-xl font-normal text-muted-foreground">/100</span></div>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  <li className="flex items-start gap-2"><CheckCircle2 className="h-4 w-4 text-success shrink-0 mt-0.5" /> ATS-optimized keywords added</li>
                  <li className="flex items-start gap-2"><CheckCircle2 className="h-4 w-4 text-success shrink-0 mt-0.5" /> Quantified achievements & impact</li>
                  <li className="flex items-start gap-2"><CheckCircle2 className="h-4 w-4 text-success shrink-0 mt-0.5" /> Clean, parseable formatting</li>
                  <li className="flex items-start gap-2"><CheckCircle2 className="h-4 w-4 text-success shrink-0 mt-0.5" /> Strong professional summary</li>
                </ul>
              </CardContent>
            </Card>
          </motion.div>
        </div>

        <div className="flex items-center justify-center gap-2 mt-6">
          <TrendingUp className="h-5 w-5 text-primary" />
          <span className="font-semibold text-primary">+44 point improvement</span>
        </div>

        <div className="text-center mt-8">
          <Button size="lg" onClick={onCtaClick} className="text-base px-8 h-12">
            Check My Resume Score <ArrowRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      </div>
    </section>
  );
}
