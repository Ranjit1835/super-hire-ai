import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { ArrowRight, Sparkles } from "lucide-react";
import { PublicNavbar } from "@/components/PublicNavbar";
import { PublicFooter } from "@/components/PublicFooter";
import { useGuestResumeUpload } from "@/hooks/useGuestResumeUpload";
import { UploadFailurePanel } from "@/components/UploadFailurePanel";
import { ScanningAnimation } from "@/components/ScanningAnimation";
import { SEOHead } from "@/components/SEOHead";
import { HeroSection } from "@/components/landing/HeroSection";
import { HowItWorksSection } from "@/components/landing/HowItWorksSection";
import { SampleResultSection } from "@/components/landing/SampleResultSection";
import { PricingSection } from "@/components/landing/PricingSection";
import { CreatorSection } from "@/components/landing/CreatorSection";
import { WhyRejectedSection } from "@/components/landing/WhyRejectedSection";
import { BottomCtaSection } from "@/components/landing/BottomCtaSection";
import { VoiceInterviewSection } from "@/components/landing/VoiceInterviewSection";
import { FAQSection, faqJsonLd } from "@/components/landing/FAQSection";
import { softwareApplicationJsonLd } from "@/seo/schema";
import { motion } from "framer-motion";

export default function Landing() {
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const retryInputRef = useRef<HTMLInputElement>(null);
  const { processing, failure, upload: handleGuestUpload, retry, reset } = useGuestResumeUpload();

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleGuestUpload(file);
  };

  if (failure && !processing) {
    return (
      <div className="min-h-screen bg-background">
        <PublicNavbar />
        <main className="pt-32 pb-16 px-4">
          <UploadFailurePanel failure={failure} onRetry={retry} onPickAnother={() => retryInputRef.current?.click()} />
          <input
            ref={retryInputRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void handleGuestUpload(f); }}
          />
          <p className="text-center mt-6"><button type="button" onClick={reset} className="text-sm text-muted-foreground hover:text-foreground underline underline-offset-2">Back to home</button></p>
        </main>
      </div>
    );
  }

  if (processing) {
    return (
      <div className="min-h-screen bg-background">
        <PublicNavbar />
        <ScanningAnimation />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background relative">
      <SEOHead
        title="HiResume - Free ATS Resume Checker & AI Mock Interview | India"
        description="Check your resume's ATS score free in 10 seconds - no signup. Keyword gap analysis, AI resume fix, ATS-friendly resume builder and AI voice mock interviews for freshers and job seekers in India."
        path="/"
        keywords="ATS resume checker, free ATS score checker, resume score checker India, AI mock interview, ATS friendly resume builder, resume checker for freshers"
        breadcrumbs={[{ name: "Home", path: "/" }]}
        jsonLd={[faqJsonLd, softwareApplicationJsonLd()]}
      />
      <PublicNavbar />

      <HeroSection
        dragOver={dragOver}
        setDragOver={setDragOver}
        onDrop={handleDrop}
        onFileSelect={handleGuestUpload}
        fileInputRef={fileInputRef}
      />


      <HowItWorksSection />

      <SampleResultSection onCtaClick={() => fileInputRef.current?.click()} />

      <WhyRejectedSection />

      <VoiceInterviewSection />


      <PricingSection />

      <FAQSection />

      <CreatorSection />

      <BottomCtaSection onCtaClick={() => fileInputRef.current?.click()} />

      <PublicFooter />
    </div>
  );
}
