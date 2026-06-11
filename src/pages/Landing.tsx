import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { Zap, ArrowRight, Sparkles } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { extractTextFromPdf, hashContent } from "@/lib/pdf-parser";
import { useToast } from "@/hooks/use-toast";
import { ScanningAnimation } from "@/components/ScanningAnimation";
import { SEOHead } from "@/components/SEOHead";
import { HeroSection } from "@/components/landing/HeroSection";
import { HowItWorksSection } from "@/components/landing/HowItWorksSection";
import { SampleResultSection } from "@/components/landing/SampleResultSection";
import { PricingSection } from "@/components/landing/PricingSection";
import { CreatorSection } from "@/components/landing/CreatorSection";
import { WhyRejectedSection } from "@/components/landing/WhyRejectedSection";
import { BottomCtaSection } from "@/components/landing/BottomCtaSection";
import { StatsSection } from "@/components/landing/StatsSection";
import { TestimonialsSection } from "@/components/landing/TestimonialsSection";
import { VoiceInterviewSection } from "@/components/landing/VoiceInterviewSection";
import { FAQSection } from "@/components/landing/FAQSection";
import { motion } from "framer-motion";

const MAX_FILE_SIZE = 10 * 1024 * 1024;

export default function Landing() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const [dragOver, setDragOver] = useState(false);
  const [processing, setProcessing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.title = "HireResume - Free ATS Resume Checker & AI Mock Interview Platform";
  }, []);

  const handleGuestUpload = async (file: File) => {
    if (!file) return;
    if (file.type !== "application/pdf") {
      const ext = file.name.split(".").pop()?.toLowerCase();
      if (ext === "docx" || ext === "doc") {
        toast({ title: "Unsupported format", description: "DOCX files are not supported yet. Please convert to PDF.", variant: "destructive" });
      } else {
        toast({ title: "Invalid file", description: "Please upload a PDF resume.", variant: "destructive" });
      }
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      toast({ title: "File too large", description: `Maximum file size is 10MB. Your file is ${(file.size / 1024 / 1024).toFixed(1)}MB.`, variant: "destructive" });
      return;
    }
    if (file.size === 0) {
      toast({ title: "Empty file", description: "This file appears to be empty. Please upload a valid PDF.", variant: "destructive" });
      return;
    }

    setProcessing(true);
    try {
      const text = await extractTextFromPdf(file);
      if (!text.trim()) throw new Error("Could not extract text from this PDF. It may be image-based or corrupted.");
      const contentHash = await hashContent(text);

      if (user) {
        sessionStorage.setItem("pendingResume", JSON.stringify({
          resumeText: text,
          fileName: file.name,
          contentHash,
        }));
        navigate("/dashboard?autoAnalyze=true");
        return;
      }

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyze-resume`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          body: JSON.stringify({ resumeText: text, fileName: file.name, contentHash, guestMode: true }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Analysis failed. Please try again.");

      if (data.guestToken) {
        navigate(`/analysis/guest/${data.guestToken}`);
      } else if (data.id) {
        navigate(`/analysis/${data.id}`);
      }
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message || "Could not process PDF. Please try again.", variant: "destructive" });
    } finally {
      setProcessing(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleGuestUpload(file);
  };

  if (processing) {
    return (
      <div className="min-h-screen bg-background">
        <nav className="fixed top-0 w-full z-50 glass-strong">
          <div className="container flex items-center justify-between h-16">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-violet-600 to-cyan-600 flex items-center justify-center">
                <Zap className="h-4 w-4 text-white" />
              </div>
              <span className="font-bold text-lg text-foreground tracking-tight">HireResume</span>
            </div>
          </div>
        </nav>
        <ScanningAnimation />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background relative">
      <SEOHead
        title="HireResume - Free ATS Resume Checker & AI Mock Interview Platform"
        description="Check your ATS resume score free in 10 seconds. AI-powered resume analysis, keyword optimization, resume builder, and mock interviews. Trusted by job seekers worldwide."
        path="/"
        keywords="ATS resume checker, free resume analysis, AI resume optimizer, resume score checker, AI mock interview, resume builder, ATS score, job application tools"
        breadcrumbs={[{ name: "Home", path: "/" }]}
      />
      {/* Nav */}
      <nav className="fixed top-0 w-full z-50 glass-strong border-b border-border/30">
        <div className="container flex items-center justify-between h-16 px-4">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-violet-600 to-cyan-600 flex items-center justify-center shadow-lg shadow-violet-500/20">
              <Zap className="h-4 w-4 text-white" />
            </div>
            <span className="font-bold text-lg text-foreground tracking-tight">HireResume</span>
          </div>
          <div className="flex items-center gap-2">
            <motion.button
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              onClick={() => navigate("/studio")}
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-violet-300 border border-violet-500/30 hover:bg-violet-500/10 transition-colors"
            >
              <Sparkles className="h-3.5 w-3.5" /> Studio
            </motion.button>
            <Button
              onClick={() => navigate(user ? "/dashboard" : "/auth")}
              size="sm"
              className="bg-gradient-to-r from-violet-600 to-cyan-600 border-0 shadow-lg shadow-violet-500/20"
            >
              {user ? "Dashboard" : "Get Started"}
              <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      </nav>

      <HeroSection
        dragOver={dragOver}
        setDragOver={setDragOver}
        onDrop={handleDrop}
        onFileSelect={handleGuestUpload}
        fileInputRef={fileInputRef}
      />

      <StatsSection />

      <HowItWorksSection />

      <SampleResultSection onCtaClick={() => fileInputRef.current?.click()} />

      <WhyRejectedSection />

      <VoiceInterviewSection />

      <TestimonialsSection />

      <PricingSection />

      <FAQSection />

      <CreatorSection />

      <BottomCtaSection onCtaClick={() => fileInputRef.current?.click()} />

      {/* Footer */}
      <footer className="py-8 border-t border-border/30 bg-background/50 backdrop-blur-sm">
        <div className="container text-center text-sm text-muted-foreground space-y-3">
          <div className="flex flex-wrap justify-center gap-4">
            <button onClick={() => navigate("/leaderboard")} className="hover:text-violet-400 transition-colors">Resume Leaderboard</button>
            <button onClick={() => navigate("/college-placement")} className="hover:text-violet-400 transition-colors">For Colleges</button>
            <button onClick={() => navigate("/reels-campaign")} className="hover:text-violet-400 transition-colors">#HireResume Reels</button>
          </div>
          <div className="text-muted-foreground/60">© 2026 HireResume. All rights reserved.</div>
        </div>
      </footer>
    </div>
  );
}
