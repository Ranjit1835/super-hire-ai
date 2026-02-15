import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { ScoreMeter } from "@/components/ScoreMeter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { motion } from "framer-motion";
import { ArrowLeft, Zap, AlertTriangle, Lightbulb, CheckCircle2, XCircle, Wrench } from "lucide-react";
import type { AnalysisResult, AnalysisIssue } from "@/lib/analysis-types";

function IssueCard({ issue, color, icon: Icon }: { issue: AnalysisIssue; color: string; icon: any }) {
  return (
    <div className={`rounded-lg border p-4 ${color}`}>
      <div className="flex items-start gap-3">
        <Icon className="h-5 w-5 mt-0.5 shrink-0" />
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-medium text-sm">{issue.issue}</span>
            <Badge variant="outline" className="text-xs shrink-0">{issue.impactLevel}</Badge>
          </div>
          <p className="text-xs text-muted-foreground mb-2">{issue.whyItMatters}</p>
          <div className="flex items-start gap-1.5 text-xs">
            <Wrench className="h-3 w-3 mt-0.5 shrink-0 text-primary" />
            <span>{issue.fixRecommendation}</span>
          </div>
        </div>
      </div>
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
        {/* Scores */}
        <motion.section className="mb-10" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <div className="flex items-center gap-3 mb-6">
            <h2 className="text-2xl font-bold">Score Overview</h2>
            <Badge className={badgeColor}>{result.marketCompetitivenessLevel}</Badge>
          </div>
          <div className="grid grid-cols-3 md:grid-cols-6 gap-6">
            <ScoreMeter score={result.atsScore} label="ATS Score" />
            <ScoreMeter score={result.recruiterScanScore} label="Recruiter Scan" />
            <ScoreMeter score={result.keywordStrengthScore} label="Keyword Strength" />
            <ScoreMeter score={result.quantificationScore} label="Quantification" />
            <ScoreMeter score={result.structureScore} label="Structure" />
            <ScoreMeter score={result.interviewProbability} label="Interview Prob." />
          </div>
        </motion.section>

        {/* Critical Issues */}
        {result.criticalIssues?.length > 0 && (
          <motion.section className="mb-8" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
            <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
              <XCircle className="h-5 w-5 text-destructive" /> Critical Issues
            </h3>
            <div className="space-y-3">
              {result.criticalIssues.map((issue, i) => (
                <IssueCard key={i} issue={issue} color="border-destructive/30 bg-destructive/5" icon={XCircle} />
              ))}
            </div>
          </motion.section>
        )}

        {/* Warnings */}
        {result.warnings?.length > 0 && (
          <motion.section className="mb-8" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
            <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-warning" /> Strategic Warnings
            </h3>
            <div className="space-y-3">
              {result.warnings.map((issue, i) => (
                <IssueCard key={i} issue={issue} color="border-warning/30 bg-warning/5" icon={AlertTriangle} />
              ))}
            </div>
          </motion.section>
        )}

        {/* Optimizations */}
        {result.optimizationOpportunities?.length > 0 && (
          <motion.section className="mb-8" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
            <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
              <Lightbulb className="h-5 w-5 text-info" /> Impact Optimizations
            </h3>
            <div className="space-y-3">
              {result.optimizationOpportunities.map((issue, i) => (
                <IssueCard key={i} issue={issue} color="border-info/30 bg-info/5" icon={Lightbulb} />
              ))}
            </div>
          </motion.section>
        )}

        {/* Advanced Refinements */}
        {result.advancedRefinements?.length > 0 && (
          <motion.section className="mb-8" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}>
            <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-success" /> Advanced Refinements
            </h3>
            <div className="space-y-3">
              {result.advancedRefinements.map((issue, i) => (
                <IssueCard key={i} issue={issue} color="border-success/30 bg-success/5" icon={CheckCircle2} />
              ))}
            </div>
          </motion.section>
        )}

        {/* Rewritten Summary */}
        {result.rewrittenSummary && (
          <motion.section className="mb-8" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
            <Card className="glass">
              <CardHeader><CardTitle className="text-base">AI-Rewritten Summary</CardTitle></CardHeader>
              <CardContent><p className="text-sm text-muted-foreground">{result.rewrittenSummary}</p></CardContent>
            </Card>
          </motion.section>
        )}

        {/* Strong Bullets */}
        {result.rewrittenStrongBullets?.length > 0 && (
          <motion.section className="mb-8" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }}>
            <Card className="glass">
              <CardHeader><CardTitle className="text-base">Optimized Bullet Points</CardTitle></CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {result.rewrittenStrongBullets.map((b, i) => (
                    <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                      <span className="text-primary mt-1">•</span> {b}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </motion.section>
        )}

        {/* Missing Keywords */}
        {result.missingHighImpactKeywords?.length > 0 && (
          <motion.section className="mb-8" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
            <Card className="glass">
              <CardHeader><CardTitle className="text-base">Missing High-Impact Keywords</CardTitle></CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {result.missingHighImpactKeywords.map((kw, i) => (
                    <Badge key={i} variant="secondary">{kw}</Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          </motion.section>
        )}

        {/* Recruiter Psychology */}
        {result.recruiterPsychologyInsight && (
          <motion.section className="mb-8" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.45 }}>
            <Card className="glass gradient-border">
              <CardHeader><CardTitle className="text-base">Recruiter Psychology Insight</CardTitle></CardHeader>
              <CardContent><p className="text-sm text-muted-foreground">{result.recruiterPsychologyInsight}</p></CardContent>
            </Card>
          </motion.section>
        )}

        {/* Final Verdict */}
        {result.finalVerdict && (
          <motion.section className="mb-8" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}>
            <Card className="glass border-primary/30 bg-primary/5">
              <CardHeader><CardTitle className="text-base gradient-text">Final Verdict</CardTitle></CardHeader>
              <CardContent><p className="text-sm font-medium">{result.finalVerdict}</p></CardContent>
            </Card>
          </motion.section>
        )}

        <div className="text-center pt-4">
          <Button size="lg" onClick={() => navigate(`/fix/${id}`)}>
            <Zap className="h-4 w-4 mr-2" /> Fix My Resume
          </Button>
        </div>
      </main>
    </div>
  );
}
