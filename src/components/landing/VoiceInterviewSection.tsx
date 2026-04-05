import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Mic, Brain, BarChart3, ArrowRight, CheckCircle2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

const features = [
  "Role-specific questions for 10+ job profiles",
  "Speak your answers — AI listens and responds",
  "Real-time feedback on communication & confidence",
  "Performance scorecard with improvement tips",
  "Practice as many times as you need",
];

const roles = ["Software Engineer", "Data Analyst", "Product Manager", "DevOps Engineer", "Frontend Developer", "QA Engineer"];

function WaveBar({ delay, height }: { delay: number; height: number }) {
  return (
    <motion.div
      className="w-1.5 rounded-full bg-primary"
      style={{ height }}
      animate={{ scaleY: [1, 2.5, 1], opacity: [0.5, 1, 0.5] }}
      transition={{ duration: 1.2, repeat: Infinity, delay, ease: "easeInOut" }}
    />
  );
}

export function VoiceInterviewSection() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const handleStart = () => navigate(user ? "/voice-interview" : "/auth?redirect=/voice-interview");

  return (
    <section className="py-16 sm:py-20 px-4" id="ai-interview">
      <div className="container max-w-5xl">
        <div className="grid lg:grid-cols-2 gap-12 items-center">

          {/* Left — Content */}
          <motion.div initial={{ opacity: 0, x: -20 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }}>
            <Badge className="mb-4 bg-primary/10 text-primary border-primary/20 text-xs">
              <Mic className="h-3 w-3 mr-1" /> New — AI Voice Interview
            </Badge>
            <h2 className="text-2xl sm:text-3xl font-bold mb-4 leading-tight">
              Practice Interviews Out Loud,<br />
              <span className="gradient-text-new">Not Just in Your Head</span>
            </h2>
            <p className="text-muted-foreground text-sm mb-6 leading-relaxed">
              Most people prepare by reading. But interviews happen by speaking. HireResume's AI interviewer listens to your voice, asks follow-up questions, and scores your communication — just like a real recruiter.
            </p>

            <ul className="space-y-2.5 mb-8">
              {features.map((f, i) => (
                <motion.li
                  key={i}
                  className="flex items-center gap-2.5 text-sm"
                  initial={{ opacity: 0, x: -10 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.08 }}
                >
                  <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
                  <span>{f}</span>
                </motion.li>
              ))}
            </ul>

            <div className="flex flex-wrap gap-2 mb-8">
              {roles.map((r) => (
                <Badge key={r} variant="outline" className="text-xs">{r}</Badge>
              ))}
            </div>

            <div className="flex items-center gap-4">
              <Button onClick={handleStart} size="lg">
                <Mic className="h-4 w-4 mr-2" /> Start Practice Interview
                <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
              <p className="text-xs text-muted-foreground">₹599/session · Unlimited plan: 2 free/month</p>
            </div>
          </motion.div>

          {/* Right — Visual mockup */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
          >
            <div className="glass-neon rounded-2xl p-6 space-y-4">
              {/* AI message */}
              <div className="flex items-start gap-3">
                <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                  <Brain className="h-4 w-4 text-primary" />
                </div>
                <div className="bg-card border border-border rounded-2xl rounded-tl-sm px-4 py-3 text-sm max-w-[85%]">
                  Tell me about a project where you had to deal with a tight deadline. How did you handle it?
                </div>
              </div>

              {/* User voice response */}
              <div className="flex items-start gap-3 justify-end">
                <div className="bg-primary text-primary-foreground rounded-2xl rounded-tr-sm px-4 py-3 text-sm max-w-[85%]">
                  In my last internship, we had a 2-day sprint to deliver a feature for a product launch...
                </div>
                <div className="h-8 w-8 rounded-full bg-secondary flex items-center justify-center shrink-0">
                  <span className="text-xs font-bold">You</span>
                </div>
              </div>

              {/* Voice waveform indicator */}
              <div className="flex items-center justify-center gap-1.5 py-3">
                {[0.3, 0.6, 1, 0.8, 0.5, 0.9, 0.4, 0.7, 1, 0.6].map((h, i) => (
                  <WaveBar key={i} delay={i * 0.1} height={h * 28} />
                ))}
                <span className="text-xs text-muted-foreground ml-3">AI is listening...</span>
              </div>

              {/* Scores preview */}
              <div className="grid grid-cols-3 gap-3 pt-2 border-t border-border/40">
                {[
                  { icon: Mic, label: "Communication", score: 84 },
                  { icon: Brain, label: "Confidence", score: 78 },
                  { icon: BarChart3, label: "Depth", score: 91 },
                ].map((s, i) => (
                  <div key={i} className="text-center">
                    <p className="text-lg font-black text-primary">{s.score}</p>
                    <p className="text-[10px] text-muted-foreground">{s.label}</p>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
