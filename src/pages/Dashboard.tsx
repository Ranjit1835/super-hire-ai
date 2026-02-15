import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { extractTextFromPdf, hashContent } from "@/lib/pdf-parser";
import { useToast } from "@/hooks/use-toast";
import { Upload, FileText, LogOut, Zap, Clock, TrendingUp, Trash2 } from "lucide-react";
import { motion } from "framer-motion";

export default function Dashboard() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [analyses, setAnalyses] = useState<any[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const fetchAnalyses = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("resume_analyses")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    if (data) setAnalyses(data);
  }, [user]);

  useEffect(() => { fetchAnalyses(); }, [fetchAnalyses]);

  const handleFile = async (file: File) => {
    if (!file || file.type !== "application/pdf") {
      toast({ title: "Invalid file", description: "Please upload a PDF", variant: "destructive" });
      return;
    }
    setUploading(true);
    try {
      const text = await extractTextFromPdf(file);
      if (!text.trim()) throw new Error("Could not extract text from PDF");
      const contentHash = await hashContent(text);

      // Check cache
      const { data: cached } = await supabase
        .from("resume_analyses")
        .select("id")
        .eq("user_id", user!.id)
        .eq("content_hash", contentHash)
        .maybeSingle();

      if (cached) {
        toast({ title: "Already analyzed", description: "Navigating to existing analysis." });
        navigate(`/analysis/${cached.id}`);
        return;
      }

      // Call edge function
      const { data, error } = await supabase.functions.invoke("analyze-resume", {
        body: { resumeText: text, fileName: file.name, contentHash },
      });

      if (error) throw error;
      if (data?.id) {
        navigate(`/analysis/${data.id}`);
      }
    } catch (err: any) {
      toast({ title: "Analysis failed", description: err.message || "Something went wrong", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleDelete = async (id: string) => {
    await supabase.from("resume_analyses").delete().eq("id", id);
    setAnalyses((prev) => prev.filter((a) => a.id !== id));
  };

  const competitivenessColor = (level: string) => {
    switch (level) {
      case "Elite": return "text-primary";
      case "Strong": return "text-success";
      case "Competitive": return "text-warning";
      default: return "text-destructive";
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border glass-strong sticky top-0 z-50">
        <div className="container flex items-center justify-between h-14">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-lg bg-primary flex items-center justify-center">
              <Zap className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="font-bold text-foreground">Super Hire AI</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground hidden sm:block">{user?.email}</span>
            <Button variant="ghost" size="sm" onClick={signOut}><LogOut className="h-4 w-4" /></Button>
          </div>
        </div>
      </header>

      <main className="container py-8 max-w-5xl">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="text-3xl font-bold mb-1">Dashboard</h1>
          <p className="text-muted-foreground mb-8">Upload a resume to get your AI-powered analysis</p>
        </motion.div>

        {/* Upload zone */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <Card
            className={`glass cursor-pointer transition-all mb-8 ${dragOver ? "border-primary/50 bg-primary/5" : "hover:border-primary/30"}`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => !uploading && document.getElementById("file-input")?.click()}
          >
            <CardContent className="flex flex-col items-center justify-center py-12">
              {uploading ? (
                <div className="flex flex-col items-center gap-3">
                  <div className="h-10 w-10 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                  <p className="text-sm text-muted-foreground">Analyzing your resume...</p>
                </div>
              ) : (
                <>
                  <div className="h-14 w-14 rounded-xl bg-primary/10 flex items-center justify-center mb-4">
                    <Upload className="h-6 w-6 text-primary" />
                  </div>
                  <p className="font-medium mb-1">Drop your resume PDF here</p>
                  <p className="text-sm text-muted-foreground">or click to browse</p>
                </>
              )}
              <input
                id="file-input"
                type="file"
                accept=".pdf"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
              />
            </CardContent>
          </Card>
        </motion.div>

        {/* History */}
        {analyses.length > 0 && (
          <div>
            <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
              <Clock className="h-5 w-5 text-muted-foreground" /> Analysis History
            </h2>
            <div className="space-y-3">
              {analyses.map((a, i) => (
                <motion.div key={a.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
                  <Card className="glass hover:border-primary/30 transition-colors">
                    <CardContent className="flex items-center justify-between py-4">
                      <div className="flex items-center gap-4 cursor-pointer flex-1" onClick={() => navigate(`/analysis/${a.id}`)}>
                        <div className="h-10 w-10 rounded-lg bg-secondary flex items-center justify-center shrink-0">
                          <FileText className="h-5 w-5 text-muted-foreground" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium truncate">{a.file_name}</p>
                          <p className="text-xs text-muted-foreground">{new Date(a.created_at).toLocaleDateString()}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        {a.ats_score !== null && (
                          <div className="text-right hidden sm:block">
                            <div className="flex items-center gap-1">
                              <TrendingUp className="h-3 w-3 text-muted-foreground" />
                              <span className="text-sm font-semibold">ATS: {a.ats_score}</span>
                            </div>
                            <span className={`text-xs font-medium ${competitivenessColor(a.market_competitiveness || "")}`}>
                              {a.market_competitiveness}
                            </span>
                          </div>
                        )}
                        <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); handleDelete(a.id); }}>
                          <Trash2 className="h-4 w-4 text-muted-foreground" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
