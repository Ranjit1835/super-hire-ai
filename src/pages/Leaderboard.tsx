import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { motion } from "framer-motion";
import { Trophy, Zap, ArrowLeft, Upload, TrendingUp, Medal } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface LeaderboardEntry {
  id: string;
  display_name: string;
  college: string | null;
  industry: string | null;
  role_target: string | null;
  ats_score: number;
  improvement: number;
  created_at: string;
}

const SCORE_COLOR = (s: number) =>
  s >= 80 ? "text-green-400" : s >= 60 ? "text-yellow-400" : "text-red-400";

const RANK_ICON = (rank: number) => {
  if (rank === 1) return <Medal className="h-5 w-5 text-yellow-400" />;
  if (rank === 2) return <Medal className="h-5 w-5 text-gray-300" />;
  if (rank === 3) return <Medal className="h-5 w-5 text-amber-600" />;
  return <span className="text-sm text-muted-foreground font-mono w-5 text-center">{rank}</span>;
};

export default function Leaderboard() {
  const navigate = useNavigate();
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"top" | "recent">("top");

  useEffect(() => {
    const fetchEntries = async () => {
      setLoading(true);
      const base = supabase
        .from("leaderboard_entries")
        .select("id, display_name, college, industry, role_target, ats_score, improvement, created_at")
        .eq("is_public", true)
        .limit(50);

      const { data } = await (tab === "top"
        ? base.order("ats_score", { ascending: false })
        : base.order("created_at", { ascending: false }));
      setEntries(data ?? []);
      setLoading(false);
    };
    fetchEntries();
  }, [tab]);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border glass-strong sticky top-0 z-50">
        <div className="container flex items-center h-14">
          <Button variant="ghost" size="sm" onClick={() => navigate("/")} className="gap-2 mr-4">
            <ArrowLeft className="h-4 w-4" /> Home
          </Button>
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-lg bg-primary flex items-center justify-center">
              <Zap className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="font-bold">HireResume</span>
          </div>
        </div>
      </header>

      <main className="container max-w-3xl py-10 px-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <div className="text-center mb-8">
            <div className="flex items-center justify-center gap-2 mb-3">
              <Trophy className="h-8 w-8 text-yellow-400" />
              <h1 className="text-3xl font-bold">Resume Leaderboard</h1>
            </div>
            <p className="text-muted-foreground max-w-md mx-auto">
              Opt-in scores from job seekers across India. See where you rank — and get inspired to improve.
            </p>
            <Button className="mt-4 gap-2" onClick={() => navigate("/dashboard")}>
              <Upload className="h-4 w-4" /> Check My Score
            </Button>
          </div>

          {/* Tabs */}
          <div className="flex gap-2 mb-6">
            <Button variant={tab === "top" ? "default" : "outline"} size="sm" onClick={() => setTab("top")}>
              <Trophy className="h-4 w-4 mr-1" /> Top Scores
            </Button>
            <Button variant={tab === "recent" ? "default" : "outline"} size="sm" onClick={() => setTab("recent")}>
              <TrendingUp className="h-4 w-4 mr-1" /> Recent
            </Button>
          </div>

          {loading ? (
            <div className="flex justify-center py-16">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            </div>
          ) : entries.length === 0 ? (
            <Card className="glass text-center py-16">
              <CardContent>
                <Trophy className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground">No public entries yet. Be the first to share your score!</p>
                <Button className="mt-4" onClick={() => navigate("/dashboard")}>Upload My Resume</Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {entries.map((entry, i) => (
                <motion.div key={entry.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.03 }}>
                  <Card className="glass hover:border-primary/30 transition-all duration-200">
                    <CardContent className="flex items-center gap-4 py-3">
                      <div className="flex items-center justify-center w-8 shrink-0">
                        {RANK_ICON(i + 1)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold truncate">{entry.display_name}</span>
                          {entry.college && <Badge variant="secondary" className="text-xs">{entry.college}</Badge>}
                          {entry.role_target && <span className="text-xs text-muted-foreground hidden sm:inline">{entry.role_target}</span>}
                        </div>
                        {entry.improvement > 0 && (
                          <span className="text-xs text-green-400">+{entry.improvement} pts improved</span>
                        )}
                      </div>
                      <div className={`text-2xl font-bold shrink-0 ${SCORE_COLOR(entry.ats_score)}`}>
                        {entry.ats_score}
                        <span className="text-xs text-muted-foreground font-normal">/100</span>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              ))}
            </div>
          )}
        </motion.div>
      </main>
    </div>
  );
}
