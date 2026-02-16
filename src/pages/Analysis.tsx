import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { ScoreMeter } from "@/components/ScoreMeter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { motion } from "framer-motion";
import {
  ArrowLeft, Zap, AlertTriangle, Lightbulb, CheckCircle2,
  XCircle, Wrench, TrendingUp, Brain, Target, ChevronDown, ChevronUp,
} from "lucide-react";
import type { AnalysisResult, AnalysisIssue } from "@/lib/analysis-types";

function IssueCard({ issue, color, icon: Icon }: { issue: AnalysisIssue; color: string; icon: any }) {
  const [open, setOpen] = useState(false);
  const impactColor = {
    HIGH: "bg-destructive/20 text-destructive border-destructive/40",
    MEDIUM: "bg-warning/20 text-warning border-warning/40",
    LOW: "bg-info/20 text-info border-info/40",
  }[issue.impactLevel] || "";

  return (
    <div className={`rounded-xl border p-5 transition-all hover:shadow-lg ${color}`}>
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
    </div>
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
      className="rounded-2xl border border-border/50 glass-strong p-8 mb-10"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <p className="text-sm text-muted-foreground mb-6">
        The analysis is complete. Here's your professional resume performance report.
      </p>
      <div className="flex flex-col md:flex-row items-center gap-8">
        <div className="flex flex-col items-center">
          <div className="relative">
            <ScoreMeter score={result.atsScore} label="" size={160} />
          </div>
          <p className="text-xs text-muted-foreground mt-1">ATS SCORE</p>
        </div>
        <div className="flex-1 space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <span className={`text-5xl font-black tabular-nums ${scoreColor}`}>
              {result.atsScore}
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
      <h3 className="text-lg font-bold text-foreground">{title}</h3>
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
          setResult(data.analysis_result as unknown as AnalysisResult);
        }
        setLoading(false);
      });
  }, [id, user]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!analysis || !result) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <p className="text-muted-foreground mb-4">Analysis not found</p>
          <Button onClick={() => navigate("/dashboard")}>Back to Dashboard</Button>
        </div>
      </div>
    );
  }

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
    <div className="min-h-screen bg-background">
      <header className="border-b border-border glass-strong sticky top-0 z-50">
        <div className="container flex items-center justify-between h-14">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate("/dashboard")}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <p className="font-medium text-sm">{analysis.file_name}</p>
              <p className="text-xs text-muted-foreground">{new Date(analysis.created_at).toLocaleString()}</p>
            </div>
          </div>
          <Button onClick={() => navigate(`/fix/${id}`)} size="sm">
            <Zap className="h-4 w-4 mr-1" /> Fix My Resume
          </Button>
        </div>
      </header>

      <main className="container py-8 max-w-5xl">
        {/* Performance Header */}
        <PerformanceHeader result={result} />

        {/* Score Grid */}
        <motion.section className="mb-10" {...fadeUp(0.1)}>
          <div className="flex items-center gap-3 mb-6">
            <h2 className="text-xl font-bold">Detailed Scores</h2>
            <Badge className={badgeColor}>{result.marketCompetitivenessLevel}</Badge>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-6">
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
            <h3 className="text-lg font-bold text-foreground">Improved Version Preview</h3>
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

        <motion.div className="text-center pt-4 pb-8" {...fadeUp(0.5)}>
          <Button size="lg" onClick={() => navigate(`/fix/${id}`)} className="px-8">
            <Zap className="h-4 w-4 mr-2" /> Fix My Resume Now
          </Button>
          <p className="text-xs text-muted-foreground mt-3">AI will generate an optimized version based on this analysis</p>
        </motion.div>
      </main>
    </div>
  );
}
