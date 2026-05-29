import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { extractTextFromPdf, hashContent } from "@/lib/pdf-parser";
import { useToast } from "@/hooks/use-toast";
import {
  Upload, FileText, LogOut, Zap, Clock, TrendingUp, Trash2, ChevronDown,
  FileEdit, Mic, Crown, Package, Sparkles, ArrowRight, MessageSquare, Eye, LayoutGrid, ArrowUpRight,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { ScanningAnimation } from "@/components/ScanningAnimation";
import { Badge } from "@/components/ui/badge";
import { ReferralWidget } from "@/components/ReferralWidget";
import {
  AnimatedGradientMesh, SparkleParticles, GradientText, ShimmerButton,
  CountingNumber, PulseDot,
} from "@/components/premium";
import { type PlanType, planLabel, hasActivePlan, isEarlyBirdActive } from "@/integrations/supabase/extended-types";

const MAX_FILE_SIZE = 10 * 1024 * 1024;

/* ── Helpers ────────────────────────────────────────── */

function scoreColor(score: number) {
  if (score >= 80) return { text: "text-emerald-400", bg: "bg-emerald-500/15", border: "border-emerald-500/30", glow: "shadow-emerald-500/20" };
  if (score >= 60) return { text: "text-amber-400", bg: "bg-amber-500/15", border: "border-amber-500/30", glow: "shadow-amber-500/20" };
  return { text: "text-rose-400", bg: "bg-rose-500/15", border: "border-rose-500/30", glow: "shadow-rose-500/20" };
}
function competitivenessColor(level: string) {
  return { Elite: "text-violet-400", Strong: "text-emerald-400", Competitive: "text-amber-400" }[level] || "text-rose-400";
}
function validateFile(file: File): string | null {
  if (!file) return "No file selected";
  if (file.type !== "application/pdf") {
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext === "docx" || ext === "doc") return "DOCX not supported yet. Convert to PDF.";
    return "Please upload a PDF file.";
  }
  if (file.size > MAX_FILE_SIZE) return `Too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Max 10MB.`;
  if (file.size === 0) return "Empty file.";
  return null;
}

/* ── Stagger config ────────────────────────────────── */
const stagger = {
  container: { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.07, delayChildren: 0.1 } } },
  item: { hidden: { opacity: 0, y: 20 }, show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: "easeOut" } } },
};

/* ── Gradient Divider ──────────────────────────────── */
function GradientDivider() {
  return <div className="h-px my-8 bg-gradient-to-r from-transparent via-violet-500/20 to-transparent" />;
}

/* ══════════════════════════════════════════════════════
   DASHBOARD
   ══════════════════════════════════════════════════════ */
