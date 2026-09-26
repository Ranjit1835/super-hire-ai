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
    <section className="py-12 sm:py-20 px-4">
      <div className="container max-w-4xl">
        <h2 className="text-2xl sm:text-3xl font-bold text-center mb-4">See What You'll Get</h2>
        <p className="text-muted-foreground text-center mb-6 sm:mb-10">An illustrative example — your own score depends on your resume</p>

        <div className="grid grid-cols-2 gap-3 sm:gap-6">
          {/* Before */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
          >
            <Card className="border-destructive/30 bg-destructive/5">
              <CardContent className="p-3 pt-4 sm:p-6">
                <div className="flex items-center gap-1.5 sm:gap-2 mb-2 sm:mb-4">
                  <XCircle className="h-5 w-5 text-destructive" />
                  <span className="font-semibold text-sm sm:text-base text-destructive">Before</span>
                </div>
                <div className="text-3xl sm:text-5xl font-black text-destructive mb-3 sm:mb-4">42<span className="text-base sm:text-xl font-normal text-muted-foreground">/100</span></div>
                <ul className="space-y-2 text-xs sm:text-sm text-muted-foreground">
                  <li className="flex items-start gap-1.5 sm:gap-2"><XCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" /> Missing job keywords</li>
                  <li className="flex items-start gap-1.5 sm:gap-2"><XCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" /> Vague bullet points</li>
                  <li className="flex items-start gap-1.5 sm:gap-2"><XCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" /> Layout ATS can't read</li>
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
              <CardContent className="p-3 pt-4 sm:p-6">
                <div className="flex items-center gap-1.5 sm:gap-2 mb-2 sm:mb-4">
                  <CheckCircle2 className="h-5 w-5 text-success" />
                  <span className="font-semibold text-sm sm:text-base text-success">After the fix</span>
                </div>
                <div className="text-3xl sm:text-5xl font-black text-success mb-3 sm:mb-4">86<span className="text-base sm:text-xl font-normal text-muted-foreground">/100</span></div>
                <ul className="space-y-2 text-xs sm:text-sm text-muted-foreground">
                  <li className="flex items-start gap-1.5 sm:gap-2"><CheckCircle2 className="h-4 w-4 text-success shrink-0 mt-0.5" /> Keywords added</li>
                  <li className="flex items-start gap-1.5 sm:gap-2"><CheckCircle2 className="h-4 w-4 text-success shrink-0 mt-0.5" /> Impact-first bullets</li>
                  <li className="flex items-start gap-1.5 sm:gap-2"><CheckCircle2 className="h-4 w-4 text-success shrink-0 mt-0.5" /> Clean, readable layout</li>
                </ul>
              </CardContent>
            </Card>
          </motion.div>
        </div>

        <div className="flex items-center justify-center gap-2 mt-4 sm:mt-6">
          <TrendingUp className="h-5 w-5 text-primary" />
          <span className="font-semibold text-primary">+44 points in this example</span>
        </div>

        <div className="text-center mt-6 sm:mt-8">
          <Button size="lg" onClick={onCtaClick} className="text-base px-8 h-12">
            Check My Resume Score <ArrowRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      </div>
    </section>
  );
}
