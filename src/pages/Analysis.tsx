import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import PaymentDialog from "@/components/PaymentDialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { ScoreMeter } from "@/components/ScoreMeter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { motion } from "framer-motion";
import {
  ArrowLeft, ArrowRight, Zap, AlertTriangle, Lightbulb, CheckCircle2,
  XCircle, Wrench, TrendingUp, Brain, Target, ChevronDown, ChevronUp, Home, Upload,
  GraduationCap, Lock, Eye, Share2, Copy, Check, Sparkles,
} from "lucide-react";
import type { AnalysisResult, AnalysisIssue } from "@/lib/analysis-types";
import { ResumeRoast } from "@/components/analysis/ResumeRoast";
import { ScoreCardDownload } from "@/components/analysis/ScoreCard";
import { LeaderboardOptIn } from "@/components/analysis/LeaderboardOptIn";
import { AnimatedGradientMesh } from "@/components/premium";
import { PostAnalysisStudioToast } from "@/components/PostAnalysisStudioToast";

function AnimatedScore({ value }: { value: number }) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    let start = 0;
    const duration = 1200;
    const step = (ts: number) => {
      if (!start) start = ts;
      const progress = Math.min((ts - start) / duration, 1);
      setDisplay(Math.round(progress * value));
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [value]);
  return <>{display}</>;
}

