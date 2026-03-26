import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Zap, ArrowLeft } from "lucide-react";
import { motion } from "framer-motion";
import { ResumeBuilderWizard } from "@/components/resume-builder/ResumeBuilderWizard";
import { ResumeTemplatePreview } from "@/components/resume-builder/ResumeTemplatePreview";
import { ResumeBuilderPayment } from "@/components/resume-builder/ResumeBuilderPayment";
import { ResumeContent, TemplateId, emptyResumeContent } from "@/lib/resume-builder-types";
import { generateResumePdf } from "@/lib/resume-pdf-generator";

type Phase = "wizard" | "preview";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export default function ResumeBuilder() {
  const { user, session } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [phase, setPhase] = useState<Phase>("wizard");
  const [resumeId, setResumeId] = useState<string | null>(null);
  const [content, setContent] = useState<ResumeContent>(emptyResumeContent);
  const [enhancedContent, setEnhancedContent] = useState<ResumeContent | null>(null);
  const [templateId, setTemplateId] = useState<TemplateId>("minimal-ats");
  const [isPaid, setIsPaid] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    document.title = "Resume Builder – HireResume";
  }, []);

  const handleWizardSubmit = async (formContent: ResumeContent) => {
    setSubmitting(true);
    setContent(formContent);

    try {
      // Save to DB first
      const { data: saved, error: saveErr } = await supabase
        .from("resume_builders")
        .insert({
          user_id: user!.id,
          content_json: formContent as any,
          template_id: templateId,
        })
        .select("id")
        .single();

      if (saveErr) throw saveErr;
      setResumeId(saved.id);

      // Call AI enhancement
      const accessToken = session?.access_token;
      const res = await fetch(`${SUPABASE_URL}/functions/v1/enhance-resume`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_KEY,
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({ content: formContent }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.enhanced) {
          setEnhancedContent(data.enhanced);
          // Save enhanced content
          await supabase
            .from("resume_builders")
            .update({ enhanced_json: data.enhanced as any })
            .eq("id", saved.id);
        }
      } else {
        // If AI fails, continue with original content
        toast({ title: "AI enhancement unavailable", description: "Using your original content. You can still preview and download.", variant: "default" });
      }

      setPhase("preview");
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Failed to save resume", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const handlePaymentSuccess = async () => {
    setIsPaid(true);
    if (resumeId) {
      await supabase
        .from("resume_builders")
        .update({ is_paid: true, paid_at: new Date().toISOString() })
        .eq("id", resumeId);
    }
  };

  const handleDownload = async () => {
    try {
      const displayContent = enhancedContent || content;
      const pdfBytes = await generateResumePdf(displayContent, templateId);
      const blob = new Blob([new Uint8Array(pdfBytes)], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${displayContent.basicInfo.fullName || "resume"}_HireResume.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      toast({ title: "Download failed", description: err.message, variant: "destructive" });
    }
  };

  const displayContent = enhancedContent || content;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border glass-strong sticky top-0 z-50">
        <div className="container flex items-center justify-between h-14">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-lg bg-primary flex items-center justify-center">
              <Zap className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="font-bold text-foreground">HireResume</span>
            <Badge variant="secondary" className="text-xs">Builder</Badge>
          </div>
          <Button variant="ghost" size="sm" onClick={() => navigate("/dashboard")}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Dashboard
          </Button>
        </div>
      </header>

      <main className="container py-6 sm:py-8 px-4">
        {phase === "wizard" && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
            <div className="text-center mb-8">
              <h1 className="text-2xl sm:text-3xl font-bold mb-2">Build Your Resume</h1>
              <p className="text-muted-foreground text-sm">Fill in your details step-by-step. AI will enhance your content.</p>
            </div>
            <ResumeBuilderWizard onSubmit={handleWizardSubmit} submitting={submitting} />
          </motion.div>
        )}

        {phase === "preview" && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
            <div className="text-center mb-6">
              <h1 className="text-2xl font-bold mb-1">Your AI-Enhanced Resume</h1>
              <p className="text-sm text-muted-foreground">
                {enhancedContent ? "AI has improved your content. Switch templates and preview below." : "Preview your resume. Switch templates below."}
              </p>
              {enhancedContent && (
                <div className="flex justify-center gap-2 mt-3">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setEnhancedContent(null)}
                    className={!enhancedContent ? "border-primary" : ""}
                  >
                    Original
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {/* already showing enhanced */}}
                    className={enhancedContent ? "border-primary bg-primary/5" : ""}
                  >
                    AI Enhanced ✨
                  </Button>
                </div>
              )}
            </div>

            <div className="grid lg:grid-cols-2 gap-8 max-w-6xl mx-auto">
              {/* Preview */}
              <div>
                <ResumeTemplatePreview
                  content={displayContent}
                  templateId={templateId}
                  onTemplateChange={setTemplateId}
                  isPaid={isPaid}
                />
              </div>

              {/* Payment + Actions */}
              <div className="space-y-6">
                <ResumeBuilderPayment
                  resumeBuilderId={resumeId || ""}
                  isPaid={isPaid}
                  onPaymentSuccess={handlePaymentSuccess}
                  onDownload={handleDownload}
                  userEmail={user?.email || ""}
                />

                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => setPhase("wizard")}
                >
                  ← Edit Resume Content
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </main>
    </div>
  );
}
