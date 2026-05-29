import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { motion } from "framer-motion";
import { Zap, ArrowLeft, Copy, Check, BarChart3, TrendingUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AnimatedGradientMesh } from "@/components/premium";

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
    supabase.functions.invoke("weekly-stats").then(({ data, error }) => {
      if (error) console.error("Weekly stats error:", error);
      if (data) setStats(data);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const copyPost = () => {
    if (!stats) return;
    navigator.clipboard.writeText(stats.social_post);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen bg-background relative">
      <AnimatedGradientMesh />

      <header className="border-b border-violet-500/10 glass-strong sticky top-0 z-50 relative">
        <div className="container flex items-center h-14">
          <button onClick={() => navigate("/dashboard")} className="flex items-center gap-2 mr-4 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="h-4 w-4" /> Dashboard
          </button>
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-violet-600 to-cyan-600 flex items-center justify-center shadow-lg shadow-violet-500/20">
              <Zap className="h-4 w-4 text-white" />
            </div>
            <span className="font-bold text-foreground">HireResume</span>
            <Badge className="bg-violet-500/10 text-violet-300 border-violet-500/20 text-xs ml-1">Weekly Stats</Badge>
          </div>
        </div>
      </header>

      <main className="container max-w-3xl py-10 px-4 relative z-10">
        {loading ? (
          <div className="flex justify-center py-24">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-violet-400 border-t-transparent" />
          </div>
        ) : !stats ? (
          <p className="text-center text-muted-foreground py-24">Failed to load stats.</p>
        ) : (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
            <div>
              <h1 className="text-3xl font-bold flex items-center gap-2 mb-1">
                <BarChart3 className="h-7 w-7 text-violet-400" />
                <span className="gradient-text-new">Weekly Pulse</span>
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
              ].map((kpi) => (
                <motion.div
                  key={kpi.label}
                  whileHover={{ y: -2 }}
                  className="glass rounded-xl border border-violet-500/10 card-hover-glow text-center p-4"
                >
                  <div className="text-2xl font-bold font-mono gradient-text-new">{kpi.value}</div>
                  <div className="text-xs text-muted-foreground mt-1">{kpi.label}</div>
                </motion.div>
              ))}
            </div>

            {/* Distribution */}
            <div className="glass rounded-2xl border border-violet-500/10 overflow-hidden">
              <div className="px-6 py-4 border-b border-violet-500/10">
                <h3 className="text-base font-semibold flex items-center gap-2 text-foreground">
                  <TrendingUp className="h-4 w-4 text-violet-400" /> Score Distribution This Week
                </h3>
              </div>
              <div className="p-6 space-y-3">
                {Object.entries(stats.score_distribution).map(([label, count]) => {
                  const total = Object.values(stats.score_distribution).reduce((a, b) => a + b, 0);
                  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
                  const color = label.includes("High Risk") ? "from-red-500 to-red-600" :
                    label.includes("Needs Work") ? "from-amber-500 to-amber-600" :
                    label.includes("Competitive") ? "from-cyan-500 to-cyan-600" : "from-emerald-500 to-emerald-600";
                  return (
                    <div key={label}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-foreground">{label}</span>
                        <span className="text-muted-foreground font-mono">{count} ({pct}%)</span>
                      </div>
                      <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${pct}%` }}
                          transition={{ duration: 0.8, ease: "easeOut" }}
                          className={`h-full bg-gradient-to-r ${color} rounded-full`}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Social Post */}
            <div className="glass rounded-2xl border border-violet-500/15 overflow-hidden">
              <div className="px-6 py-4 border-b border-violet-500/10 flex items-center justify-between">
                <h3 className="text-base font-semibold text-foreground">Ready-to-Post Social Copy</h3>
                <motion.button
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={copyPost}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium glass border border-violet-500/15 text-muted-foreground hover:text-foreground transition-all"
                >
                  {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                  {copied ? "Copied!" : "Copy"}
                </motion.button>
              </div>
              <div className="p-6">
                <pre className="text-sm text-muted-foreground whitespace-pre-wrap font-sans bg-white/5 rounded-xl p-4 leading-relaxed border border-violet-500/10">
                  {stats.social_post}
                </pre>
              </div>
            </div>
          </motion.div>
        )}
      </main>
    </div>
  );
}
