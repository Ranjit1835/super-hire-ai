import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";

interface BottomCtaSectionProps {
  onCtaClick: () => void;
}

export function BottomCtaSection({ onCtaClick }: BottomCtaSectionProps) {
  return (
    <section className="py-16 sm:py-20 px-4">
      <div className="container max-w-3xl text-center">
        <div className="glass rounded-2xl p-8 sm:p-12">
          <h2 className="text-2xl sm:text-3xl font-bold mb-3">Stop Getting Rejected.</h2>
          <p className="text-muted-foreground mb-8 max-w-xl mx-auto">
            Upload your resume and get a detailed, recruiter-grade analysis in under 30 seconds. Know exactly where you stand.
          </p>
          <Button size="lg" onClick={onCtaClick} className="text-base px-8 sm:px-10 h-12">
            Check My Resume Score <ArrowRight className="h-4 w-4 ml-1" />
          </Button>
          <p className="text-xs text-muted-foreground mt-3">
            Free analysis · No credit card required
          </p>
        </div>
      </div>
    </section>
  );
}
