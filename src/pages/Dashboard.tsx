import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { extractTextFromPdf, hashContent } from "@/lib/pdf-parser";
import { useToast } from "@/hooks/use-toast";
import { Upload, FileText, LogOut, Zap, Clock, TrendingUp, Trash2, ChevronDown, FileEdit, Mic } from "lucide-react";
import { motion } from "framer-motion";
import { ScanningAnimation } from "@/components/ScanningAnimation";
import { Badge } from "@/components/ui/badge";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

function validateFile(file: File): string | null {
  if (!file) return "No file selected";
  if (file.type !== "application/pdf") {
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext === "docx" || ext === "doc") return "DOCX files are not supported yet. Please convert to PDF and try again.";
    if (["jpg", "jpeg", "png", "gif", "webp"].includes(ext || "")) return "Image files are not resumes. Please upload a PDF.";
    if (["exe", "zip", "rar"].includes(ext || "")) return "This file type is not supported. Please upload a PDF.";
    return "Please upload a PDF file. Other formats are not supported.";
  }
  if (file.size > MAX_FILE_SIZE) return `File is too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Maximum size is 10MB.`;
  if (file.size === 0) return "This file is empty. Please upload a valid PDF.";
  return null;
}

export default function Dashboard() {
  const { user, signOut, session } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { toast } = useToast();
  const [analyses, setAnalyses] = useState<any[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const autoAnalyzeTriggered = useRef(false);

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
  useEffect(() => { document.title = "Dashboard – HireResume"; }, []);

  // Auto-analyze from guest upload flow
  useEffect(() => {
    if (autoAnalyzeTriggered.current) return;
    if (searchParams.get("autoAnalyze") !== "true") return;
    const pendingRaw = sessionStorage.getItem("pendingResume");
    if (!pendingRaw || !user) return;

    autoAnalyzeTriggered.current = true;
    setSearchParams({}, { replace: true });

    const pending = JSON.parse(pendingRaw);
    sessionStorage.removeItem("pendingResume");

    handlePendingAnalysis(pending.resumeText, pending.fileName, pending.contentHash);
  }, [searchParams, user]);

  const handlePendingAnalysis = async (resumeText: string, fileName: string, contentHash: string) => {
    setUploading(true);
    try {
      const { data: cached } = await supabase
        .from("resume_analyses")
        .select("id")
        .eq("user_id", user!.id)
        .eq("content_hash", contentHash)
        .maybeSingle();

      if (cached) {
        await new Promise((resolve) => setTimeout(resolve, 1800));
        navigate(`/analysis/${cached.id}`);
        return;
      }

      const accessToken = session?.access_token;
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyze-resume`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          },
          body: JSON.stringify({ resumeText, fileName, contentHash }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Analysis failed");
      if (data?.id) {
        navigate(`/analysis/${data.id}`);
      }
    } catch (err: any) {
      toast({ title: "Analysis failed", description: err.message || "Something went wrong. Please try again.", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const handleFile = async (file: File) => {
    const validationError = validateFile(file);
    if (validationError) {
      toast({ title: "Invalid file", description: validationError, variant: "destructive" });
      return;
    }
    setUploading(true);
    try {
      const text = await extractTextFromPdf(file);
      if (!text.trim()) throw new Error("Could not extract text from this PDF. It may be image-based or corrupted. Try a different PDF.");
      const contentHash = await hashContent(text);

      const { data: cached } = await supabase
        .from("resume_analyses")
        .select("id")
        .eq("user_id", user!.id)
        .eq("content_hash", contentHash)
        .maybeSingle();

      if (cached) {
        await new Promise((resolve) => setTimeout(resolve, 1800));
        navigate(`/analysis/${cached.id}`);
        return;
      }

      const previousAnalysisId = analyses.length > 0 ? analyses[0].id : undefined;

      const accessToken = session?.access_token;
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyze-resume`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          },
          body: JSON.stringify({ resumeText: text, fileName: file.name, contentHash, previousAnalysisId }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Analysis failed");
      if (data?.id) {
        navigate(`/analysis/${data.id}`);
      }
    } catch (err: any) {
      toast({ title: "Analysis failed", description: err.message || "Something went wrong. Please try again.", variant: "destructive" });
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

  const displayedAnalyses = showAll ? analyses : analyses.slice(0, 3);

  // Fetch early bird status
  const [earlyBirdActive, setEarlyBirdActive] = useState(false);
  useEffect(() => {
    if (!user) return;
    supabase.from("profiles").select("early_bird_active, early_bird_expiry_date").eq("user_id", user.id).single().then(({ data }: any) => {
      if (data?.early_bird_active && data.early_bird_expiry_date && new Date(data.early_bird_expiry_date) > new Date()) {
        setEarlyBirdActive(true);
      }
    });
  }, [user]);

  if (uploading) {
    return (
      <div className="min-h-screen bg-background">
        <header className="border-b border-border glass-strong sticky top-0 z-50">
          <div className="container flex items-center justify-between h-14">
            <div className="flex items-center gap-2">
              <div className="h-7 w-7 rounded-lg bg-primary flex items-center justify-center">
                <Zap className="h-4 w-4 text-primary-foreground" />
              </div>
              <span className="font-bold text-foreground">HireResume</span>
            </div>
          </div>
        </header>
        <ScanningAnimation />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border glass-strong sticky top-0 z-50">
        <div className="container flex items-center justify-between h-14">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-lg bg-primary flex items-center justify-center">
              <Zap className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="font-bold text-foreground">HireResume</span>
            {earlyBirdActive && <Badge className="bg-primary/20 text-primary border-primary/30 text-xs ml-2 hidden sm:inline-flex">Early Bird ✦</Badge>}
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground hidden sm:block">{user?.email}</span>
            <Button variant="ghost" size="sm" onClick={async () => {
              if (session?.access_token) {
                const tokenSuffix = session.access_token.slice(-16);
                await supabase.from("user_sessions").delete().eq("session_token", tokenSuffix);
              }
              await signOut();
              navigate("/auth");
            }}>
              <LogOut className="h-4 w-4 mr-1" /> <span className="hidden sm:inline">Sign Out</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="container py-6 sm:py-8 max-w-5xl px-4">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <div className="flex items-center justify-between mb-1">
            <h1 className="text-2xl sm:text-3xl font-bold">Dashboard</h1>
            <Button size="sm" onClick={() => document.getElementById("file-input")?.click()}>
              <Upload className="h-4 w-4 mr-1" /> <span className="hidden sm:inline">Analyze New Resume</span><span className="sm:hidden">Upload</span>
            </Button>
          </div>
          <p className="text-muted-foreground mb-6 sm:mb-8 text-sm">Upload a resume to get your AI-powered analysis</p>
        </motion.div>

        {/* Upload zone */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <Card
            className={`glass cursor-pointer transition-all duration-200 mb-8 hover:shadow-lg hover:-translate-y-0.5 ${dragOver ? "border-primary/50 bg-primary/5" : "hover:border-primary/30"}`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => document.getElementById("file-input")?.click()}
          >
            <CardContent className="flex flex-col items-center justify-center py-10 sm:py-12">
              <div className="h-14 w-14 rounded-xl bg-primary/10 flex items-center justify-center mb-4">
                <Upload className="h-6 w-6 text-primary" />
              </div>
              <p className="font-medium mb-1">Drop your resume PDF here</p>
              <p className="text-sm text-muted-foreground">or click to browse · Max 10MB</p>
              <input
                id="file-input"
                type="file"
                accept=".pdf"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files?.[0]) handleFile(e.target.files[0]);
                  e.target.value = ""; // Reset so same file can be re-selected
                }}
              />
            </CardContent>
          </Card>
        </motion.div>

        {/* History */}
        {analyses.length > 0 ? (
          <div>
            <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
              <Clock className="h-5 w-5 text-muted-foreground" /> Analysis History
            </h2>
            <div className="space-y-3">
              {displayedAnalyses.map((a, i) => (
                <motion.div key={a.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
                  <Card className="glass hover:border-primary/30 transition-all duration-200 hover:shadow-md hover:-translate-y-0.5">
                    <CardContent className="flex items-center justify-between py-4">
                      <div className="flex items-center gap-3 sm:gap-4 cursor-pointer flex-1 min-w-0" onClick={() => navigate(`/analysis/${a.id}`)}>
                        <div className="h-10 w-10 rounded-lg bg-secondary flex items-center justify-center shrink-0">
                          <FileText className="h-5 w-5 text-muted-foreground" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium truncate text-sm sm:text-base">{a.file_name}</p>
                          <p className="text-xs text-muted-foreground">{new Date(a.created_at).toLocaleDateString()}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 sm:gap-4">
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
                        {a.ats_score !== null && (
                          <span className="text-sm font-semibold sm:hidden">{a.ats_score}</span>
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
            {analyses.length > 3 && (
              <div className="text-center mt-4">
                <Button variant="ghost" size="sm" onClick={() => setShowAll(!showAll)}>
                  <ChevronDown className={`h-4 w-4 mr-1 transition-transform ${showAll ? "rotate-180" : ""}`} />
                  {showAll ? "Show Less" : `View All (${analyses.length})`}
                </Button>
              </div>
            )}
          </div>
        ) : (
          /* Empty state */
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }} className="text-center py-12">
            <div className="h-16 w-16 rounded-2xl bg-secondary/50 flex items-center justify-center mx-auto mb-4">
              <FileText className="h-8 w-8 text-muted-foreground/60" />
            </div>
            <h3 className="font-semibold text-lg mb-1">No analyses yet</h3>
            <p className="text-sm text-muted-foreground mb-6">Upload your resume to get started with your first AI analysis</p>
            <Button onClick={() => document.getElementById("file-input")?.click()}>
              <Upload className="h-4 w-4 mr-2" /> Upload Your First Resume
            </Button>
          </motion.div>
        )}

        {/* Coming Soon Feature Cards */}
        <div className="mt-12 grid md:grid-cols-2 gap-6">
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
            <Card className="glass relative overflow-hidden transition-all duration-300 hover:shadow-xl hover:-translate-y-1">
              <CardContent className="flex flex-col items-center text-center py-10 px-6">
                <Badge variant="secondary" className="absolute top-4 right-4 text-xs">Coming Soon</Badge>
                <div className="h-14 w-14 rounded-xl bg-primary/10 flex items-center justify-center mb-5">
                  <FileEdit className="h-6 w-6 text-primary" />
                </div>
                <h3 className="text-lg font-bold mb-2">Create Resume From Scratch With HireResume</h3>
                <p className="text-sm text-muted-foreground mb-6 leading-relaxed">Build a recruiter-ready resume step-by-step using AI guidance.</p>
                <Button disabled className="pointer-events-none opacity-60">
                  Create Resume From Scratch
                </Button>
              </CardContent>
            </Card>
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
            <Card className="glass relative overflow-hidden transition-all duration-300 hover:shadow-xl hover:-translate-y-1">
              <CardContent className="flex flex-col items-center text-center py-10 px-6">
                <Badge variant="secondary" className="absolute top-4 right-4 text-xs">Coming Soon</Badge>
                <div className="h-14 w-14 rounded-xl bg-primary/10 flex items-center justify-center mb-5">
                  <Mic className="h-6 w-6 text-primary" />
                </div>
                <h3 className="text-lg font-bold mb-2">Get Interview Training With AI</h3>
                <p className="text-sm text-muted-foreground mb-6 leading-relaxed">Practice real interview questions powered by AI simulation.</p>
                <Button disabled className="pointer-events-none opacity-60">
                  Get Interview With AI
                </Button>
              </CardContent>
            </Card>
          </motion.div>
        </div>
      </main>
    </div>
  );
}
