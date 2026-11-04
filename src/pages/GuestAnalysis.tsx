import { useEffect, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { ScoreMeter } from "@/components/ScoreMeter";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { motion } from "framer-motion";
import { Lock, XCircle, AlertTriangle, Lightbulb, SearchX, Tags } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { performanceLevel, TONE_BADGE } from "@/lib/score-levels";
import { AnimatedGradientMesh } from "@/components/premium";
import { GoogleIcon } from "@/components/GoogleIcon";
import { rememberRedirect } from "@/lib/safe-redirect";

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
  topIssue?: { issue: string; whyItMatters: string } | null;
  missingKeywords?: string[];
  missingKeywordsCount?: number;
}

function GoogleButton({ onClick, loading, className = "" }: { onClick: () => void; loading: boolean; className?: string }) {
  return (
    <motion.button
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      disabled={loading}
      className={`rounded-lg font-semibold bg-white text-gray-900 border border-gray-200 hover:bg-gray-100 transition-all flex items-center justify-center gap-2 disabled:opacity-60 ${className}`}
    >
      {loading
        ? <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-400 border-t-transparent" />
        : <GoogleIcon />}
      Continue with Google
    </motion.button>
  );
}

export default function GuestAnalysis() {
  const { token } = useParams();
  const { user, signInWithGoogle } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [result, setResult] = useState<GuestResult | null>(null);
  const [fileName, setFileName] = useState("");
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

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
        document.title = `${data.fileName} – Preview – HiResume`;
      } catch {
        // Expired (guest results are deleted after 7 days), mistyped, or the network failed:
        // say so here instead of silently dropping the visitor on the home page.
        setNotFound(true);
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

  if (notFound) {
    return (
      <main className="container max-w-lg py-20 px-4 text-center relative z-10">
        <SearchX className="h-10 w-10 text-violet-400 mx-auto mb-4" aria-hidden />
        <h1 className="text-2xl font-bold mb-2">This result isn't available</h1>
        <p className="text-sm text-muted-foreground mb-6">
          Results from a check without an account are kept for 7 days, so this link may have expired.
          It may also be incomplete. Check your resume again for a fresh score, or sign in to see results saved to your account.
        </p>
        <div className="flex flex-wrap gap-3 justify-center">
          <Link to="/" className="px-4 py-2 rounded-lg text-sm font-semibold bg-gradient-to-r from-violet-600 to-cyan-600 text-white">
            Check my resume again
          </Link>
          <Link to="/auth" className="px-4 py-2 rounded-lg text-sm font-medium border border-border hover:bg-white/5">
            Sign in
          </Link>
        </div>
      </main>
    );
  }

  if (!result) return null;

  const level = performanceLevel(result.atsScore);
  const totalIssues = result.criticalIssuesCount + result.warningsCount + result.optimizationsCount;
  const keywords = result.missingKeywords ?? [];
  const moreKeywords = (result.missingKeywordsCount ?? keywords.length) - keywords.length;

  const continueWithGoogle = async () => {
    setGoogleLoading(true);
    rememberRedirect(`/analysis/guest/${token}`); // Google returns here, and this page claims the scan
    await signInWithGoogle();
    setGoogleLoading(false);
  };
  const useEmail = () => navigate("/auth?returnTo=guest&guestToken=" + token);

  return (
    <div className="min-h-screen bg-background relative">
      <AnimatedGradientMesh />

      {/* Header */}

      <main className="container py-8 max-w-5xl relative z-10">
        {/* Performance Header */}
        <motion.div
          className="rounded-2xl border border-violet-500/15 glass p-8 mb-10"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <p className="text-sm text-muted-foreground mb-6">
            Your free score is ready. The full report is free with an account.
          </p>
          <div className="flex flex-col md:flex-row items-center gap-8">
            <div className="flex flex-col items-center">
              <ScoreMeter score={result.atsScore} label="" size={160} />
              <p className="text-xs text-muted-foreground mt-1">ATS SCORE</p>
            </div>
            <div className="flex-1 space-y-4 text-center md:text-left">
              <Badge className={`text-sm px-4 py-1.5 ${TONE_BADGE[level.tone]}`}>{level.label}</Badge>
              {result.contextStatement && (
                <p className="text-sm text-muted-foreground italic leading-relaxed">{result.contextStatement}</p>
              )}
            </div>
          </div>
        </motion.div>

        {/* One real finding, so signing in has something behind it */}
        {(result.topIssue || keywords.length > 0) && (
          <motion.section className="mb-10 space-y-4" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
            {result.topIssue && (
              <Card className="glass border-red-500/20">
                <CardContent className="pt-6">
                  <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-red-400 mb-2">
                    <XCircle className="h-4 w-4" aria-hidden /> Biggest issue on your resume
                  </p>
                  <p className="font-semibold text-foreground mb-1">{result.topIssue.issue}</p>
                  <p className="text-sm text-muted-foreground leading-relaxed">{result.topIssue.whyItMatters}</p>
                </CardContent>
              </Card>
            )}
            {keywords.length > 0 && (
              <Card className="glass border-violet-500/15">
                <CardContent className="pt-6">
                  <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-cyan-400 mb-3">
                    <Tags className="h-4 w-4" aria-hidden /> Missing keywords
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {keywords.map((keyword) => <Badge key={keyword} variant="secondary">{keyword}</Badge>)}
                    {moreKeywords > 0 && <Badge variant="outline">+{moreKeywords} more</Badge>}
                  </div>
                </CardContent>
              </Card>
            )}
          </motion.section>
        )}

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
              <h3 className="text-xl font-bold mb-2 text-foreground">
                {totalIssues > 0 ? `See all ${totalIssues} issues and how to fix them` : "See your full report"}
              </h3>
              <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
                Free with an account: every issue, all your missing keywords and your recruiter-grade report. No card needed.
              </p>
              <GoogleButton onClick={continueWithGoogle} loading={googleLoading} className="w-full px-5 py-3 text-sm" />
              <button onClick={useEmail} className="mt-3 text-xs text-violet-400 hover:text-violet-300 transition-colors">
                Use email instead
              </button>
            </div>
          </motion.div>
        </div>
      </main>

      {/* Sticky bottom bar */}
      <div data-bottom-bar className="fixed bottom-0 left-0 right-0 z-50 glass-strong border-t border-violet-500/10 py-3">
        <div className="container flex items-center justify-between gap-3 max-w-5xl">
          <p className="text-sm font-medium text-foreground hidden sm:block">See every issue and how to fix it, free</p>
          <GoogleButton onClick={continueWithGoogle} loading={googleLoading} className="w-full sm:w-auto px-4 py-2.5 text-sm" />
        </div>
      </div>
    </div>
  );
}
