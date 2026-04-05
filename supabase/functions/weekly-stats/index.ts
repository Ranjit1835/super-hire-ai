import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  // Total analyses this week
  const { count: weeklyAnalyses } = await supabase
    .from("resume_analyses")
    .select("id", { count: "exact", head: true })
    .gte("created_at", weekAgo.toISOString());

  // Average ATS score this week
  const { data: scoreData } = await supabase
    .from("resume_analyses")
    .select("ats_score")
    .gte("created_at", weekAgo.toISOString())
    .not("ats_score", "is", null);

  const scores = (scoreData ?? []).map((r: { ats_score: number }) => r.ats_score);
  const avgScore = scores.length > 0
    ? Math.round(scores.reduce((a: number, b: number) => a + b, 0) / scores.length)
    : 0;

  // Score distribution
  const distribution = {
    "0-40 (High Risk)": scores.filter((s: number) => s <= 40).length,
    "41-60 (Needs Work)": scores.filter((s: number) => s > 40 && s <= 60).length,
    "61-80 (Competitive)": scores.filter((s: number) => s > 60 && s <= 80).length,
    "81-100 (Strong)": scores.filter((s: number) => s > 80).length,
  };

  // Total all-time analyses
  const { count: totalAnalyses } = await supabase
    .from("resume_analyses")
    .select("id", { count: "exact", head: true });

  // Weekly social post copy
  const weekLabel = `${weekAgo.toLocaleDateString("en-IN", { day: "numeric", month: "short" })} – ${now.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`;

  const post = `📊 HireResume Weekly Pulse — ${weekLabel}

${weeklyAnalyses?.toLocaleString()} resumes analysed this week.
Average ATS score: ${avgScore}/100

Score breakdown:
🔴 0–40 (High Risk): ${distribution["0-40 (High Risk)"]} resumes
🟡 41–60 (Needs Work): ${distribution["41-60 (Needs Work)"]} resumes
🟢 61–80 (Competitive): ${distribution["61-80 (Competitive)"]} resumes
✅ 81–100 (Strong): ${distribution["81-100 (Strong)"]} resumes

${avgScore < 65 ? "Most resumes are invisible to ATS. The fix takes minutes — try it free." : "Indian job seekers are levelling up their resumes. Are you?"}

🔗 Check yours free → hiresume.in
#Resume #JobSearch #ATS #HireResume #CareerTips`;

  const stats = {
    period: weekLabel,
    weekly_analyses: weeklyAnalyses,
    avg_score: avgScore,
    score_distribution: distribution,
    total_analyses: totalAnalyses,
    social_post: post,
    generated_at: now.toISOString(),
  };

  return new Response(JSON.stringify(stats), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
