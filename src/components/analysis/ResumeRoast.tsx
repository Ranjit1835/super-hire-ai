import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { motion } from "framer-motion";
import { Flame, Share2, CheckCircle2 } from "lucide-react";
import type { AnalysisResult } from "@/lib/analysis-types";

interface ResumeRoastProps {
  result: AnalysisResult;
  fileName: string;
}

export function ResumeRoast({ result, fileName }: ResumeRoastProps) {
  const roastText = result.resumeRoast || generateFallbackRoast(result);
  const fixTips = result.roastFixTips?.length
    ? result.roastFixTips
    : generateFallbackTips(result);

  const shareScore = result.atsScore;
  const shareText = `My resume scored ${shareScore}/100 on HiResume ATS check. Apparently recruiters would ${shareScore < 50 ? "reject it in seconds" : shareScore < 70 ? "skim past it quickly" : "give it a second look"}. Check yours at hiresume.in`;

  const handleShareTwitter = () => {
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}`, "_blank");
  };

  const handleShareLinkedIn = () => {
    window.open(`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent("https://hiresume.in")}&summary=${encodeURIComponent(shareText)}`, "_blank");
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(shareText);
  };

  return (
    <motion.section
      className="mb-8"
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.5, duration: 0.5 }}
    >
      {/* Roast Card */}
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 rounded-lg bg-destructive/10 text-destructive">
          <Flame className="h-5 w-5" />
        </div>
        <h3 className="text-base sm:text-lg font-bold text-foreground">AI Resume Roast 🔥</h3>
      </div>
      <Card className="glass border-destructive/20 bg-gradient-to-br from-destructive/5 to-transparent mb-4">
        <CardContent className="pt-6">
          <p className="text-sm leading-relaxed italic text-foreground">"{roastText}"</p>
        </CardContent>
      </Card>

      {/* How to Fix It */}
      <div className="flex items-center gap-3 mb-4 mt-6">
        <div className="p-2 rounded-lg bg-success/10 text-success">
          <CheckCircle2 className="h-5 w-5" />
        </div>
        <h3 className="text-base sm:text-lg font-bold text-foreground">How to Fix It</h3>
      </div>
      <Card className="glass border-success/20 mb-6">
        <CardContent className="pt-6">
          <ul className="space-y-2">
            {fixTips.map((tip, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <span className="text-success font-bold mt-0.5">→</span>
                <span>{tip}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {/* Share Buttons */}
      <Card className="glass">
        <CardContent className="pt-6">
          <div className="flex items-center gap-2 mb-4">
            <Share2 className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold">Share Your Score</span>
          </div>
          <p className="text-xs text-muted-foreground mb-4 p-3 rounded-lg bg-secondary/30 border border-border">
            "{shareText}"
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={handleShareTwitter}>
              𝕏 Twitter
            </Button>
            <Button size="sm" variant="outline" onClick={handleShareLinkedIn}>
              LinkedIn
            </Button>
            <Button size="sm" variant="outline" onClick={handleCopyLink}>
              Copy Text
            </Button>
          </div>
        </CardContent>
      </Card>
    </motion.section>
  );
}

function generateFallbackRoast(result: AnalysisResult): string {
  if (result.atsScore < 40) {
    return "Your resume reads like a to-do list someone forgot to finish. Recruiters would spend more time closing the tab than reading it. The keywords are missing, the achievements are vague, and the formatting is fighting the ATS like it has a personal vendetta.";
  }
  if (result.atsScore < 60) {
    return "Your resume looks generic and lacks strong achievements. Recruiters might skim it in seconds because the experience descriptions are weak and missing important keywords. It's not terrible, but it's the resume equivalent of a lukewarm handshake.";
  }
  if (result.atsScore < 80) {
    return "Not bad — your resume has the bones of something solid. But it's playing it safe when it should be showing off. A few more quantified wins and stronger keywords would push you from 'maybe pile' to 'definitely call.'";
  }
  return "Your resume is actually pretty strong. Most ATS systems would parse it cleanly, and recruiters would find what they need fast. A few tweaks could make it flawless, but you're already ahead of 80% of applicants.";
}

function generateFallbackTips(result: AnalysisResult): string[] {
  const tips: string[] = [];
  if (result.quantificationScore < 60) tips.push("Add numbers everywhere — team sizes, revenue impact, percentage improvements. Recruiters love measurable results.");
  if (result.keywordStrengthScore < 60) tips.push("Research job descriptions in your field and weave their exact keywords into your experience bullets.");
  if (result.structureScore < 70) tips.push("Restructure with clear sections: Summary → Experience → Skills → Education. ATS needs standard headers.");
  if (result.recruiterScanScore < 60) tips.push("Lead each bullet with a strong action verb (Delivered, Architected, Accelerated) instead of passive language.");
  if (tips.length === 0) {
    tips.push("Fine-tune your summary to highlight your unique value proposition in the first two lines.");
    tips.push("Consider adding relevant certifications or technical skills that match your target roles.");
  }
  return tips;
}