export default function Dashboard() {
  const { user, signOut, session } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { toast } = useToast();
  const [analyses, setAnalyses] = useState<any[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [planType, setPlanType] = useState<PlanType | null>(null);
  const [earlyBirdActive, setEarlyBirdActive] = useState(false);
  const autoAnalyzeTriggered = useRef(false);

  /* ── Data fetching ─────────────────────────────── */
  const fetchDashboardData = useCallback(async () => {
    if (!user) return;
    const [analysesRes, profileRes] = await Promise.all([
      supabase.from("resume_analyses").select("*").eq("user_id", user.id).order("created_at", { ascending: false }),
      supabase.from("profiles").select("early_bird_active, early_bird_expiry_date").eq("user_id", user.id).single(),
    ]);
    if (analysesRes.data) setAnalyses(analysesRes.data);
    if (profileRes.data) {
      const p = profileRes.data as any;
      setPlanType(p.plan_type ?? "FREE");
      setEarlyBirdActive(isEarlyBirdActive(p));
    }
  }, [user]);

  useEffect(() => { fetchDashboardData(); }, [fetchDashboardData]);
  useEffect(() => { document.title = "Dashboard – HireResume"; }, []);

  /* ── Auto-analyze from guest upload flow ───────── */
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
      const { data: cached } = await supabase.from("resume_analyses").select("id").eq("user_id", user!.id).eq("content_hash", contentHash).maybeSingle();
      if (cached) { await new Promise(r => setTimeout(r, 1800)); navigate(`/analysis/${cached.id}`); return; }
      const accessToken = session?.access_token;
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyze-resume`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
        body: JSON.stringify({ resumeText, fileName, contentHash }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Analysis failed");
      if (data?.id) navigate(`/analysis/${data.id}`);
    } catch (err: any) {
      toast({ title: "Analysis failed", description: err.message, variant: "destructive" });
    } finally { setUploading(false); }
  };

  const handleFile = async (file: File) => {
    const err = validateFile(file);
    if (err) { toast({ title: "Invalid file", description: err, variant: "destructive" }); return; }
    setUploading(true);
    try {
      const text = await extractTextFromPdf(file);
      if (!text.trim()) throw new Error("Could not extract text. Try a different PDF.");
      const contentHash = await hashContent(text);
      const { data: cached } = await supabase.from("resume_analyses").select("id").eq("user_id", user!.id).eq("content_hash", contentHash).maybeSingle();
      if (cached) { await new Promise(r => setTimeout(r, 1800)); navigate(`/analysis/${cached.id}`); return; }
      const previousAnalysisId = analyses.length > 0 ? analyses[0].id : undefined;
      const accessToken = session?.access_token;
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyze-resume`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
        body: JSON.stringify({ resumeText: text, fileName: file.name, contentHash, previousAnalysisId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Analysis failed");
      if (data?.id) navigate(`/analysis/${data.id}`);
    } catch (err: any) {
      toast({ title: "Analysis failed", description: err.message, variant: "destructive" });
    } finally { setUploading(false); }
  };

  const handleDrop = (e: React.DragEvent) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); };
  const handleDelete = async (id: string) => { await supabase.from("resume_analyses").delete().eq("id", id); setAnalyses(prev => prev.filter(a => a.id !== id)); };
  const displayedAnalyses = showAll ? analyses : analyses.slice(0, 3);
  const bestScore = analyses.length > 0 ? Math.max(...analyses.map(a => a.ats_score ?? 0)) : 0;

  /* ── Uploading (scanning) state ────────────────── */
  if (uploading) {
    return (
      <div className="min-h-screen bg-background">
        <AnimatedGradientMesh />
        <header className="border-b border-violet-500/10 glass-strong sticky top-0 z-50">
          <div className="container flex items-center justify-between h-14">
            <div className="flex items-center gap-2">
              <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-violet-600 to-cyan-600 flex items-center justify-center shadow-lg shadow-violet-500/20">
                <Zap className="h-4 w-4 text-white" />
              </div>
              <span className="font-bold text-foreground tracking-tight">HireResume</span>
            </div>
          </div>
        </header>
        <ScanningAnimation />
      </div>
    );
  }

  /* ═══════════════════════════════════════════════════
     RENDER
     ═══════════════════════════════════════════════════ */
  return (
    <div className="min-h-screen bg-background relative">
      {/* ── ANIMATED MESH BACKGROUND ────────────── */}
      <AnimatedGradientMesh />

      {/* ── NAV BAR ─────────────────────────────── */}
      <header className="border-b border-violet-500/10 glass-strong sticky top-0 z-50">
        <div className="container flex items-center justify-between h-14 px-4">
          <div className="flex items-center gap-2">
            <motion.div
              whileHover={{ scale: 1.1, rotate: 5 }}
              className="h-7 w-7 rounded-lg bg-gradient-to-br from-violet-600 to-cyan-600 flex items-center justify-center shadow-lg shadow-violet-500/25"
            >
              <Zap className="h-4 w-4 text-white" />
            </motion.div>
            <span className="font-bold text-foreground tracking-tight">HireResume</span>
            {planType === "UNLIMITED" && (
              <Badge className="bg-violet-500/15 text-violet-300 border-violet-500/25 text-[10px] ml-2 hidden sm:inline-flex gap-1">
                <Crown className="h-2.5 w-2.5" /> Unlimited
              </Badge>
            )}
            {planType === "COMBO" && (
              <Badge className="bg-cyan-500/15 text-cyan-300 border-cyan-500/25 text-[10px] ml-2 hidden sm:inline-flex gap-1">
                <Package className="h-2.5 w-2.5" /> Combo
              </Badge>
            )}
            {earlyBirdActive && planType !== "UNLIMITED" && planType !== "COMBO" && (
              <Badge className="bg-violet-500/15 text-violet-300 border-violet-500/25 text-[10px] ml-2 hidden sm:inline-flex">Early Bird</Badge>
            )}
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground/60 hidden sm:block font-mono">{user?.email}</span>
            <Button variant="ghost" size="sm" className="text-muted-foreground/60 hover:text-foreground" onClick={async () => {
              if (session?.access_token) { const s = session.access_token.slice(-16); await supabase.from("user_sessions").delete().eq("session_token", s); }
              await signOut(); navigate("/auth");
            }}>
              <LogOut className="h-4 w-4 mr-1" /> <span className="hidden sm:inline">Sign Out</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="container py-8 sm:py-10 max-w-5xl px-4 relative z-10">
        <motion.div variants={stagger.container} initial="hidden" animate="show">

          {/* ═══════════════════════════════════════════
              1. HEADER with GradientText
              ═══════════════════════════════════════════ */}
          <motion.div variants={stagger.item} className="flex items-end justify-between mb-2">
            <div>
              <GradientText as="h1" className="text-3xl sm:text-4xl font-extrabold tracking-tight" animate>
                Dashboard
              </GradientText>
              <motion.p
                className="text-muted-foreground/50 text-sm mt-1"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.5 }}
              >
                Your AI-powered resume command center
              </motion.p>
            </div>
            <ShimmerButton size="sm" onClick={() => document.getElementById("file-input")?.click()}>
              <Upload className="h-4 w-4" />
              <span className="hidden sm:inline">Analyze Resume</span>
              <span className="sm:hidden">Upload</span>
            </ShimmerButton>
          </motion.div>

          {/* gradient line under header */}
          <motion.div variants={stagger.item} className="h-px mb-8 bg-gradient-to-r from-violet-500/30 via-cyan-500/20 to-transparent" />

          {/* ═══════════════════════════════════════════
              2. STUDIO HERO CARD — breathtaking
              ═══════════════════════════════════════════ */}
          <motion.div variants={stagger.item}>
            <motion.div
              animate={{ y: [0, -3, 0] }}
              transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
            >
              <div
                onClick={() => navigate("/studio")}
                className="relative overflow-hidden cursor-pointer rounded-2xl mb-8 group"
              >
                {/* Animated gradient background */}
                <div className="absolute inset-0 bg-gradient-to-br from-violet-600/30 via-pink-500/15 to-cyan-500/25 animate-pulse-glow rounded-2xl" />
                <div className="absolute inset-0 rounded-2xl" style={{ background: "linear-gradient(135deg, rgba(139,92,246,0.15) 0%, rgba(236,72,153,0.1) 40%, rgba(6,182,212,0.15) 100%)" }} />

                {/* Glow border */}
                <div className="absolute inset-0 rounded-2xl border border-violet-500/30 group-hover:border-violet-500/50 transition-colors duration-500" />
                <motion.div
                  className="absolute inset-0 rounded-2xl border border-violet-400/20"
                  animate={{ opacity: [0.2, 0.5, 0.2] }}
                  transition={{ duration: 3, repeat: Infinity }}
                />

                {/* Blob accents */}
                <motion.div
                  className="absolute -top-20 -right-20 w-60 h-60 bg-violet-500/20 rounded-full blur-3xl"
                  animate={{ scale: [1, 1.2, 1], opacity: [0.2, 0.35, 0.2] }}
                  transition={{ duration: 4, repeat: Infinity }}
                />
                <motion.div
                  className="absolute -bottom-16 -left-16 w-48 h-48 bg-cyan-500/15 rounded-full blur-3xl"
                  animate={{ scale: [1.1, 0.9, 1.1], opacity: [0.15, 0.3, 0.15] }}
                  transition={{ duration: 5, repeat: Infinity }}
                />
                <motion.div
                  className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-40 h-40 bg-pink-500/10 rounded-full blur-3xl"
                  animate={{ scale: [0.8, 1.3, 0.8] }}
                  transition={{ duration: 6, repeat: Infinity }}
                />

                {/* Sparkles */}
                <SparkleParticles count={10} colors={["#8B5CF6", "#06B6D4", "#EC4899", "#ffffff"]} />

                {/* Content */}
                <div className="relative z-10 flex flex-col sm:flex-row items-center gap-6 p-7 sm:p-8 backdrop-blur-sm">
                  {/* Icon */}
                  <motion.div
                    animate={{ rotate: [0, 8, -8, 0], scale: [1, 1.05, 1] }}
                    transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
                    className="h-18 w-18 rounded-2xl bg-gradient-to-br from-violet-600 to-cyan-500 flex items-center justify-center flex-shrink-0 shadow-xl shadow-violet-500/40"
                    style={{ width: 72, height: 72 }}
                  >
                    <Sparkles className="h-8 w-8 text-white" />
                  </motion.div>

                  {/* Text */}
                  <div className="flex-1 text-center sm:text-left">
                    <div className="flex items-center justify-center sm:justify-start gap-2.5 mb-2">
                      <GradientText as="h3" className="text-2xl font-extrabold tracking-tight">
                        Resume Studio
                      </GradientText>
                      <span className="relative flex items-center gap-1.5">
                        <PulseDot color="#8B5CF6" size={7} />
                        <motion.span
                          animate={{ opacity: [1, 0.5, 1] }}
                          transition={{ duration: 1.5, repeat: Infinity }}
                          className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-widest bg-gradient-to-r from-violet-500 to-cyan-500 text-white shadow-lg shadow-violet-500/30"
                        >
                          NEW
                        </motion.span>
                      </span>
                    </div>
                    <p className="text-sm text-white/70 leading-relaxed mb-3">
                      Chat with AI and watch your resume transform in real-time. The smartest way to perfect your resume.
                    </p>
                    {/* Feature chips */}
                    <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2">
                      {[
                        { icon: MessageSquare, label: "Chat editing" },
                        { icon: Eye, label: "Live preview" },
                        { icon: LayoutGrid, label: "5 templates" },
                      ].map(({ icon: Icon, label }) => (
                        <span key={label} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-white/8 text-white/80 border border-white/10 backdrop-blur-sm">
                          <Icon className="h-3 w-3" />
                          {label}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* CTA button */}
                  <ShimmerButton onClick={() => navigate("/studio")} className="flex-shrink-0">
                    <Sparkles className="h-4 w-4" />
                    Open Studio
                    <ArrowRight className="h-4 w-4" />
                  </ShimmerButton>
                </div>
              </div>
            </motion.div>
          </motion.div>

          {/* ═══════════════════════════════════════════
              3. UPLOAD ZONE — premium glassmorphism
              ═══════════════════════════════════════════ */}
          <motion.div variants={stagger.item}>
            <div
              onClick={() => document.getElementById("file-input")?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              className={`relative overflow-hidden cursor-pointer rounded-2xl mb-8 transition-all duration-300 backdrop-blur-xl group ${
                dragOver
                  ? "scale-[1.01] border-violet-400 shadow-[0_0_40px_rgba(139,92,246,0.3)]"
                  : "border-violet-500/15 hover:border-violet-500/30 hover:shadow-[0_4px_30px_rgba(139,92,246,0.1)]"
              }`}
              style={{ background: "rgba(20, 20, 35, 0.5)", border: dragOver ? "2px solid rgba(139,92,246,0.6)" : "2px dashed rgba(139,92,246,0.2)" }}
            >
              {/* Rotating gradient border illusion */}
              <motion.div
                className="absolute inset-0 rounded-2xl pointer-events-none"
                style={{ background: "conic-gradient(from 0deg, transparent, rgba(139,92,246,0.15), transparent, rgba(6,182,212,0.1), transparent)" }}
                animate={{ rotate: [0, 360] }}
                transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
              />

              {/* Sparkles on drag */}
              <AnimatePresence>
                {dragOver && <SparkleParticles count={20} colors={["#8B5CF6", "#06B6D4", "#EC4899"]} />}
              </AnimatePresence>

              <div className="relative z-10 flex flex-col items-center justify-center py-12 sm:py-16">
                {/* Bouncing icon */}
                <motion.div
                  animate={{ y: [0, -10, 0] }}
                  transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                  className={`h-16 w-16 rounded-2xl flex items-center justify-center mb-5 transition-all duration-300 ${
                    dragOver
                      ? "bg-violet-500/25 border-violet-400/50 shadow-[0_0_30px_rgba(139,92,246,0.4)]"
                      : "bg-violet-500/10 border-violet-500/20 group-hover:bg-violet-500/15"
                  } border`}
                >
                  <Upload className={`h-7 w-7 transition-colors duration-300 ${dragOver ? "text-violet-300" : "text-violet-400/70 group-hover:text-violet-400"}`} />
                </motion.div>

                {/* Text */}
                <p className={`font-semibold text-base mb-1 transition-colors duration-300 ${dragOver ? "text-violet-300" : "text-foreground/80"}`}>
                  {dragOver ? "Release to analyze" : "Drop your resume PDF here"}
                </p>
                <p className="text-sm text-muted-foreground/40">or click to browse · PDF · Max 10MB</p>
              </div>

              <input id="file-input" type="file" accept=".pdf" className="hidden" onChange={(e) => { if (e.target.files?.[0]) handleFile(e.target.files[0]); e.target.value = ""; }} />
            </div>
          </motion.div>

          {/* ═══════════════════════════════════════════
              4. USAGE STATS — 3 glass cards
              ═══════════════════════════════════════════ */}
          <motion.div variants={stagger.item} className="grid grid-cols-3 gap-3 sm:gap-4 mb-8">
            {/* Resumes Analyzed */}
            <motion.div
              whileHover={{ y: -4, boxShadow: "0 8px 30px rgba(139,92,246,0.15)" }}
              className="rounded-xl backdrop-blur-xl p-4 sm:p-5 text-center transition-all duration-300 border border-violet-500/10"
              style={{ background: "rgba(20, 20, 35, 0.5)" }}
            >
              <div className="text-2xl sm:text-3xl font-extrabold gradient-text-new font-mono">
                <CountingNumber target={analyses.length} duration={800} />
              </div>
              <p className="text-[11px] sm:text-xs text-muted-foreground/50 mt-1 font-medium">Resumes Analyzed</p>
            </motion.div>

            {/* Best Score */}
            <motion.div
              whileHover={{ y: -4, boxShadow: "0 8px 30px rgba(6,182,212,0.15)" }}
              className="rounded-xl backdrop-blur-xl p-4 sm:p-5 text-center transition-all duration-300 border border-cyan-500/10"
              style={{ background: "rgba(20, 20, 35, 0.5)" }}
            >
              <div className={`text-2xl sm:text-3xl font-extrabold font-mono ${bestScore >= 80 ? "text-emerald-400" : bestScore >= 60 ? "text-amber-400" : analyses.length > 0 ? "text-rose-400" : "text-muted-foreground/30"}`}>
                {analyses.length > 0 ? <CountingNumber target={bestScore} duration={1000} /> : "—"}
              </div>
              <p className="text-[11px] sm:text-xs text-muted-foreground/50 mt-1 font-medium">Best ATS Score</p>
            </motion.div>

            {/* Plan */}
            <motion.div
              whileHover={{ y: -4, boxShadow: "0 8px 30px rgba(236,72,153,0.12)" }}
              className="rounded-xl backdrop-blur-xl p-4 sm:p-5 text-center transition-all duration-300 border border-pink-500/10"
              style={{ background: "rgba(20, 20, 35, 0.5)" }}
            >
              <div className="flex items-center justify-center gap-1.5">
                <Sparkles className="h-4 w-4 text-violet-400" />
                <span className="text-sm sm:text-base font-bold text-foreground">
                  {planType === "UNLIMITED" ? "Unlimited" : planType === "COMBO" ? "Combo" : "Free"}
                </span>
              </div>
              <p className="text-[11px] sm:text-xs text-muted-foreground/50 mt-1 font-medium">Current Plan</p>
            </motion.div>
          </motion.div>

          <GradientDivider />

          {/* ═══════════════════════════════════════════
              5. ANALYSIS HISTORY — premium glass cards
              ═══════════════════════════════════════════ */}
          {analyses.length > 0 ? (
            <motion.div variants={stagger.item}>
              <div className="flex items-center gap-3 mb-5">
                <Clock className="h-4 w-4 text-violet-400/60" />
                <h2 className="text-lg font-bold tracking-tight text-foreground/90">Analysis History</h2>
                <div className="flex-1 h-px bg-gradient-to-r from-violet-500/15 to-transparent" />
              </div>

              <div className="space-y-3">
                {displayedAnalyses.map((a, i) => {
                  const sc = a.ats_score != null ? scoreColor(a.ats_score) : null;
                  return (
                    <motion.div
                      key={a.id}
                      initial={{ opacity: 0, y: 16 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.06, duration: 0.4 }}
                      whileHover={{ y: -2, boxShadow: "0 8px 30px rgba(139,92,246,0.12)" }}
                      onClick={() => navigate(`/analysis/${a.id}`)}
                      className="group rounded-xl backdrop-blur-xl cursor-pointer transition-all duration-300 border border-violet-500/10 hover:border-violet-500/25 overflow-hidden"
                      style={{ background: "rgba(20, 20, 35, 0.5)" }}
                    >
                      <div className="flex items-center justify-between py-4 px-4 sm:px-5">
                        <div className="flex items-center gap-3 sm:gap-4 flex-1 min-w-0">
                          {/* Animated icon */}
                          <motion.div
                            whileHover={{ rotate: 5, scale: 1.05 }}
                            className="h-11 w-11 rounded-xl bg-gradient-to-br from-violet-500/15 to-cyan-500/10 border border-violet-500/20 flex items-center justify-center shrink-0"
                          >
                            <FileText className="h-5 w-5 text-violet-400" />
                          </motion.div>
                          <div className="min-w-0">
                            <p className="font-semibold truncate text-sm sm:text-base text-foreground/90 group-hover:text-foreground transition-colors">{a.file_name}</p>
                            <p className="text-[11px] text-muted-foreground/40 font-mono">{new Date(a.created_at).toLocaleDateString()}</p>
                          </div>
                        </div>

                        <div className="flex items-center gap-3">
                          {/* Score badge with glow */}
                          {sc && (
                            <div className={`hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg border ${sc.bg} ${sc.border} shadow-md ${sc.glow}`}>
                              <span className={`text-base font-extrabold font-mono ${sc.text}`}>{a.ats_score}</span>
                              <span className={`text-[10px] font-medium ${competitivenessColor(a.market_competitiveness || "")}`}>
                                {a.market_competitiveness}
                              </span>
                            </div>
                          )}
                          {sc && (
                            <span className={`sm:hidden text-base font-extrabold font-mono ${sc.text}`}>{a.ats_score}</span>
                          )}

                          {/* View arrow — appears on hover */}
                          <motion.div
                            initial={{ opacity: 0, x: -5 }}
                            whileHover={{ opacity: 1, x: 0 }}
                            className="hidden group-hover:flex items-center text-violet-400"
                          >
                            <ArrowUpRight className="h-4 w-4" />
                          </motion.div>

                          <Button
                            variant="ghost" size="icon"
                            className="text-muted-foreground/30 hover:text-rose-400 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={(e) => { e.stopPropagation(); handleDelete(a.id); }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </div>

              {analyses.length > 3 && (
                <div className="text-center mt-5">
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => setShowAll(!showAll)}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium text-muted-foreground/60 hover:text-violet-400 border border-violet-500/10 hover:border-violet-500/25 transition-all"
                  >
                    <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-300 ${showAll ? "rotate-180" : ""}`} />
                    {showAll ? "Show Less" : `View All ${analyses.length}`}
                  </motion.button>
                </div>
              )}
            </motion.div>
          ) : (
            /* ── Premium empty state ─────────────────── */
            <motion.div variants={stagger.item} className="text-center py-16 relative">
              <SparkleParticles count={6} colors={["#8B5CF6", "#06B6D4"]} className="opacity-30" />
              <motion.div
                animate={{ y: [0, -10, 0], rotate: [0, 3, -3, 0] }}
                transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
                className="h-20 w-20 rounded-2xl bg-gradient-to-br from-violet-500/15 to-cyan-500/10 border border-violet-500/20 flex items-center justify-center mx-auto mb-5 shadow-lg shadow-violet-500/10"
              >
                <FileText className="h-9 w-9 text-violet-400/50" />
              </motion.div>
              <h3 className="font-bold text-lg mb-1.5 text-foreground/80">No analyses yet</h3>
              <p className="text-sm text-muted-foreground/40 mb-6">Upload your resume to get your first AI-powered score</p>
              <ShimmerButton onClick={() => document.getElementById("file-input")?.click()}>
                <Upload className="h-4 w-4" /> Upload Your First Resume
              </ShimmerButton>
            </motion.div>
          )}

          {/* ── Referral ──────────────────────────── */}
          <motion.div variants={stagger.item} className="mt-8">
            <ReferralWidget />
          </motion.div>

          <GradientDivider />

          {/* ═══════════════════════════════════════════
              6. FEATURE CARDS — glassmorphism grid
              ═══════════════════════════════════════════ */}
          <motion.div variants={stagger.item} className="grid md:grid-cols-2 gap-5">
            {[
              {
                title: "Build Resume From Scratch",
                desc: "AI-guided step-by-step resume creation with 10 templates.",
                icon: FileEdit,
                color: "violet",
                href: "/build-resume",
                cta: "Create Resume",
              },
              {
                title: "AI Interview Training",
                desc: "Practice real interview questions with voice AI simulation.",
                icon: Mic,
                color: "cyan",
                href: "/voice-interview",
                cta: "Start Interview",
              },
            ].map(({ title, desc, icon: Icon, color, href, cta }, idx) => (
              <motion.div
                key={title}
                whileHover={{ y: -4, boxShadow: `0 12px 40px rgba(${color === "violet" ? "139,92,246" : "6,182,212"}, 0.15)` }}
                onClick={() => navigate(href)}
                className="relative overflow-hidden rounded-2xl cursor-pointer transition-all duration-300 backdrop-blur-xl border border-violet-500/10 hover:border-violet-500/25 group"
                style={{ background: "rgba(20, 20, 35, 0.5)" }}
              >
                {/* Corner glow */}
                <div className={`absolute top-0 right-0 w-40 h-40 bg-${color}-500/8 rounded-full blur-3xl group-hover:bg-${color}-500/15 transition-all duration-500`} />

                <div className="relative flex flex-col items-center text-center p-8 sm:p-10">
                  <motion.div
                    whileHover={{ rotate: 8, scale: 1.1 }}
                    className={`h-14 w-14 rounded-xl bg-${color}-500/10 border border-${color}-500/20 flex items-center justify-center mb-5`}
                  >
                    <Icon className={`h-6 w-6 text-${color}-400`} />
                  </motion.div>
                  <h3 className="text-lg font-bold mb-2 tracking-tight text-foreground/90">{title}</h3>
                  <p className="text-sm text-muted-foreground/50 mb-6 leading-relaxed max-w-xs">{desc}</p>
                  <ShimmerButton size="sm" variant={idx === 0 ? "primary" : "accent"}>
                    {cta} <ArrowRight className="h-3.5 w-3.5" />
                  </ShimmerButton>
                </div>
              </motion.div>
            ))}
          </motion.div>

        </motion.div>
      </main>
    </div>
  );
}
