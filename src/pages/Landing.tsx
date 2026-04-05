import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { Zap, ArrowRight } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { extractTextFromPdf, hashContent } from "@/lib/pdf-parser";
import { useToast } from "@/hooks/use-toast";
import { ScanningAnimation } from "@/components/ScanningAnimation";
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

const MAX_FILE_SIZE = 10 * 1024 * 1024;

export default function Landing() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const [dragOver, setDragOver] = useState(false);
  const [processing, setProcessing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.title = "HireResume – Free ATS Resume Checker & AI Resume Optimizer | hiresume.in";
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

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  if (processing) {
    return (
      <div className="min-h-screen bg-background">
        <nav className="fixed top-0 w-full z-50 glass-strong">
          <div className="container flex items-center justify-between h-16">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
                <Zap className="h-4 w-4 text-primary-foreground" />
              </div>
              <span className="font-bold text-lg text-foreground">HireResume</span>
            </div>
          </div>
        </nav>
        <ScanningAnimation />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Nav */}
      <nav className="fixed top-0 w-full z-50 glass-strong">
        <div className="container flex items-center justify-between h-16 px-4">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
              <Zap className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="font-bold text-lg text-foreground">HireResume</span>
          </div>
          <Button onClick={() => navigate(user ? "/dashboard" : "/auth")} size="sm">
            {user ? "Dashboard" : "Get Started"}
            <ArrowRight className="h-4 w-4" />
          </Button>
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
      <footer className="py-8 border-t border-border">
        <div className="container text-center text-sm text-muted-foreground space-y-3">
          <div className="flex flex-wrap justify-center gap-4">
            <button onClick={() => navigate("/leaderboard")} className="hover:text-foreground transition-colors">Resume Leaderboard</button>
            <button onClick={() => navigate("/college-placement")} className="hover:text-foreground transition-colors">For Colleges</button>
            <button onClick={() => navigate("/reels-campaign")} className="hover:text-foreground transition-colors">#HireResume Reels</button>
          </div>
          <div>© 2026 HireResume. All rights reserved.</div>
        </div>
      </footer>
    </div>
  );
}
