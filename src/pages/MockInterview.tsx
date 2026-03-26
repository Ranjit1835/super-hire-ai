import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Zap, ArrowLeft, Mic, Send, Loader2, Bot, User, BarChart3 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { InterviewPayment } from "@/components/interview/InterviewPayment";
import { InterviewReport } from "@/components/interview/InterviewReport";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

type Phase = "setup" | "payment" | "chat" | "scoring" | "report";

interface Message {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

const ROLES = [
  "Java Developer", "Frontend Developer", "Backend Developer", "Full Stack Developer",
  "Data Analyst", "Data Scientist", "DevOps Engineer", "Cloud Engineer",
  "Product Manager", "QA Engineer", "Mobile Developer", "ML Engineer",
];

export default function MockInterview() {
  const { user, session } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [phase, setPhase] = useState<Phase>("setup");
  const [role, setRole] = useState("");
  const [experienceLevel, setExperienceLevel] = useState<"fresher" | "mid" | "senior">("fresher");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [scores, setScores] = useState<any>(null);
  const [canAccess, setCanAccess] = useState<boolean | null>(null);
  const [accessInfo, setAccessInfo] = useState<any>(null);
  const [checkingAccess, setCheckingAccess] = useState(true);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => { document.title = "AI Mock Interview – HireResume"; }, []);

  // Scroll to bottom on new message
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Check access on mount
  useEffect(() => {
    if (!user || !session) return;
    checkAccess();
  }, [user, session]);

