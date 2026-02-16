import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { generateResumePdf, downloadPdf, TemplateType } from "@/lib/pdf-generator";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Download, FileText, Briefcase, Award, Minus, Target } from "lucide-react";
import { motion } from "framer-motion";
import ResumePreview from "@/components/fix-resume/ResumePreview";

interface FixedContent {
  name: string;
  email: string;
  phone?: string;
  summary: string;
  experience: { title: string; company: string; duration: string; bullets: string[] }[];
  education: { degree: string; school: string; year: string }[];
  skills: string[];
}

const templates: { id: TemplateType; label: string; icon: typeof FileText; desc: string; accent: string }[] = [
  { id: "classic", label: "Classic ATS", icon: FileText, desc: "Black & white, maximum ATS compatibility", accent: "border-muted-foreground/30" },
  { id: "modern", label: "Modern Tech", icon: Briefcase, desc: "Blue accents, skill tags, clean spacing", accent: "border-blue-500/40" },
  { id: "executive", label: "Executive Pro", icon: Award, desc: "Navy & gold, premium leadership layout", accent: "border-amber-500/40" },
  { id: "minimal", label: "Minimal Clean", icon: Minus, desc: "Light grey, thin lines, high readability", accent: "border-muted-foreground/20" },
  { id: "impact", label: "Impact-Focused", icon: Target, desc: "Achievements highlighted, metrics emphasized", accent: "border-emerald-500/40" },
];

export default function FixResume() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [fixedContent, setFixedContent] = useState<FixedContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [template, setTemplate] = useState<TemplateType>("classic");

  useEffect(() => {
    if (!id || !user) return;
    supabase
      .from("resume_analyses")
      .select("*")
      .eq("id", id)
      .eq("user_id", user.id)
      .single()
      .then(({ data }) => {
        if (data) {
          generateFix(data);
        } else {
          setLoading(false);
        }
      });
  }, [id, user]);

  const generateFix = async (analysisData: any) => {
    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke("fix-resume", {
        body: { resumeText: analysisData.resume_text, analysisResult: analysisData.analysis_result },
      });
      if (error) throw error;
      setFixedContent(data.fixedContent);
    } catch (err: any) {
      toast({ title: "Fix generation failed", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
      setGenerating(false);
    }
  };

  const handleDownload = async () => {
    if (!fixedContent) return;
    try {
      const bytes = await generateResumePdf(fixedContent, template);
      downloadPdf(bytes, `resume-${template}-${Date.now()}.pdf`);
      toast({ title: "Downloaded!", description: "Your fixed resume PDF has been downloaded." });
    } catch (err: any) {
      toast({ title: "PDF generation failed", description: err.message, variant: "destructive" });
    }
  };

  if (loading || generating) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-primary border-t-transparent mx-auto mb-4" />
          <p className="text-muted-foreground">{generating ? "AI is generating your improved resume..." : "Loading..."}</p>
        </div>
      </div>
    );
  }

  if (!fixedContent) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <p className="text-muted-foreground mb-4">Could not generate fixed resume</p>
          <Button onClick={() => navigate(`/analysis/${id}`)}>Back to Analysis</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border glass-strong sticky top-0 z-50">
        <div className="container flex items-center justify-between h-14">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate(`/analysis/${id}`)}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <span className="font-medium text-sm">Fix My Resume</span>
          </div>
          <Button onClick={handleDownload} size="sm">
            <Download className="h-4 w-4 mr-1" /> Download PDF
          </Button>
        </div>
      </header>

      <main className="container py-8 max-w-6xl">
        {/* Template Selection */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mb-10">
          <h2 className="text-xl font-bold mb-2">Choose Your Template</h2>
          <p className="text-sm text-muted-foreground mb-5">Each template uses a structurally different layout optimized for ATS parsing.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {templates.map((t) => (
              <Card
                key={t.id}
                className={`cursor-pointer transition-all border-2 ${template === t.id ? `${t.accent} bg-primary/5 shadow-md` : "border-transparent hover:border-muted-foreground/10"}`}
                onClick={() => setTemplate(t.id)}
              >
                <CardContent className="py-4 px-4">
                  <div className={`h-9 w-9 rounded-lg flex items-center justify-center mb-2 ${template === t.id ? "bg-primary/20" : "bg-secondary"}`}>
                    <t.icon className={`h-4 w-4 ${template === t.id ? "text-primary" : "text-muted-foreground"}`} />
                  </div>
                  <p className="font-semibold text-sm">{t.label}</p>
                  <p className="text-xs text-muted-foreground mt-1 leading-snug">{t.desc}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </motion.div>

        {/* Preview */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <h2 className="text-xl font-bold mb-4">Resume Preview — {templates.find(t => t.id === template)?.label}</h2>
          <ResumePreview content={fixedContent} template={template} />
        </motion.div>

        <div className="text-center mt-8">
          <Button size="lg" onClick={handleDownload}>
            <Download className="h-4 w-4 mr-2" /> Download as PDF
          </Button>
        </div>
      </main>
    </div>
  );
}