function IssueCard({ issue, color, icon: Icon }: { issue: AnalysisIssue; color: string; icon: any }) {
  const [open, setOpen] = useState(false);
  const impactColor = {
    HIGH: "bg-destructive/20 text-destructive border-destructive/40",
    MEDIUM: "bg-warning/20 text-warning border-warning/40",
    LOW: "bg-info/20 text-info border-info/40",
  }[issue.impactLevel] || "";

  return (
    <motion.div
      className={`rounded-xl border p-4 sm:p-5 transition-all duration-300 backdrop-blur-lg card-hover-glow ${color}`}
      initial={{ opacity: 0, y: 10 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
    >
      <button className="w-full text-left" onClick={() => setOpen(!open)}>
        <div className="flex items-start gap-3">
          <Icon className="h-5 w-5 mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="font-semibold text-sm text-foreground">{issue.issue}</span>
              <Badge className={`text-[10px] px-2 py-0 ${impactColor}`}>{issue.impactLevel} IMPACT</Badge>
            </div>
            {!open && (
              <p className="text-xs text-muted-foreground line-clamp-1">{issue.whyItMatters}</p>
            )}
          </div>
          <div className="shrink-0 mt-0.5 text-muted-foreground">
            {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </div>
        </div>
      </button>
      {open && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          className="mt-3 ml-8 space-y-3"
        >
          <div>
            <p className="text-xs font-medium text-muted-foreground/80 uppercase tracking-wider mb-1">Why It Hurts You</p>
            <p className="text-sm text-muted-foreground">{issue.whyItMatters}</p>
          </div>
          <div className="flex items-start gap-2 bg-primary/5 rounded-lg p-3 border border-primary/20">
            <Wrench className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
            <div>
              <p className="text-xs font-medium text-primary uppercase tracking-wider mb-1">Exact Fix</p>
              <p className="text-sm text-foreground">{issue.fixRecommendation}</p>
            </div>
          </div>
        </motion.div>
      )}
    </motion.div>
  );
}

function ShareSection({ score, analysisId }: { score: number; analysisId: string }) {
  const [copied, setCopied] = useState(false);
  const url = `https://hiresume.in?utm_source=share&utm_medium=social&utm_campaign=score_share`;
  const challengeVerb = score >= 80 ? "Can you beat my score?" : score >= 60 ? "Think you can do better?" : "Let's see how yours compares 😅";
  const text = `I just checked my resume on HireResume and scored ${score}/100 on ATS! ${challengeVerb}\nCheck yours free (takes 30 seconds): ${url}`;

  const shareWhatsApp = () => {
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
  };
  const shareLinkedIn = () => {
    window.open(`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}&summary=${encodeURIComponent(text)}`, "_blank");
  };
  const shareTwitter = () => {
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`, "_blank");
  };
  const copyText = () => {
    navigator.clipboard.writeText(text + "\n" + url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <motion.div className="text-center pt-6 pb-2" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
      <div className="flex items-center justify-center gap-2 mb-3">
        <Share2 className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm text-muted-foreground font-medium">Share your score and challenge your friends</span>
      </div>
      <div className="flex items-center justify-center flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={shareWhatsApp} className="gap-2 border-green-500/40 text-green-400 hover:bg-green-500/10">
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
          WhatsApp
        </Button>
        <Button variant="outline" size="sm" onClick={shareLinkedIn} className="gap-2 border-blue-500/40 text-blue-400 hover:bg-blue-500/10">
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
          LinkedIn
        </Button>
        <Button variant="outline" size="sm" onClick={shareTwitter} className="gap-2 border-sky-500/40 text-sky-400 hover:bg-sky-500/10">
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.73-8.835L1.254 2.25H8.08l4.259 5.63 5.905-5.63zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
          X / Twitter
        </Button>
        <Button variant="outline" size="sm" onClick={copyText} className="gap-2">
          {copied ? <Check className="h-4 w-4 text-green-400" /> : <Copy className="h-4 w-4" />}
          {copied ? "Copied!" : "Copy Text"}
        </Button>
        <ScoreCardDownload score={score} />
        <LeaderboardOptIn analysisId={analysisId} score={score} />
      </div>
    </motion.div>
  );
}

function PerformanceHeader({ result }: { result: AnalysisResult }) {
  const tagColor = {
    "High Risk – Immediate Fix Required": "bg-destructive/20 text-destructive border-destructive/30",
    "Needs Strategic Improvement": "bg-warning/20 text-warning border-warning/30",
    "Competitive but Optimizable": "bg-info/20 text-info border-info/30",
    "Strong & Market Ready": "bg-success/20 text-success border-success/30",
  }[result.performanceLevelTag] || "bg-muted/20 text-muted-foreground";

  const scoreColor = result.atsScore >= 80
    ? "text-success" : result.atsScore >= 60
    ? "text-warning" : "text-destructive";

  return (
    <motion.div
      className="rounded-2xl border border-violet-500/15 glass p-6 sm:p-8 mb-8 sm:mb-10 card-hover-glow"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <p className="text-sm text-muted-foreground mb-6">
        The analysis is complete. Here's your professional resume performance report.
      </p>
      <div className="flex flex-col md:flex-row items-center gap-6 sm:gap-8">
        <div className="flex flex-col items-center">
          <ScoreMeter score={result.atsScore} label="" size={140} />
          <p className="text-xs text-muted-foreground mt-1">ATS SCORE</p>
        </div>
        <div className="flex-1 space-y-4 text-center md:text-left">
          <div className="flex items-center gap-3 flex-wrap justify-center md:justify-start">
            <span className={`text-4xl sm:text-5xl font-black tabular-nums ${scoreColor}`}>
              <AnimatedScore value={result.atsScore} />
            </span>
            <span className="text-2xl text-muted-foreground font-light">/ 100</span>
          </div>
          <Badge className={`text-sm px-4 py-1.5 ${tagColor}`}>
            {result.performanceLevelTag || (result.atsScore >= 80 ? "Strong & Market Ready" : result.atsScore >= 65 ? "Competitive but Optimizable" : result.atsScore >= 50 ? "Needs Strategic Improvement" : "High Risk – Immediate Fix Required")}
          </Badge>
          {result.contextStatement && (
            <p className="text-sm text-muted-foreground italic leading-relaxed">
              {result.contextStatement}
            </p>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function SectionHeader({ icon: Icon, title, count, color }: { icon: any; title: string; count: number; color: string }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <div className={`p-2 rounded-lg ${color}`}>
        <Icon className="h-5 w-5" />
      </div>
      <h3 className="text-base sm:text-lg font-bold text-foreground">{title}</h3>
      <Badge variant="secondary" className="text-xs">{count}</Badge>
    </div>
  );
}

export default function Analysis() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [analysis, setAnalysis] = useState<any>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [checkingAccess, setCheckingAccess] = useState(false);
  const [showStickyBar, setShowStickyBar] = useState(false);

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
          if (data.analysis_result) setResult(data.analysis_result as unknown as AnalysisResult);
          document.title = `${data.file_name} – Analysis – HireResume`;
        }
        setLoading(false);
      });
  }, [id, user]);

  useEffect(() => {
    let ticking = false;
    const handleScroll = () => {
      if (!ticking) {
        requestAnimationFrame(() => {
          setShowStickyBar(window.scrollY > 400);
          ticking = false;
        });
        ticking = true;
      }
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const handleFixResume = async () => {
    setCheckingAccess(true);
    try {
      const session = (await supabase.auth.getSession()).data.session;
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/check-fix-access?resumeAnalysisId=${id}`,
        { headers: { Authorization: `Bearer ${session?.access_token}`, apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY } }
      );
      const accessData = await res.json();
      if (accessData.canAccess) {
        navigate(`/fix/${id}`);
      } else {
        setPaymentOpen(true);
      }
    } catch {
      setPaymentOpen(true);
    } finally {
      setCheckingAccess(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!analysis || !result) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="text-center">
          <p className="text-muted-foreground mb-4">Analysis not found</p>
          <Button onClick={() => navigate("/dashboard")}>Back to Dashboard</Button>
        </div>
      </div>
    );
  }

  const isFixUnlocked = analysis.is_paid_fix_unlocked;

  const badgeColor = {
    "Elite": "bg-primary/20 text-primary border-primary/30",
    "Strong": "bg-success/20 text-success border-success/30",
    "Competitive": "bg-warning/20 text-warning border-warning/30",
    "Below Average": "bg-destructive/20 text-destructive border-destructive/30",
  }[result.marketCompetitivenessLevel] || "";

  const fadeUp = (delay: number) => ({
    initial: { opacity: 0, y: 24 },
    animate: { opacity: 1, y: 0 },
    transition: { delay, duration: 0.5 },
  });

  return (
    <div className="min-h-screen bg-background pb-20 relative">
      <AnimatedGradientMesh />

      <header className="border-b border-violet-500/10 glass-strong sticky top-0 z-50">
        <div className="container flex items-center justify-between h-14 px-4">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <Button variant="ghost" size="icon" onClick={() => navigate("/dashboard")} className="shrink-0 text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="min-w-0 hidden sm:block">
              <p className="font-medium text-sm truncate">{analysis.file_name}</p>
              <p className="text-xs text-muted-foreground/60">{new Date(analysis.created_at).toLocaleString()}</p>
            </div>
          </div>
          <div className="flex items-center gap-1 sm:gap-2">
            <Button variant="ghost" size="sm" onClick={() => navigate("/dashboard")} className="hidden sm:inline-flex text-muted-foreground hover:text-foreground">
              <Home className="h-4 w-4 mr-1" /> Home
            </Button>
            <Button variant="outline" size="sm" onClick={() => navigate("/dashboard")} className="hidden md:inline-flex border-border/50 hover:border-violet-500/30">
              <Upload className="h-4 w-4 mr-1" /> Analyze New
            </Button>
            <motion.button
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              disabled={checkingAccess}
              onClick={handleFixResume}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-semibold bg-gradient-to-r from-violet-600 to-cyan-600 text-white shadow-lg shadow-violet-500/20 disabled:opacity-50"
            >
              <Zap className="h-4 w-4" /> <span className="hidden sm:inline">Fix My Resume</span><span className="sm:hidden">Fix</span>
            </motion.button>
          </div>
        </div>
      </header>

      {/* Studio sticky banner — top of results */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden border-b border-violet-500/20"
      >
        <div className="absolute inset-0 bg-gradient-to-r from-violet-600/15 via-cyan-600/10 to-violet-600/15" />
        <motion.div
          className="absolute inset-0 bg-gradient-to-r from-transparent via-violet-500/10 to-transparent"
          animate={{ x: ["-100%", "100%"] }}
          transition={{ duration: 4, repeat: Infinity, ease: "linear", repeatDelay: 2 }}
        />
        <div className="container max-w-5xl px-4 py-2.5 flex items-center justify-between gap-3 relative">
          <div className="flex items-center gap-2 min-w-0">
            <motion.div animate={{ rotate: [0, 15, -15, 0] }} transition={{ duration: 3, repeat: Infinity }}>
              <Sparkles className="h-4 w-4 text-violet-400 shrink-0" />
            </motion.div>
            <p className="text-sm font-medium text-foreground/90 truncate">
              <span className="hidden sm:inline">NEW: Edit your resume conversationally</span>
              <span className="sm:hidden">NEW: AI Resume Editor</span>
            </p>
          </div>
          <motion.button
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => navigate("/studio")}
            className="shrink-0 inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold bg-gradient-to-r from-violet-600 to-cyan-600 text-white shadow-lg shadow-violet-500/20 hover:shadow-xl hover:shadow-violet-500/30 transition-shadow"
          >
            Open Studio <ArrowRight className="h-3 w-3" />
          </motion.button>
        </div>
      </motion.div>

      <main className="container py-6 sm:py-8 max-w-5xl px-4 relative z-10">
        <PerformanceHeader result={result} />

        {/* Score Grid */}
        <motion.section className="mb-8 sm:mb-10" {...fadeUp(0.1)}>
          <div className="flex items-center gap-3 mb-6">
            <h2 className="text-lg sm:text-xl font-bold">Detailed Scores</h2>
            <Badge className={badgeColor}>{result.marketCompetitivenessLevel}</Badge>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4 sm:gap-6">
            <ScoreMeter score={result.recruiterScanScore} label="Recruiter Scan" />
            <ScoreMeter score={result.keywordStrengthScore} label="Keyword Strength" />
            <ScoreMeter score={result.quantificationScore} label="Quantification" />
            <ScoreMeter score={result.structureScore} label="Structure" />
            <ScoreMeter score={result.interviewProbability} label="Interview Prob." />
          </div>
        </motion.section>

        {/* Critical Issues */}
        {result.criticalIssues?.length > 0 && (
          <motion.section className="mb-8" {...fadeUp(0.15)}>
            <SectionHeader icon={XCircle} title="Critical Issues" count={result.criticalIssues.length} color="bg-destructive/10 text-destructive" />
            <div className="space-y-3">
              {result.criticalIssues.map((issue, i) => (
                <IssueCard key={i} issue={issue} color="border-destructive/20 bg-destructive/5" icon={XCircle} />
              ))}
            </div>
          </motion.section>
        )}

        {/* Strategic Warnings */}
        {result.warnings?.length > 0 && (
          <motion.section className="mb-8" {...fadeUp(0.2)}>
            <SectionHeader icon={AlertTriangle} title="Strategic Warnings" count={result.warnings.length} color="bg-warning/10 text-warning" />
            <div className="space-y-3">
              {result.warnings.map((issue, i) => (
                <IssueCard key={i} issue={issue} color="border-warning/20 bg-warning/5" icon={AlertTriangle} />
              ))}
            </div>
          </motion.section>
        )}

        {/* Performance Optimizations */}
        {result.optimizationOpportunities?.length > 0 && (
          <motion.section className="mb-8" {...fadeUp(0.25)}>
            <SectionHeader icon={Lightbulb} title="Performance Optimizations" count={result.optimizationOpportunities.length} color="bg-info/10 text-info" />
            <div className="space-y-3">
              {result.optimizationOpportunities.map((issue, i) => (
                <IssueCard key={i} issue={issue} color="border-info/20 bg-info/5" icon={Lightbulb} />
              ))}
            </div>
          </motion.section>
        )}

        {/* Advanced Optimizations */}
        {result.advancedRefinements?.length > 0 && (
          <motion.section className="mb-8" {...fadeUp(0.3)}>
            <SectionHeader icon={CheckCircle2} title="Advanced Optimizations" count={result.advancedRefinements.length} color="bg-success/10 text-success" />
            <div className="space-y-3">
              {result.advancedRefinements.map((issue, i) => (
                <IssueCard key={i} issue={issue} color="border-success/20 bg-success/5" icon={CheckCircle2} />
              ))}
            </div>
          </motion.section>
        )}

        {/* Improved Version Preview */}
        <motion.section className="mb-8" {...fadeUp(0.35)}>
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 rounded-lg bg-primary/10 text-primary">
              <TrendingUp className="h-5 w-5" />
            </div>
            <h3 className="text-base sm:text-lg font-bold text-foreground">Improved Version Preview</h3>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {result.rewrittenSummary && (
              <Card className="glass md:col-span-2">
                <CardHeader><CardTitle className="text-sm text-muted-foreground uppercase tracking-wider">Rewritten Summary</CardTitle></CardHeader>
                <CardContent><p className="text-sm leading-relaxed">{result.rewrittenSummary}</p></CardContent>
              </Card>
            )}
            {result.rewrittenStrongBullets?.length > 0 && (
              <Card className="glass">
                <CardHeader><CardTitle className="text-sm text-muted-foreground uppercase tracking-wider">Top Improved Bullets</CardTitle></CardHeader>
                <CardContent>
                  <ul className="space-y-3">
                    {result.rewrittenStrongBullets.map((b, i) => (
                      <li key={i} className="text-sm flex items-start gap-2">
                        <span className="text-primary font-bold mt-0.5">→</span>
                        <span>{b}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}
            <Card className="glass">
              <CardHeader><CardTitle className="text-sm text-muted-foreground uppercase tracking-wider">Keyword Enrichment</CardTitle></CardHeader>
              <CardContent>
                {result.missingHighImpactKeywords?.length > 0 && (
                  <div className="mb-4">
                    <p className="text-xs font-medium text-destructive mb-2">Missing Keywords</p>
                    <div className="flex flex-wrap gap-1.5">
                      {result.missingHighImpactKeywords.map((kw, i) => (
                        <Badge key={i} variant="outline" className="text-xs border-destructive/30 text-destructive">{kw}</Badge>
                      ))}
                    </div>
                  </div>
                )}
                {result.keywordEnrichmentSuggestions?.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-success mb-2">Suggested Additions</p>
                    <div className="flex flex-wrap gap-1.5">
                      {result.keywordEnrichmentSuggestions.map((kw, i) => (
                        <Badge key={i} variant="secondary" className="text-xs">{kw}</Badge>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </motion.section>

        {/* Blurred Optimized Resume Preview (pre-payment) */}
        {!isFixUnlocked && result.rewrittenSummary && (
          <motion.section className="mb-8" {...fadeUp(0.37)}>
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-lg bg-primary/10 text-primary">
                <Eye className="h-5 w-5" />
              </div>
              <h3 className="text-base sm:text-lg font-bold text-foreground">Your Optimized Resume</h3>
            </div>
            <Card className="glass relative overflow-hidden">
              <CardContent className="py-6">
                <p className="text-sm leading-relaxed mb-2">
                  {result.rewrittenSummary.split(". ").slice(0, 2).join(". ")}.
                </p>
                <div className="filter blur-[6px] select-none pointer-events-none">
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {result.rewrittenSummary.split(". ").slice(2).join(". ")}
                  </p>
                  {result.rewrittenStrongBullets?.slice(0, 3).map((b, i) => (
                    <p key={i} className="text-sm leading-relaxed mt-2">• {b}</p>
                  ))}
                </div>
                <div className="absolute inset-0 flex items-end justify-center bg-gradient-to-t from-background/90 via-background/40 to-transparent">
                  <div className="text-center pb-6">
                    <div className="flex items-center justify-center gap-2 mb-3">
                      <Lock className="h-4 w-4 text-primary" />
                      <span className="text-sm font-medium">Upgrade to unlock full optimized resume</span>
                    </div>
                    <Button onClick={handleFixResume} disabled={checkingAccess} className="transition-transform hover:scale-[1.02]">
                      <Zap className="h-4 w-4 mr-1" /> Unlock Resume Fix – ₹299
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.section>
        )}

        {/* Recruiter Psychology */}
        {result.recruiterPsychologyInsight && (
          <motion.section className="mb-8" {...fadeUp(0.4)}>
            <Card className="glass gradient-border">
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <Brain className="h-4 w-4 text-primary" />
                  <span className="text-muted-foreground uppercase tracking-wider">Recruiter Psychology Insight</span>
                </CardTitle>
              </CardHeader>
              <CardContent><p className="text-sm leading-relaxed">{result.recruiterPsychologyInsight}</p></CardContent>
            </Card>
          </motion.section>
        )}

        {/* Final Verdict */}
        {result.finalVerdict && (
          <motion.section className="mb-8" {...fadeUp(0.45)}>
            <Card className="glass border-primary/30 bg-primary/5">
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <Target className="h-4 w-4 text-primary" />
                  <span className="gradient-text uppercase tracking-wider">Final Verdict</span>
                </CardTitle>
              </CardHeader>
              <CardContent><p className="text-sm font-medium leading-relaxed">{result.finalVerdict}</p></CardContent>
            </Card>
          </motion.section>
        )}

        {/* Student Growth Recommendations */}
        {result.resumeType === "STUDENT" && result.studentGrowthRecommendations && result.studentGrowthRecommendations.length > 0 && (
          <motion.section className="mb-8" {...fadeUp(0.47)}>
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-lg bg-primary/10 text-primary">
                <GraduationCap className="h-5 w-5" />
              </div>
              <h3 className="text-base sm:text-lg font-bold text-foreground">Student Growth Recommendations</h3>
            </div>
            <Card className="glass border-primary/20 bg-primary/5">
              <CardContent className="pt-6">
                <ul className="space-y-3">
                  {result.studentGrowthRecommendations.map((tip, i) => (
                    <li key={i} className="flex items-start gap-3 text-sm">
                      <span className="text-primary font-bold mt-0.5">✦</span>
                      <span className="leading-relaxed">{tip}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </motion.section>
        )}

        {/* AI Resume Roast */}
        <ResumeRoast result={result} fileName={analysis.file_name} />

        {/* Share Buttons */}
        <ShareSection score={result.atsScore} analysisId={id || ""} />

        <motion.div className="text-center pt-4 pb-8 space-y-4" {...fadeUp(0.5)}>
          <motion.button
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            disabled={checkingAccess}
            onClick={handleFixResume}
            className="inline-flex items-center gap-2 px-8 py-3 rounded-xl text-base font-semibold bg-gradient-to-r from-violet-600 to-cyan-600 text-white shadow-lg shadow-violet-500/25 hover:shadow-xl hover:shadow-violet-500/30 transition-shadow disabled:opacity-50"
          >
            <Zap className="h-4 w-4" /> Fix My Resume Now
          </motion.button>
          <p className="text-xs text-muted-foreground/60 mt-3">AI will generate an optimized version based on this analysis</p>
          <div className="pt-2">
            <motion.button
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              onClick={() => navigate("/studio")}
              className="inline-flex items-center gap-2 px-8 py-3 rounded-xl text-base font-semibold border-2 border-violet-500/30 text-violet-300 hover:bg-violet-500/10 hover:border-violet-500/50 transition-all"
            >
              <Sparkles className="h-4 w-4" /> Try Resume Studio — Chat & Edit Live
            </motion.button>
          </div>
        </motion.div>

        <PaymentDialog
          open={paymentOpen}
          onOpenChange={setPaymentOpen}
          resumeAnalysisId={id || ""}
          userEmail={user?.email || ""}
          onSuccess={() => { setPaymentOpen(false); navigate(`/fix/${id}`); }}
        />
      </main>

      {/* Sticky bottom conversion bar */}
      {!isFixUnlocked && showStickyBar && (
        <motion.div
          className="fixed bottom-0 left-0 right-0 z-50 glass-strong border-t border-violet-500/10 py-3"
          initial={{ y: 100 }}
          animate={{ y: 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 30 }}
        >
          <div className="container flex items-center justify-between max-w-5xl px-4">
            <p className="text-sm font-medium hidden sm:block text-muted-foreground">Ready to fix your resume?</p>
            <p className="text-sm font-medium sm:hidden text-muted-foreground">Fix your resume</p>
            <div className="flex items-center gap-2">
              <motion.button
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                onClick={handleFixResume}
                disabled={checkingAccess}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold bg-gradient-to-r from-violet-600 to-cyan-600 text-white shadow-lg shadow-violet-500/20 disabled:opacity-50"
              >
                <Zap className="h-4 w-4" /> Fix My Resume – ₹299
              </motion.button>
              <motion.button
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                onClick={() => navigate("/studio")}
                className="hidden sm:inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border border-violet-500/30 text-violet-300 hover:bg-violet-500/10"
              >
                <Sparkles className="h-3.5 w-3.5" /> Studio
              </motion.button>
            </div>
          </div>
        </motion.div>
      )}

      {/* Post-analysis Studio toast */}
      <PostAnalysisStudioToast />
    </div>
  );
}
