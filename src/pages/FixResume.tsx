import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { generateResumePdf, downloadPdf } from "@/lib/pdf-generator";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Download, Zap, FileText, Briefcase, Award } from "lucide-react";
import { motion } from "framer-motion";

interface FixedContent {
  name: string;
  email: string;
  phone?: string;
  summary: string;
  experience: { title: string; company: string; duration: string; bullets: string[] }[];
  education: { degree: string; school: string; year: string }[];
  skills: string[];
}

export default function FixResume() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [analysis, setAnalysis] = useState<any>(null);
  const [fixedContent, setFixedContent] = useState<FixedContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [template, setTemplate] = useState<"classic" | "modern" | "executive">("classic");

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
          setAnalysis(data);
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
        body: {
          resumeText: analysisData.resume_text,
          analysisResult: analysisData.analysis_result,
        },
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

  const templates = [
    { id: "classic" as const, label: "Classic ATS", icon: FileText, desc: "Clean, traditional format" },
    { id: "modern" as const, label: "Modern Tech", icon: Briefcase, desc: "Developer/tech focused" },
    { id: "executive" as const, label: "Executive", icon: Award, desc: "Senior/leadership" },
  ];

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

      <main className="container py-8 max-w-5xl">
        {/* Template Selection */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
          <h2 className="text-xl font-bold mb-4">Choose Template</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {templates.map((t) => (
              <Card
                key={t.id}
                className={`glass cursor-pointer transition-all ${template === t.id ? "border-primary/50 bg-primary/5" : "hover:border-primary/20"}`}
                onClick={() => setTemplate(t.id)}
              >
                <CardContent className="flex items-center gap-3 py-4">
                  <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${template === t.id ? "bg-primary/20" : "bg-secondary"}`}>
                    <t.icon className={`h-5 w-5 ${template === t.id ? "text-primary" : "text-muted-foreground"}`} />
                  </div>
                  <div>
                    <p className="font-medium text-sm">{t.label}</p>
                    <p className="text-xs text-muted-foreground">{t.desc}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </motion.div>

        {/* Preview */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <h2 className="text-xl font-bold mb-4">Resume Preview</h2>
          <Card className="glass">
            <CardContent className="py-8 px-6 sm:px-10 space-y-6">
              <div className="border-b border-border pb-4">
                <h3 className="text-2xl font-bold">{fixedContent.name}</h3>
                <p className="text-sm text-muted-foreground">{fixedContent.email}{fixedContent.phone ? ` | ${fixedContent.phone}` : ""}</p>
              </div>

              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-primary mb-2">Professional Summary</h4>
                <p className="text-sm text-muted-foreground leading-relaxed">{fixedContent.summary}</p>
              </div>

              {fixedContent.experience?.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-primary mb-3">Experience</h4>
                  <div className="space-y-4">
                    {fixedContent.experience.map((exp, i) => (
                      <div key={i}>
                        <div className="flex items-center justify-between">
                          <p className="font-semibold text-sm">{exp.title}</p>
                          <span className="text-xs text-muted-foreground">{exp.duration}</span>
                        </div>
                        <p className="text-xs text-muted-foreground mb-2">{exp.company}</p>
                        <ul className="space-y-1">
                          {exp.bullets.map((b, j) => (
                            <li key={j} className="text-sm text-muted-foreground flex items-start gap-2">
                              <span className="text-primary">•</span> {b}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {fixedContent.education?.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-primary mb-2">Education</h4>
                  {fixedContent.education.map((edu, i) => (
                    <div key={i} className="mb-2">
                      <p className="font-medium text-sm">{edu.degree}</p>
                      <p className="text-xs text-muted-foreground">{edu.school} — {edu.year}</p>
                    </div>
                  ))}
                </div>
              )}

              {fixedContent.skills?.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-primary mb-2">Skills</h4>
                  <p className="text-sm text-muted-foreground">{fixedContent.skills.join(" • ")}</p>
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>

        <div className="text-center mt-8">
          <Button size="lg" onClick={handleDownload}>
            <Download className="h-4 w-4 mr-2" /> Download as PDF ({template})
          </Button>
        </div>
      </main>
    </div>
  );
}
