import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { ScoreMeter } from "@/components/ScoreMeter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { motion } from "framer-motion";
import { Lock, LogIn, UserPlus, Zap, XCircle, AlertTriangle, Lightbulb } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

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

  // If user logs in while on this page, auto-claim
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

  // Fetch guest data
  useEffect(() => {
    if (!token || user) return; // Don't fetch if user is logged in (claiming handles it)
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
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!result) return null;

  const tagColor = {
    "High Risk – Immediate Fix Required": "bg-destructive/20 text-destructive border-destructive/30",
    "Needs Strategic Improvement": "bg-warning/20 text-warning border-warning/30",
    "Competitive but Optimizable": "bg-info/20 text-info border-info/30",
    "Strong & Market Ready": "bg-success/20 text-success border-success/30",
  }[result.performanceLevelTag] || "bg-muted/20 text-muted-foreground";

  const scoreColor = result.atsScore >= 80 ? "text-success" : result.atsScore >= 60 ? "text-warning" : "text-destructive";

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
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => navigate("/auth?returnTo=guest&guestToken=" + token)}>
              <LogIn className="h-4 w-4 mr-1" /> Sign In
            </Button>
            <Button size="sm" onClick={() => navigate("/auth?returnTo=guest&guestToken=" + token)}>
              <UserPlus className="h-4 w-4 mr-1" /> Create Account
            </Button>
          </div>
        </div>
      </header>

      <main className="container py-8 max-w-5xl relative">
        {/* Performance Header — visible */}
        <motion.div
          className="rounded-2xl border border-border/50 glass-strong p-8 mb-10"
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
                <span className={`text-5xl font-black tabular-nums ${scoreColor}`}>{result.atsScore}</span>
                <span className="text-2xl text-muted-foreground font-light">/ 100</span>
              </div>
              <Badge className={`text-sm px-4 py-1.5 ${tagColor}`}>{result.performanceLevelTag}</Badge>
              {result.contextStatement && (
                <p className="text-sm text-muted-foreground italic leading-relaxed">{result.contextStatement}</p>
              )}
            </div>
          </div>
        </motion.div>

        {/* Scores — visible */}
        <motion.section className="mb-10" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <h2 className="text-xl font-bold mb-6">Detailed Scores</h2>
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
          {/* Blurred placeholder content */}
          <div className="filter blur-[8px] select-none pointer-events-none space-y-6">
            {result.criticalIssuesCount > 0 && (
              <div>
                <div className="flex items-center gap-3 mb-4">
                  <div className="p-2 rounded-lg bg-destructive/10 text-destructive"><XCircle className="h-5 w-5" /></div>
                  <h3 className="text-lg font-bold">Critical Issues</h3>
                  <Badge variant="secondary">{result.criticalIssuesCount}</Badge>
                </div>
                {Array.from({ length: result.criticalIssuesCount }).map((_, i) => (
                  <Card key={i} className="glass mb-3">
                    <CardContent className="py-5">
                      <div className="h-4 bg-muted/40 rounded w-3/4 mb-2" />
                      <div className="h-3 bg-muted/30 rounded w-1/2" />
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
            {result.warningsCount > 0 && (
              <div>
                <div className="flex items-center gap-3 mb-4">
                  <div className="p-2 rounded-lg bg-warning/10 text-warning"><AlertTriangle className="h-5 w-5" /></div>
                  <h3 className="text-lg font-bold">Strategic Warnings</h3>
                  <Badge variant="secondary">{result.warningsCount}</Badge>
                </div>
                {Array.from({ length: result.warningsCount }).map((_, i) => (
                  <Card key={i} className="glass mb-3">
                    <CardContent className="py-5">
                      <div className="h-4 bg-muted/40 rounded w-3/4 mb-2" />
                      <div className="h-3 bg-muted/30 rounded w-1/2" />
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
            {result.optimizationsCount > 0 && (
              <div>
                <div className="flex items-center gap-3 mb-4">
                  <div className="p-2 rounded-lg bg-info/10 text-info"><Lightbulb className="h-5 w-5" /></div>
                  <h3 className="text-lg font-bold">Optimizations</h3>
                  <Badge variant="secondary">{result.optimizationsCount}</Badge>
                </div>
                {Array.from({ length: result.optimizationsCount }).map((_, i) => (
                  <Card key={i} className="glass mb-3">
                    <CardContent className="py-5">
                      <div className="h-4 bg-muted/40 rounded w-3/4 mb-2" />
                      <div className="h-3 bg-muted/30 rounded w-1/2" />
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
            {/* Fake resume preview */}
            <Card className="glass">
              <CardContent className="py-5">
                <div className="h-4 bg-muted/40 rounded w-full mb-3" />
                <div className="h-4 bg-muted/30 rounded w-5/6 mb-3" />
                <div className="h-4 bg-muted/30 rounded w-4/5 mb-3" />
                <div className="h-4 bg-muted/30 rounded w-3/4" />
              </CardContent>
            </Card>
          </div>

          {/* Overlay */}
          <motion.div
            className="absolute inset-0 flex items-center justify-center z-10"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
          >
            <div className="glass-strong rounded-2xl p-8 max-w-md text-center shadow-xl border border-border">
              <div className="h-14 w-14 rounded-xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
                <Lock className="h-7 w-7 text-primary" />
              </div>
              <h3 className="text-xl font-bold mb-2">Unlock Full Analysis</h3>
              <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
                Sign in to see detailed issues, fix recommendations, keyword suggestions, and your complete recruiter-grade report.
              </p>
              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <Button onClick={() => navigate("/auth?returnTo=guest&guestToken=" + token)} className="gap-2">
                  <LogIn className="h-4 w-4" /> Sign In
                </Button>
                <Button variant="outline" onClick={() => navigate("/auth?returnTo=guest&guestToken=" + token)} className="gap-2">
                  <UserPlus className="h-4 w-4" /> Create Account
                </Button>
              </div>
            </div>
          </motion.div>
        </div>
      </main>

      {/* Sticky bottom bar */}
      <div className="fixed bottom-0 left-0 right-0 z-50 glass-strong border-t border-border py-3">
        <div className="container flex items-center justify-between max-w-5xl">
          <p className="text-sm font-medium">Unlock full recruiter-grade analysis now</p>
          <Button size="sm" onClick={() => navigate("/auth?returnTo=guest&guestToken=" + token)} className="gap-2">
            <UserPlus className="h-4 w-4" /> Create Free Account
          </Button>
        </div>
      </div>
    </div>
  );
}
