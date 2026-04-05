import { memo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { CheckCircle2, AlertTriangle, Lightbulb, BarChart3 } from "lucide-react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";

interface Props {
  scores: {
    communication: number;
    confidence: number;
    technicalDepth: number;
    clarity: number;
    overallScore: number;
    strengths: string[];
    weakAreas: string[];
    suggestions: string[];
  };
  role: string;
  experienceLevel: string;
}

function ScoreBar({ label, value, delay }: { label: string; value: number; delay: number }) {
  const color = value >= 75 ? "bg-green-500" : value >= 50 ? "bg-yellow-500" : "bg-red-500";
  return (
    <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay }}>
      <div className="flex justify-between mb-1">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-sm font-bold">{value}/100</span>
      </div>
      <div className="h-2.5 bg-secondary rounded-full overflow-hidden">
        <motion.div
          className={`h-full rounded-full ${color}`}
          initial={{ width: 0 }}
          animate={{ width: `${value}%` }}
          transition={{ duration: 1, delay: delay + 0.2 }}
        />
      </div>
    </motion.div>
  );
}

export const InterviewReport = memo(function InterviewReport({ scores, role, experienceLevel }: Props) {
  const navigate = useNavigate();

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
      <div className="text-center mb-6">
        <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", delay: 0.2 }}>
          <div className="h-20 w-20 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-3">
            <BarChart3 className="h-10 w-10 text-primary" />
          </div>
        </motion.div>
        <h1 className="text-2xl font-bold mb-1">Interview Report</h1>
        <p className="text-sm text-muted-foreground">{role} · <span className="capitalize">{experienceLevel}</span> Level</p>
      </div>

      {/* Overall Score */}
      <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.3 }}>
        <Card className="border-2 border-primary/20 bg-primary/5">
          <CardContent className="py-6 text-center">
            <p className="text-sm text-muted-foreground mb-1">Overall Score</p>
            <motion.p
              className="text-5xl font-black text-primary"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5 }}
            >
              {scores.overallScore}
            </motion.p>
            <p className="text-sm text-muted-foreground mt-1">out of 100</p>
          </CardContent>
        </Card>
      </motion.div>

      {/* Score Breakdown */}
      <Card>
        <CardContent className="py-6 space-y-4">
          <h3 className="font-bold text-sm mb-3">Score Breakdown</h3>
          <ScoreBar label="Communication" value={scores.communication} delay={0.4} />
          <ScoreBar label="Confidence" value={scores.confidence} delay={0.5} />
          <ScoreBar label="Technical Depth" value={scores.technicalDepth} delay={0.6} />
          <ScoreBar label="Clarity" value={scores.clarity} delay={0.7} />
        </CardContent>
      </Card>

      {/* Strengths */}
      {scores.strengths.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.8 }}>
          <Card>
            <CardContent className="py-5">
              <div className="flex items-center gap-2 mb-3">
                <CheckCircle2 className="h-5 w-5 text-green-500" />
                <h3 className="font-bold text-sm">Strengths</h3>
              </div>
              <ul className="space-y-1.5">
                {scores.strengths.map((s, i) => (
                  <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                    <span className="text-green-500 mt-0.5">✓</span> {s}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* Weak Areas */}
      {scores.weakAreas.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.9 }}>
          <Card>
            <CardContent className="py-5">
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle className="h-5 w-5 text-yellow-500" />
                <h3 className="font-bold text-sm">Areas to Improve</h3>
              </div>
              <ul className="space-y-1.5">
                {scores.weakAreas.map((w, i) => (
                  <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                    <span className="text-yellow-500 mt-0.5">⚠</span> {w}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* Suggestions */}
      {scores.suggestions.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.0 }}>
          <Card>
            <CardContent className="py-5">
              <div className="flex items-center gap-2 mb-3">
                <Lightbulb className="h-5 w-5 text-primary" />
                <h3 className="font-bold text-sm">Suggestions</h3>
              </div>
              <ul className="space-y-1.5">
                {scores.suggestions.map((s, i) => (
                  <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                    <span className="text-primary mt-0.5">💡</span> {s}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </motion.div>
      )}

      <div className="flex gap-3 justify-center pt-4">
        <Button variant="outline" onClick={() => navigate("/dashboard")}>
          Back to Dashboard
        </Button>
        <Button onClick={() => window.location.reload()}>
          Practice Again
        </Button>
      </div>
    </motion.div>
  );
});
