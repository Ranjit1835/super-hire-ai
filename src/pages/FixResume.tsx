import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { generateResumePdf, downloadPdf, TemplateType } from "@/lib/pdf-generator";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Download, FileText, Briefcase, Award, Minus, Target, Pencil, Eye, Home, Loader2 } from "lucide-react";
import { motion } from "framer-motion";
import ResumePreview, { FixedContent } from "@/components/fix-resume/ResumePreview";
import { AnimatedGradientMesh } from "@/components/premium";

const templates: { id: TemplateType; label: string; icon: typeof FileText; desc: string; color: string }[] = [
  { id: "classic", label: "Classic ATS", icon: FileText, desc: "Black & white, maximum ATS compatibility", color: "violet" },
  { id: "modern", label: "Modern Tech", icon: Briefcase, desc: "Blue accents, skill tags, clean spacing", color: "cyan" },
  { id: "executive", label: "Executive Pro", icon: Award, desc: "Navy & gold, premium leadership layout", color: "amber" },
  { id: "minimal", label: "Minimal Clean", icon: Minus, desc: "Light grey, thin lines, high readability", color: "slate" },
  { id: "impact", label: "Impact-Focused", icon: Target, desc: "Achievements highlighted, metrics emphasized", color: "emerald" },
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
  const [editable, setEditable] = useState(false);

  useEffect(() => {
    if (!id || !user) return;

    const checkAccess = async () => {
      try {
        const session = (await supabase.auth.getSession()).data.session;
        const res = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/check-fix-access?resumeAnalysisId=${id}`,
          { headers: { Authorization: `Bearer ${session?.access_token}`, apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY } }
        );
        const accessData = await res.json();
        if (!accessData.canAccess) {
          toast({ title: "Payment required", description: "Please unlock this resume fix first.", variant: "destructive" });
          navigate(`/analysis/${id}`);
          return;
        }
      } catch {
        toast({ title: "Access check failed", variant: "destructive" });
        navigate(`/analysis/${id}`);
        return;
      }

      const { data } = await supabase
        .from("resume_analyses")
        .select("*")
        .eq("id", id)
        .eq("user_id", user.id)
        .single();
      if (data) {
        generateFix(data);
      } else {
        setLoading(false);
      }
    };
    checkAccess();
  }, [id, user]);

  const generateFix = async (analysisData: any) => {
    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke("fix-resume", {
        body: { resumeText: analysisData.resume_text, analysisResult: analysisData.analysis_result },
      });
      if (error) throw error;
      if (!data?.fixedContent) throw new Error("No content returned");
      const fc = data.fixedContent;
      setFixedContent({
        name: fc.name || "Name",
        email: fc.email || "",
        phone: fc.phone || "",
        summary: fc.summary || "",
        experience: (fc.experience || []).map((e: any) => ({
          title: e.title || "",
          company: e.company || "",
          duration: e.duration || "",
          bullets: (e.bullets || []).filter((b: any) => typeof b === "string" && b.trim()),
        })),
        education: (fc.education || []).map((e: any) => ({
          degree: e.degree || "",
          school: e.school || "",
          year: e.year || "",
        })),
        skills: (fc.skills || []).filter((s: any) => typeof s === "string" && s.trim()),
      });
    } catch (err: any) {
      console.error("Fix generation failed:", err);
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
      console.error("PDF generation error:", err);
      toast({ title: "PDF generation failed", description: err.message, variant: "destructive" });
    }
  };

  if (loading || generating) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background relative">
        <AnimatedGradientMesh />
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-center relative z-10"
        >
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
            className="mx-auto mb-4"
          >
            <Loader2 className="h-10 w-10 text-violet-400" />
          </motion.div>
          <p className="text-muted-foreground">{generating ? "AI is generating your improved resume..." : "Loading..."}</p>
        </motion.div>
      </div>
    );
  }

  if (!fixedContent) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background relative">
        <AnimatedGradientMesh />
        <div className="text-center relative z-10">
          <p className="text-muted-foreground mb-4">Could not generate fixed resume</p>
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => navigate(`/analysis/${id}`)}
            className="px-6 py-2.5 rounded-lg text-sm font-semibold bg-gradient-to-r from-violet-600 to-cyan-600 text-white hover:shadow-lg hover:shadow-violet-500/25 transition-all"
          >
            Back to Analysis
          </motion.button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background relative">
      <AnimatedGradientMesh />

      <header className="border-b border-violet-500/10 glass-strong sticky top-0 z-50 relative">
        <div className="container flex items-center justify-between h-14">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={() => navigate(`/analysis/${id}`)} className="text-muted-foreground hover:text-foreground hover:bg-violet-500/5">
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <span className="font-semibold text-sm text-foreground">Fix My Resume</span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => navigate("/dashboard")} className="text-muted-foreground hover:text-foreground hover:bg-violet-500/5">
              <Home className="h-4 w-4 mr-1" /> Dashboard
            </Button>
            <Button
              variant={editable ? "default" : "outline"}
              size="sm"
              onClick={() => setEditable(!editable)}
              className={editable ? "bg-gradient-to-r from-violet-600 to-cyan-600 text-white border-0" : "border-violet-500/20 hover:border-violet-500/40"}
            >
              {editable ? <><Eye className="h-4 w-4 mr-1" /> Preview</> : <><Pencil className="h-4 w-4 mr-1" /> Edit</>}
            </Button>
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={handleDownload}
              className="px-3 py-1.5 rounded-lg text-sm font-semibold bg-gradient-to-r from-violet-600 to-cyan-600 text-white hover:shadow-lg hover:shadow-violet-500/25 transition-all flex items-center gap-1"
            >
              <Download className="h-4 w-4" /> Download PDF
            </motion.button>
          </div>
        </div>
      </header>

      <main className="container py-8 max-w-6xl relative z-10">
        {/* Template Selection */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mb-10">
          <h2 className="text-xl font-bold mb-2 text-foreground">Choose Your Template</h2>
          <p className="text-sm text-muted-foreground mb-5">Each template uses a structurally different layout optimized for ATS parsing.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {templates.map((t) => (
              <motion.button
                key={t.id}
                whileHover={{ y: -3, scale: 1.01 }}
                whileTap={{ scale: 0.98 }}
                className={`text-left p-4 rounded-xl border-2 transition-all ${
                  template === t.id
                    ? `border-violet-500/50 bg-violet-500/10 shadow-lg shadow-violet-500/10`
                    : "border-violet-500/10 glass hover:border-violet-500/30 card-hover-glow"
                }`}
                onClick={() => setTemplate(t.id)}
              >
                <div className={`h-9 w-9 rounded-lg flex items-center justify-center mb-2 ${
                  template === t.id ? "bg-violet-500/20 border border-violet-500/30" : "bg-white/5 border border-violet-500/10"
                }`}>
                  <t.icon className={`h-4 w-4 ${template === t.id ? "text-violet-400" : "text-muted-foreground"}`} />
                </div>
                <p className="font-semibold text-sm text-foreground">{t.label}</p>
                <p className="text-xs text-muted-foreground mt-1 leading-snug">{t.desc}</p>
              </motion.button>
            ))}
          </div>
        </motion.div>

        {/* Preview */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <h2 className="text-xl font-bold mb-4 text-foreground">
            Resume Preview — {templates.find(t => t.id === template)?.label}
            {editable && <span className="text-violet-400 text-sm font-normal ml-2">(Editing Mode)</span>}
          </h2>
          <ResumePreview
            content={fixedContent}
            template={template}
            editable={editable}
            onContentChange={setFixedContent}
          />
        </motion.div>

        <div className="text-center mt-8">
          <motion.button
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            onClick={handleDownload}
            className="px-8 py-3 rounded-xl text-sm font-semibold bg-gradient-to-r from-violet-600 to-cyan-600 text-white hover:shadow-xl hover:shadow-violet-500/25 transition-all inline-flex items-center gap-2"
          >
            <Download className="h-4 w-4" /> Download as PDF
          </motion.button>
        </div>
      </main>
    </div>
  );
}
