import { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Zap, ArrowLeft, Mic, MicOff, Send, Loader2, Bot, User, BarChart3 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { InterviewPayment } from "@/components/interview/InterviewPayment";
import { InterviewReport } from "@/components/interview/InterviewReport";
import { useSpeech } from "@/hooks/useSpeech";
import { VoiceWaveform } from "@/components/interview/VoiceWaveform";
import { AnimatedGradientMesh } from "@/components/premium";
import { SEOHead } from "@/components/SEOHead";

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
  const { isVoiceMode, toggleVoiceMode, isSpeaking, isListening, transcript, speak, startListening, isSupported } = useSpeech();

  useEffect(() => { document.title = "AI Mock Interview – HireResume"; }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (!user || !session?.access_token) return;
    checkAccess();
  }, [user?.id, session?.access_token]);

  const callAPI = useCallback(async (body: any) => {
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
  }, [session]);

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
      if (isVoiceMode) {
        speak(data.message, () => startListening());
      }
    } catch (err: any) {
      toast({ title: "Failed to start", description: err.message, variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  useEffect(() => {
    if (isVoiceMode && !isListening && transcript.trim() && phase === "chat" && !sending) {
      sendVoiceMessage(transcript.trim());
    }
  }, [isListening, isVoiceMode, transcript, phase, sending]);

  const sendVoiceMessage = async (text: string) => {
    if (!text || sending) return;
    const userMsg: Message = { role: "user", content: text, timestamp: new Date().toISOString() };
    const updated = [...messages, userMsg];
    setMessages(updated);
    setSending(true);

    try {
      const data = await callAPI({ action: "respond", sessionId, messages: updated });
      setMessages(prev => [...prev, { role: "assistant", content: data.message, timestamp: new Date().toISOString() }]);
      if (data.isComplete) {
        setTimeout(() => generateScore(), 1500);
      } else if (isVoiceMode) {
        speak(data.message, () => startListening());
      }
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
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
        setTimeout(() => generateScore(), 1500);
      } else if (isVoiceMode) {
        speak(data.message, () => startListening());
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
      <div className="min-h-screen bg-background flex items-center justify-center relative">
        <AnimatedGradientMesh />
        <Loader2 className="h-8 w-8 animate-spin text-violet-400" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background relative">
      <SEOHead
        title="AI Mock Interview Practice - Get Interview Ready | HireResume"
        description="Practice job interviews with AI. Get role-specific questions, real-time feedback, and performance scores. Prepare for technical and behavioral interviews online."
        path="/mock-interview"
        keywords="AI mock interview, practice interview online, interview preparation, behavioral interview practice, technical interview simulator"
        breadcrumbs={[{ name: "Home", path: "/" }, { name: "AI Mock Interview", path: "/mock-interview" }]}
      />
      <AnimatedGradientMesh />

      <header className="border-b border-violet-500/10 glass-strong sticky top-0 z-50 relative">
        <div className="container flex items-center justify-between h-14">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-violet-600 to-cyan-600 flex items-center justify-center shadow-lg shadow-violet-500/20">
              <Zap className="h-4 w-4 text-white" />
            </div>
            <span className="font-bold text-foreground">HireResume</span>
            <Badge className="text-xs bg-violet-500/10 text-violet-300 border-violet-500/20">Interview</Badge>
          </div>
          <button onClick={() => navigate("/dashboard")} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="h-4 w-4" /> Dashboard
          </button>
        </div>
      </header>

      <main className="container py-6 sm:py-8 px-4 max-w-3xl relative z-10">
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
              <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-violet-600/20 to-cyan-600/20 border border-violet-500/20 flex items-center justify-center mx-auto mb-4">
                <Mic className="h-8 w-8 text-violet-400" />
              </div>
              <h1 className="text-2xl sm:text-3xl font-bold mb-2 gradient-text-new">AI Mock Interview</h1>
              <p className="text-muted-foreground text-sm">Practice real interview questions with AI simulation</p>
              {accessInfo?.isEarlyBird && (
                <Badge className="mt-2 bg-violet-500/15 text-violet-300 border-violet-500/25">
                  Early Bird: {accessInfo.monthlyLimit - accessInfo.monthlyCount} interviews left this month
                </Badge>
              )}
            </div>

            {/* Voice Interview CTA */}
            <div className="max-w-md mx-auto mb-4">
              <motion.button
                whileHover={{ y: -2, scale: 1.01 }}
                whileTap={{ scale: 0.99 }}
                onClick={() => navigate("/voice-interview")}
                className="w-full rounded-xl border border-violet-500/20 glass card-hover-glow transition-all p-4 text-left flex items-center gap-4 group"
              >
                <div className="h-12 w-12 rounded-full bg-gradient-to-br from-violet-600/20 to-cyan-600/20 border border-violet-500/30 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                  <Mic className="h-6 w-6 text-violet-400" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="font-semibold text-sm text-foreground">Voice-to-Voice Interview</span>
                    <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/25 text-xs">New</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">Speak naturally with AI. No typing — just talk like a real interview.</p>
                </div>
              </motion.button>
            </div>

            <div className="flex items-center gap-3 max-w-md mx-auto mb-4">
              <div className="flex-1 h-px bg-gradient-to-r from-transparent via-violet-500/20 to-transparent" />
              <span className="text-xs text-muted-foreground">or text-based interview</span>
              <div className="flex-1 h-px bg-gradient-to-r from-transparent via-violet-500/20 to-transparent" />
            </div>

            <div className="glass rounded-2xl border border-violet-500/15 max-w-md mx-auto">
              <div className="p-6 space-y-4">
                <div>
                  <label className="text-sm font-medium mb-1.5 block text-foreground">Select Role</label>
                  <Select value={role} onValueChange={setRole}>
                    <SelectTrigger className="bg-white/5 border-violet-500/15"><SelectValue placeholder="Choose a role..." /></SelectTrigger>
                    <SelectContent>
                      {ROLES.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-sm font-medium mb-1.5 block text-foreground">Experience Level</label>
                  <Select value={experienceLevel} onValueChange={(v: any) => setExperienceLevel(v)}>
                    <SelectTrigger className="bg-white/5 border-violet-500/15"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="fresher">Fresher (0-1 yrs)</SelectItem>
                      <SelectItem value="mid">Mid-Level (2-5 yrs)</SelectItem>
                      <SelectItem value="senior">Senior (5+ yrs)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <motion.button
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.99 }}
                  onClick={startInterview}
                  disabled={sending || !role}
                  className="w-full h-11 rounded-lg text-sm font-semibold bg-gradient-to-r from-violet-600 to-cyan-600 text-white hover:shadow-lg hover:shadow-violet-500/25 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mic className="h-4 w-4" />}
                  {sending ? "Starting..." : "Start Interview"}
                </motion.button>
              </div>
            </div>
          </motion.div>
        )}

        {/* Chat phase */}
        {phase === "chat" && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col h-[calc(100vh-8rem)]">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="font-bold text-lg text-foreground">{role} Interview</h2>
                <p className="text-xs text-muted-foreground capitalize">{experienceLevel} level</p>
              </div>
              <div className="flex items-center gap-2">
                {isSupported && (
                  <button
                    onClick={toggleVoiceMode}
                    className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                      isVoiceMode
                        ? "bg-gradient-to-r from-violet-600 to-cyan-600 text-white"
                        : "glass border border-violet-500/15 text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {isVoiceMode ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
                    {isVoiceMode ? "Voice On" : "Voice"}
                  </button>
                )}
                <button
                  onClick={generateScore}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium glass border border-violet-500/15 text-muted-foreground hover:text-foreground transition-all"
                >
                  <BarChart3 className="h-3.5 w-3.5" /> End & Score
                </button>
              </div>
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
                      <div className="h-8 w-8 rounded-full bg-gradient-to-br from-violet-600/20 to-cyan-600/20 border border-violet-500/20 flex items-center justify-center shrink-0 mt-1">
                        <Bot className="h-4 w-4 text-violet-400" />
                      </div>
                    )}
                    <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${
                      msg.role === "user"
                        ? "bg-gradient-to-r from-violet-600 to-cyan-600 text-white rounded-br-sm"
                        : "glass border border-violet-500/10 text-foreground rounded-bl-sm"
                    }`}>
                      {msg.content}
                    </div>
                    {msg.role === "user" && (
                      <div className="h-8 w-8 rounded-full bg-white/5 border border-violet-500/10 flex items-center justify-center shrink-0 mt-1">
                        <User className="h-4 w-4 text-muted-foreground" />
                      </div>
                    )}
                  </motion.div>
                ))}
              </AnimatePresence>
              {sending && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-2">
                  <div className="h-8 w-8 rounded-full bg-gradient-to-br from-violet-600/20 to-cyan-600/20 border border-violet-500/20 flex items-center justify-center shrink-0">
                    <Bot className="h-4 w-4 text-violet-400" />
                  </div>
                  <div className="glass border border-violet-500/10 rounded-2xl rounded-bl-sm px-4 py-3">
                    <div className="flex gap-1">
                      <span className="h-2 w-2 bg-violet-400/40 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                      <span className="h-2 w-2 bg-violet-400/40 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                      <span className="h-2 w-2 bg-violet-400/40 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                    </div>
                  </div>
                </motion.div>
              )}
              <div ref={chatEndRef} />
            </div>

            {isVoiceMode ? (
              <div className="flex flex-col items-center gap-3 py-2">
                <VoiceWaveform isActive={isListening || isSpeaking} label={isSpeaking ? "AI is speaking..." : isListening ? "Listening..." : sending ? "Processing..." : "Tap mic to respond"} />
                {!isListening && !isSpeaking && !sending && (
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={startListening}
                    className="px-4 py-2 rounded-lg text-sm font-semibold bg-gradient-to-r from-violet-600 to-cyan-600 text-white hover:shadow-lg hover:shadow-violet-500/25 transition-all flex items-center gap-1.5"
                  >
                    <Mic className="h-4 w-4" /> Tap to Speak
                  </motion.button>
                )}
                {transcript && (
                  <p className="text-xs text-muted-foreground italic">"{transcript}"</p>
                )}
              </div>
            ) : (
              <div className="flex gap-2">
                <Input
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && !e.shiftKey && sendMessage()}
                  placeholder="Type your answer..."
                  disabled={sending}
                  className="flex-1 bg-white/5 border-violet-500/15 focus:border-violet-500/40"
                />
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={sendMessage}
                  disabled={sending || !input.trim()}
                  className="h-10 w-10 rounded-lg bg-gradient-to-r from-violet-600 to-cyan-600 text-white flex items-center justify-center disabled:opacity-50"
                >
                  <Send className="h-4 w-4" />
                </motion.button>
              </div>
            )}
          </motion.div>
        )}

        {/* Scoring phase */}
        {phase === "scoring" && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-20">
            <Loader2 className="h-12 w-12 animate-spin text-violet-400 mx-auto mb-4" />
            <h2 className="text-xl font-bold mb-2 text-foreground">Analyzing Your Interview</h2>
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
