import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { ScoreMeter } from "@/components/ScoreMeter";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { motion } from "framer-motion";
import { Lock, LogIn, UserPlus, Zap, XCircle, AlertTriangle, Lightbulb } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { AnimatedGradientMesh } from "@/components/premium";

interface GuestResult {
  atsScore: number;
  recruiterScanScore: number;
  keywordStrengthScore: number;
  quantificationScore: number;
  structureScore: number;
  interviewProbability: number;
  marketCompetitivenessLevel: string;
  performanceLevelTag: string;
  contextStatement: string;
  resumeType: string;
  criticalIssuesCount: number;
  warningsCount: number;
  optimizationsCount: number;
}

export default function GuestAnalysis() {
  const { token } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [result, setResult] = useState<GuestResult | null>(null);
  const [fileName, setFileName] = useState("");
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);

  useEffect(() => {
    if (!user || !token || claiming) return;
    setClaiming(true);
    (async () => {
      try {
        const session = await supabase.auth.getSession();
        const accessToken = session.data.session?.access_token;
        const res = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/claim-guest-analysis`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
              ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
            },
            body: JSON.stringify({ guestToken: token }),
          }
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Failed to claim analysis");
        if (data?.id) {
          toast({ title: "Analysis unlocked!", description: "Full results are now available." });
          navigate(`/analysis/${data.id}`, { replace: true });
        }
      } catch (err: any) {
        toast({ title: "Could not claim analysis", description: err.message, variant: "destructive" });
        navigate("/dashboard", { replace: true });
      }
    })();
  }, [user, token]);

  useEffect(() => {
    if (!token || user) return;
    (async () => {
      try {
        const res = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-guest-analysis`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            },
            body: JSON.stringify({ token }),
          }
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to fetch");
        setResult(data.result);
        setFileName(data.fileName);
        document.title = `${data.fileName} – Preview – HireResume`;
      } catch (err: any) {
        toast({ title: "Analysis not found", description: err.message, variant: "destructive" });
        navigate("/", { replace: true });
      } finally {
        setLoading(false);
      }
    })();
  }, [token, user]);

  if (loading || claiming) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background relative">
        <AnimatedGradientMesh />
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
        >
          <div className="h-8 w-8 rounded-full border-2 border-violet-400 border-t-transparent animate-spin" />
        </motion.div>
      </div>
    );
  }

  if (!result) return null;

  const tagColor = {
    "High Risk – Immediate Fix Required": "bg-red-500/15 text-red-400 border-red-500/25",
    "Needs Strategic Improvement": "bg-amber-500/15 text-amber-400 border-amber-500/25",
    "Competitive but Optimizable": "bg-cyan-500/15 text-cyan-400 border-cyan-500/25",
    "Strong & Market Ready": "bg-emerald-500/15 text-emerald-400 border-emerald-500/25",
  }[result.performanceLevelTag] || "bg-white/5 text-muted-foreground";

  const scoreColor = result.atsScore >= 80 ? "text-emerald-400" : result.atsScore >= 60 ? "text-amber-400" : "text-red-400";

  return (
    <div className="min-h-screen bg-background relative">
      <AnimatedGradientMesh />

      {/* Header */}
      <header className="border-b border-violet-500/10 glass-strong sticky top-0 z-50 relative">
        <div className="container flex items-center justify-between h-14">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-violet-600 to-cyan-600 flex items-center justify-center shadow-lg shadow-violet-500/20">
              <Zap className="h-4 w-4 text-white" />
            </div>
            <span className="font-bold text-foreground">HireResume</span>
          </div>
          <div className="flex items-center gap-2">
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => navigate("/auth?returnTo=guest&guestToken=" + token)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium border border-violet-500/20 text-muted-foreground hover:text-foreground hover:bg-violet-500/5 transition-all flex items-center gap-1"
            >
              <LogIn className="h-3.5 w-3.5" /> Sign In
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => navigate("/auth?returnTo=guest&guestToken=" + token)}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-gradient-to-r from-violet-600 to-cyan-600 text-white hover:shadow-lg hover:shadow-violet-500/25 transition-all flex items-center gap-1"
            >
              <UserPlus className="h-3.5 w-3.5" /> Create Account
            </motion.button>
          </div>
        </div>
      </header>

      <main className="container py-8 max-w-5xl relative z-10">
        {/* Performance Header */}
        <motion.div
          className="rounded-2xl border border-violet-500/15 glass p-8 mb-10"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <p className="text-sm text-muted-foreground mb-6">
            Your resume analysis is ready. Sign in to unlock the full report.
          </p>
          <div className="flex flex-col md:flex-row items-center gap-8">
            <div className="flex flex-col items-center">
              <ScoreMeter score={result.atsScore} label="" size={160} />
              <p className="text-xs text-muted-foreground mt-1">ATS SCORE</p>
            </div>
            <div className="flex-1 space-y-4">
              <div className="flex items-center gap-3 flex-wrap">
                <span className={`text-5xl font-black tabular-nums font-mono ${scoreColor}`}>{result.atsScore}</span>
                <span className="text-2xl text-muted-foreground font-light">/ 100</span>
              </div>
              <Badge className={`text-sm px-4 py-1.5 ${tagColor}`}>{result.performanceLevelTag}</Badge>
              {result.contextStatement && (
                <p className="text-sm text-muted-foreground italic leading-relaxed">{result.contextStatement}</p>
              )}
            </div>
          </div>
        </motion.div>

        {/* Scores */}
        <motion.section className="mb-10" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <h2 className="text-xl font-bold mb-6 text-foreground">Detailed Scores</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-6">
            <ScoreMeter score={result.recruiterScanScore} label="Recruiter Scan" />
            <ScoreMeter score={result.keywordStrengthScore} label="Keyword Strength" />
            <ScoreMeter score={result.quantificationScore} label="Quantification" />
            <ScoreMeter score={result.structureScore} label="Structure" />
            <ScoreMeter score={result.interviewProbability} label="Interview Prob." />
          </div>
        </motion.section>

        {/* Blurred sections with overlay */}
        <div className="relative">
          <div className="filter blur-[8px] select-none pointer-events-none space-y-6">
            {result.criticalIssuesCount > 0 && (
              <div>
                <div className="flex items-center gap-3 mb-4">
                  <div className="p-2 rounded-lg bg-red-500/10 text-red-400"><XCircle className="h-5 w-5" /></div>
                  <h3 className="text-lg font-bold text-foreground">Critical Issues</h3>
                  <Badge variant="secondary">{result.criticalIssuesCount}</Badge>
                </div>
                {Array.from({ length: result.criticalIssuesCount }).map((_, i) => (
                  <div key={i} className="glass rounded-xl mb-3 p-5 border border-violet-500/10">
                    <div className="h-4 bg-white/5 rounded w-3/4 mb-2" />
                    <div className="h-3 bg-white/5 rounded w-1/2" />
                  </div>
                ))}
              </div>
            )}
            {result.warningsCount > 0 && (
              <div>
                <div className="flex items-center gap-3 mb-4">
                  <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400"><AlertTriangle className="h-5 w-5" /></div>
                  <h3 className="text-lg font-bold text-foreground">Strategic Warnings</h3>
                  <Badge variant="secondary">{result.warningsCount}</Badge>
                </div>
                {Array.from({ length: result.warningsCount }).map((_, i) => (
                  <div key={i} className="glass rounded-xl mb-3 p-5 border border-violet-500/10">
                    <div className="h-4 bg-white/5 rounded w-3/4 mb-2" />
                    <div className="h-3 bg-white/5 rounded w-1/2" />
                  </div>
                ))}
              </div>
            )}
            {result.optimizationsCount > 0 && (
              <div>
                <div className="flex items-center gap-3 mb-4">
                  <div className="p-2 rounded-lg bg-cyan-500/10 text-cyan-400"><Lightbulb className="h-5 w-5" /></div>
                  <h3 className="text-lg font-bold text-foreground">Optimizations</h3>
                  <Badge variant="secondary">{result.optimizationsCount}</Badge>
                </div>
                {Array.from({ length: result.optimizationsCount }).map((_, i) => (
                  <div key={i} className="glass rounded-xl mb-3 p-5 border border-violet-500/10">
                    <div className="h-4 bg-white/5 rounded w-3/4 mb-2" />
                    <div className="h-3 bg-white/5 rounded w-1/2" />
                  </div>
                ))}
              </div>
            )}
            <div className="glass rounded-xl p-5 border border-violet-500/10">
              <div className="h-4 bg-white/5 rounded w-full mb-3" />
              <div className="h-4 bg-white/5 rounded w-5/6 mb-3" />
              <div className="h-4 bg-white/5 rounded w-4/5 mb-3" />
              <div className="h-4 bg-white/5 rounded w-3/4" />
            </div>
          </div>

          {/* Overlay */}
          <motion.div
            className="absolute inset-0 flex items-center justify-center z-10"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
          >
            <div className="glass rounded-2xl p-8 max-w-md text-center shadow-2xl shadow-violet-500/10 border border-violet-500/20">
              <div className="h-14 w-14 rounded-xl bg-gradient-to-br from-violet-600/20 to-cyan-600/20 border border-violet-500/20 flex items-center justify-center mx-auto mb-4">
                <Lock className="h-7 w-7 text-violet-400" />
              </div>
              <h3 className="text-xl font-bold mb-2 text-foreground">Unlock Full Analysis</h3>
              <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
                Sign in to see detailed issues, fix recommendations, keyword suggestions, and your complete recruiter-grade report.
              </p>
              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => navigate("/auth?returnTo=guest&guestToken=" + token)}
                  className="px-5 py-2.5 rounded-lg text-sm font-semibold bg-gradient-to-r from-violet-600 to-cyan-600 text-white hover:shadow-lg hover:shadow-violet-500/25 transition-all flex items-center justify-center gap-2"
                >
                  <LogIn className="h-4 w-4" /> Sign In
                </motion.button>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => navigate("/auth?returnTo=guest&guestToken=" + token)}
                  className="px-5 py-2.5 rounded-lg text-sm font-medium border border-violet-500/20 text-foreground hover:bg-violet-500/5 transition-all flex items-center justify-center gap-2"
                >
                  <UserPlus className="h-4 w-4" /> Create Account
                </motion.button>
              </div>
            </div>
          </motion.div>
        </div>
      </main>

      {/* Sticky bottom bar */}
      <div className="fixed bottom-0 left-0 right-0 z-50 glass-strong border-t border-violet-500/10 py-3">
        <div className="container flex items-center justify-between max-w-5xl">
          <p className="text-sm font-medium text-foreground">Unlock full recruiter-grade analysis now</p>
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => navigate("/auth?returnTo=guest&guestToken=" + token)}
            className="px-4 py-2 rounded-lg text-xs font-semibold bg-gradient-to-r from-violet-600 to-cyan-600 text-white hover:shadow-lg hover:shadow-violet-500/25 transition-all flex items-center gap-1.5"
          >
            <UserPlus className="h-3.5 w-3.5" /> Create Free Account
          </motion.button>
        </div>
      </div>
    </div>
  );
}
