import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { motion } from "framer-motion";
import { Zap, ArrowLeft, Copy, Check, BarChart3, TrendingUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface WeeklyStatsData {
  period: string;
  weekly_analyses: number;
  avg_score: number;
  score_distribution: Record<string, number>;
  total_analyses: number;
  social_post: string;
  generated_at: string;
}

export default function WeeklyStats() {
  const navigate = useNavigate();
  const [stats, setStats] = useState<WeeklyStatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    supabase.functions.invoke("weekly-stats").then(({ data }) => {
      setStats(data);
      setLoading(false);
    });
  }, []);

  const copyPost = () => {
    if (!stats) return;
    navigator.clipboard.writeText(stats.social_post);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border glass-strong sticky top-0 z-50">
        <div className="container flex items-center h-14">
          <Button variant="ghost" size="sm" onClick={() => navigate("/dashboard")} className="gap-2 mr-4">
            <ArrowLeft className="h-4 w-4" /> Dashboard
          </Button>
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-lg bg-primary flex items-center justify-center">
              <Zap className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="font-bold">HireResume</span>
            <Badge className="bg-primary/20 text-primary border-primary/30 text-xs ml-1">Weekly Stats</Badge>
          </div>
        </div>
      </header>

      <main className="container max-w-3xl py-10 px-4">
        {loading ? (
          <div className="flex justify-center py-24">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        ) : !stats ? (
          <p className="text-center text-muted-foreground py-24">Failed to load stats.</p>
        ) : (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
            <div>
              <h1 className="text-3xl font-bold flex items-center gap-2 mb-1">
                <BarChart3 className="h-7 w-7 text-primary" /> Weekly Pulse
              </h1>
              <p className="text-muted-foreground">{stats.period}</p>
            </div>

            {/* KPI Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                { label: "Analyses This Week", value: stats.weekly_analyses?.toLocaleString() ?? "—" },
                { label: "Avg ATS Score", value: `${stats.avg_score}/100` },
                { label: "Total All-Time", value: stats.total_analyses?.toLocaleString() ?? "—" },
                { label: "Strong Resumes", value: `${stats.score_distribution["81-100 (Strong)"] ?? 0}` },
              ].map(kpi => (
                <Card key={kpi.label} className="glass text-center">
                  <CardContent className="pt-4 pb-3">
                    <div className="text-2xl font-bold text-primary">{kpi.value}</div>
                    <div className="text-xs text-muted-foreground mt-1">{kpi.label}</div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Distribution */}
            <Card className="glass">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <TrendingUp className="h-4 w-4" /> Score Distribution This Week
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {Object.entries(stats.score_distribution).map(([label, count]) => {
                  const total = Object.values(stats.score_distribution).reduce((a, b) => a + b, 0);
                  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
                  const color = label.includes("High Risk") ? "bg-red-500" :
                    label.includes("Needs Work") ? "bg-yellow-500" :
                    label.includes("Competitive") ? "bg-blue-500" : "bg-green-500";
                  return (
                    <div key={label}>
                      <div className="flex justify-between text-sm mb-1">
                        <span>{label}</span>
                        <span className="text-muted-foreground">{count} ({pct}%)</span>
                      </div>
                      <div className="h-2 bg-muted rounded-full overflow-hidden">
                        <div className={`h-full ${color} rounded-full transition-all duration-500`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>

            {/* Social Post */}
            <Card className="glass-neon">
              <CardHeader className="pb-3 flex flex-row items-center justify-between">
                <CardTitle className="text-base">📱 Ready-to-Post Social Copy</CardTitle>
                <Button variant="outline" size="sm" onClick={copyPost} className="gap-1 shrink-0">
                  {copied ? <Check className="h-3 w-3 text-green-400" /> : <Copy className="h-3 w-3" />}
                  {copied ? "Copied!" : "Copy"}
                </Button>
              </CardHeader>
              <CardContent>
                <pre className="text-sm text-muted-foreground whitespace-pre-wrap font-sans bg-muted/30 rounded p-4 leading-relaxed">
                  {stats.social_post}
                </pre>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </main>
    </div>
  );
}