  const callAPI = async (body: any) => {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/mock-interview`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${session?.access_token}`,
      },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || "Request failed");
    return data;
  };

  const checkAccess = async () => {
    setCheckingAccess(true);
    try {
      const data = await callAPI({ action: "check-access" });
      setCanAccess(data.canAccess);
      setAccessInfo(data);
    } catch {
      setCanAccess(false);
    } finally {
      setCheckingAccess(false);
    }
  };

  const startInterview = async () => {
    if (!role) {
      toast({ title: "Select a role", variant: "destructive" });
      return;
    }
    setSending(true);
    try {
      const data = await callAPI({ action: "start", role, experienceLevel });
      setSessionId(data.sessionId);
      setMessages([{ role: "assistant", content: data.message, timestamp: new Date().toISOString() }]);
      setPhase("chat");
    } catch (err: any) {
      toast({ title: "Failed to start", description: err.message, variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  const sendMessage = async () => {
    if (!input.trim() || sending) return;
    const userMsg: Message = { role: "user", content: input.trim(), timestamp: new Date().toISOString() };
    const updated = [...messages, userMsg];
    setMessages(updated);
    setInput("");
    setSending(true);

    try {
      const data = await callAPI({ action: "respond", sessionId, messages: updated });
      setMessages(prev => [...prev, { role: "assistant", content: data.message, timestamp: new Date().toISOString() }]);

      if (data.isComplete) {
        // Auto-score after a brief delay
        setTimeout(() => generateScore(), 1500);
      }
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  const generateScore = async () => {
    setPhase("scoring");
    try {
      const data = await callAPI({ action: "score", sessionId });
      setScores(data.scores);
      setPhase("report");
    } catch (err: any) {
      toast({ title: "Scoring failed", description: err.message, variant: "destructive" });
      setPhase("chat");
    }
  };

  const handlePaymentSuccess = () => {
    setCanAccess(true);
    setPhase("setup");
  };

  if (checkingAccess) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border glass-strong sticky top-0 z-50">
        <div className="container flex items-center justify-between h-14">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-lg bg-primary flex items-center justify-center">
              <Zap className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="font-bold text-foreground">HireResume</span>
            <Badge variant="secondary" className="text-xs">Interview</Badge>
          </div>
          <Button variant="ghost" size="sm" onClick={() => navigate("/dashboard")}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Dashboard
          </Button>
        </div>
      </header>

      <main className="container py-6 sm:py-8 px-4 max-w-3xl">
        {/* Setup phase */}
        {phase === "setup" && !canAccess && (
          <InterviewPayment
            accessInfo={accessInfo}
            userEmail={user?.email || ""}
            onPaymentSuccess={handlePaymentSuccess}
          />
        )}

        {phase === "setup" && canAccess && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
            <div className="text-center mb-8">
              <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
                <Mic className="h-8 w-8 text-primary" />
              </div>
              <h1 className="text-2xl sm:text-3xl font-bold mb-2">AI Mock Interview</h1>
              <p className="text-muted-foreground text-sm">Practice real interview questions with AI simulation</p>
              {accessInfo?.isEarlyBird && (
                <Badge className="mt-2 bg-primary/20 text-primary border-primary/30">
                  Early Bird: {accessInfo.monthlyLimit - accessInfo.monthlyCount} interviews left this month
                </Badge>
              )}
            </div>

            <Card className="max-w-md mx-auto">
              <CardContent className="py-6 space-y-4">
                <div>
                  <label className="text-sm font-medium mb-1.5 block">Select Role</label>
                  <Select value={role} onValueChange={setRole}>
                    <SelectTrigger><SelectValue placeholder="Choose a role..." /></SelectTrigger>
                    <SelectContent>
                      {ROLES.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-sm font-medium mb-1.5 block">Experience Level</label>
                  <Select value={experienceLevel} onValueChange={(v: any) => setExperienceLevel(v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="fresher">Fresher (0-1 yrs)</SelectItem>
                      <SelectItem value="mid">Mid-Level (2-5 yrs)</SelectItem>
                      <SelectItem value="senior">Senior (5+ yrs)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button onClick={startInterview} disabled={sending || !role} className="w-full">
                  {sending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Mic className="h-4 w-4 mr-1" />}
                  {sending ? "Starting..." : "Start Interview"}
                </Button>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {/* Chat phase */}
        {phase === "chat" && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col h-[calc(100vh-8rem)]">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="font-bold text-lg">{role} Interview</h2>
                <p className="text-xs text-muted-foreground capitalize">{experienceLevel} level</p>
              </div>
              <Button variant="outline" size="sm" onClick={generateScore}>
                <BarChart3 className="h-4 w-4 mr-1" /> End & Score
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-3 mb-4 pr-1">
              <AnimatePresence>
                {messages.map((msg, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`flex gap-2 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    {msg.role === "assistant" && (
                      <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-1">
                        <Bot className="h-4 w-4 text-primary" />
                      </div>
                    )}
                    <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${
                      msg.role === "user"
                        ? "bg-primary text-primary-foreground rounded-br-sm"
                        : "bg-secondary text-secondary-foreground rounded-bl-sm"
                    }`}>
                      {msg.content}
                    </div>
                    {msg.role === "user" && (
                      <div className="h-8 w-8 rounded-full bg-secondary flex items-center justify-center shrink-0 mt-1">
                        <User className="h-4 w-4 text-muted-foreground" />
                      </div>
                    )}
                  </motion.div>
                ))}
              </AnimatePresence>
              {sending && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-2">
                  <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                    <Bot className="h-4 w-4 text-primary" />
                  </div>
                  <div className="bg-secondary rounded-2xl rounded-bl-sm px-4 py-3">
                    <div className="flex gap-1">
                      <span className="h-2 w-2 bg-muted-foreground/40 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                      <span className="h-2 w-2 bg-muted-foreground/40 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                      <span className="h-2 w-2 bg-muted-foreground/40 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                    </div>
                  </div>
                </motion.div>
              )}
              <div ref={chatEndRef} />
            </div>

            <div className="flex gap-2">
              <Input
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && !e.shiftKey && sendMessage()}
                placeholder="Type your answer..."
                disabled={sending}
                className="flex-1"
              />
              <Button onClick={sendMessage} disabled={sending || !input.trim()} size="icon">
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </motion.div>
        )}

        {/* Scoring phase */}
        {phase === "scoring" && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-20">
            <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto mb-4" />
            <h2 className="text-xl font-bold mb-2">Analyzing Your Interview</h2>
            <p className="text-muted-foreground text-sm">AI is evaluating your responses...</p>
            <Progress value={66} className="max-w-xs mx-auto mt-6" />
          </motion.div>
        )}

        {/* Report phase */}
        {phase === "report" && scores && (
          <InterviewReport scores={scores} role={role} experienceLevel={experienceLevel} />
        )}
      </main>
    </div>
  );
}
