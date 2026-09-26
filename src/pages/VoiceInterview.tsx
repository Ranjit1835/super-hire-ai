import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { motion, AnimatePresence } from "framer-motion";
import {
  Mic, MicOff, ArrowLeft, PhoneOff, BarChart3, Loader2, Volume2, AlertTriangle,
} from "lucide-react";
import { AudioCheck } from "@/components/interview/AudioCheck";
import {
  getRecognitionCtor, micHelp, micProblemFromRecognition, primeSpeech, speakText, stopSpeaking, NO_VOICES_HELP,
  type MicProblem, type SpeakHandle,
} from "@/lib/speech";
import { InterviewReport } from "@/components/interview/InterviewReport";
import { InterviewPayment } from "@/components/interview/InterviewPayment";
import { AnimatedGradientMesh } from "@/components/premium";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const ROLES = [
  "Java Developer", "Frontend Developer", "Backend Developer", "Full Stack Developer",
  "Data Analyst", "Data Scientist", "DevOps Engineer", "Cloud Engineer",
  "Product Manager", "QA Engineer", "Mobile Developer", "ML Engineer",
];

type Phase = "setup" | "payment" | "interviewing" | "scoring" | "report";
type VoiceState = "idle" | "ai-speaking" | "listening" | "processing";

interface Message { role: "user" | "assistant"; content: string; timestamp: string; }

export default function VoiceInterview() {
  const { user, session } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [phase, setPhase] = useState<Phase>("setup");
  const [role, setRole] = useState("");
  const [experienceLevel, setExperienceLevel] = useState<"fresher" | "mid" | "senior">("fresher");
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [currentQuestion, setCurrentQuestion] = useState("");
  const [liveTranscript, setLiveTranscript] = useState("");
  const [questionNumber, setQuestionNumber] = useState(0);
  const [scores, setScores] = useState<any>(null);
  const [canAccess, setCanAccess] = useState<boolean | null>(null);
  const [accessInfo, setAccessInfo] = useState<any>(null);
  const [checkingAccess, setCheckingAccess] = useState(true);
  const [starting, setStarting] = useState(false);
  // Why audio or the mic isn't working, shown on screen instead of failing silently.
  const [audioIssue, setAudioIssue] = useState<null | "blocked" | "error" | "unsupported" | "no-voices">(null);
  const [micIssue, setMicIssue] = useState<MicProblem | null>(null);

  const recognitionRef = useRef<any>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finalTranscriptRef = useRef("");
  const messagesRef = useRef<Message[]>([]);
  const sessionIdRef = useRef<string | null>(null);
  const stoppedRef = useRef(false);
  const retryCountRef = useRef(0);
  const speakRef = useRef<SpeakHandle | null>(null);
  const pendingListenRef = useRef(true);
  const startListeningRef = useRef<() => void>(() => {});
  const submitAnswerRef = useRef<(text: string) => void>(() => {});
  const MAX_RETRIES = 2;
  messagesRef.current = messages;

  useEffect(() => { document.title = "Voice Interview – HiResume"; }, []);

  useEffect(() => {
    return () => {
      stoppedRef.current = true;
      speakRef.current?.cancel();
      stopSpeaking();
      try { recognitionRef.current?.abort(); } catch (_) {}
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!user || !session?.access_token) return;
    callAPI({ action: "check-access" })
      .then(data => { setCanAccess(data.canAccess); setAccessInfo(data); })
      .catch(() => setCanAccess(false))
      .finally(() => setCheckingAccess(false));
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

  /**
   * Speak a question, then (optionally) start listening. If the browser blocks audio, show
   * "Tap to hear the question" instead of silently moving on. `after` runs once speech ends.
   */
  const speakAndListen = useCallback((text: string, autoListen = true, after?: () => void) => {
    speakRef.current?.cancel();
    setAudioIssue(null);
    setVoiceState("ai-speaking");
    setCurrentQuestion(text);
    pendingListenRef.current = autoListen;
    const handle = speakText(text, { rate: 0.95 });
    speakRef.current = handle;
    void handle.done.then((outcome) => {
      if (speakRef.current !== handle || stoppedRef.current || outcome === "cancelled") return;
      if (after) { setVoiceState("idle"); after(); return; }
      if (outcome === "blocked" || outcome === "error" || outcome === "unsupported" || outcome === "no-voices") {
        setAudioIssue(outcome);
        setVoiceState("idle");
        return;
      }
      if (autoListen) startListeningRef.current();
      else setVoiceState("idle");
    });
  }, []);

  /** From a tap: replays the question (the tap unlocks audio on mobile). */
  const replayQuestion = () => {
    primeSpeech();
    if (currentQuestion) speakAndListen(currentQuestion, pendingListenRef.current);
  };

  const startListening = useCallback(() => {
    const SpeechRecognition = getRecognitionCtor() as any;
    if (!SpeechRecognition) { setMicIssue("unsupported"); setVoiceState("idle"); return; }
    setAudioIssue(null);

    finalTranscriptRef.current = "";
    setLiveTranscript("");
    setVoiceState("listening");

    const recognition = new SpeechRecognition();
    // A mic failure also fires onend; don't treat that as "no answer" and re-prompt into a blocked mic.
    let failed = false;
    recognition.lang = "en-US";
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (e: any) => {
      let interim = "";
      let final = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) {
          final += e.results[i][0].transcript + " ";
        } else {
          interim += e.results[i][0].transcript;
        }
      }
      if (final) finalTranscriptRef.current += final;
      setLiveTranscript((finalTranscriptRef.current + interim).trim());

      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = setTimeout(() => {
        recognition.stop();
      }, 2500);
    };

    recognition.onend = () => {
      if (stoppedRef.current || failed) return;
      setVoiceState("processing");
      const text = finalTranscriptRef.current.trim();
      if (text) {
        retryCountRef.current = 0;
        submitAnswerRef.current(text);
      } else if (retryCountRef.current < MAX_RETRIES) {
        retryCountRef.current++;
        speakAndListen("I didn't catch that. Could you please repeat your answer?");
      } else {
        retryCountRef.current = 0;
        setVoiceState("idle");
        toast({ title: "Microphone issue", description: "Tap the mic button when you're ready to speak.", variant: "destructive" });
      }
    };

    recognition.onstart = () => setMicIssue(null);
    recognition.onerror = (e: any) => {
      if (stoppedRef.current) return;
      const problem = micProblemFromRecognition(e.error);
      if (problem) {
        failed = true;
        setMicIssue(problem);
        setVoiceState("idle");
      }
      // no-speech and aborted are handled by onend
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      // Some mobile browsers only allow starting recognition from a tap: show "Tap to answer".
      setVoiceState("idle");
    }
  }, []);
  startListeningRef.current = startListening;

  const submitAnswer = useCallback(async (text: string) => {
    const userMsg: Message = { role: "user", content: text, timestamp: new Date().toISOString() };
    const updated = [...messagesRef.current, userMsg];
    setMessages(updated);
    setLiveTranscript("");

    try {
      const data = await callAPI({ action: "respond", sessionId: sessionIdRef.current, messages: updated });
      const aiMsg: Message = { role: "assistant", content: data.message, timestamp: new Date().toISOString() };
      setMessages(prev => [...prev, aiMsg]);
      setQuestionNumber(q => q + 1);

      if (data.isComplete) {
        // Previously scoring started after a fixed 3 s and cut the closing message off.
        speakAndListen(data.message, false, () => generateScore());
      } else {
        speakAndListen(data.message, true);
      }
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
      setVoiceState("idle");
    }
  }, [callAPI]);
  submitAnswerRef.current = submitAnswer;

  const startInterview = async () => {
    if (!role) { toast({ title: "Select a role", variant: "destructive" }); return; }
    // Must run synchronously in the tap: the first question arrives after a long AI call, by
    // which time mobile browsers no longer treat speech as user-initiated and block it.
    primeSpeech();
    setStarting(true);
    stoppedRef.current = false;
    retryCountRef.current = 0;
    try {
      const data = await callAPI({ action: "start", role, experienceLevel });
      setSessionId(data.sessionId);
      sessionIdRef.current = data.sessionId;
      const aiMsg: Message = { role: "assistant", content: data.message, timestamp: new Date().toISOString() };
      setMessages([aiMsg]);
      setQuestionNumber(1);
      setPhase("interviewing");
      setTimeout(() => speakAndListen(data.message, true), 600);
    } catch (err: any) {
      toast({ title: "Failed to start", description: err.message, variant: "destructive" });
    } finally {
      setStarting(false);
    }
  };

  const generateScore = async () => {
    speakRef.current?.cancel();
    stopSpeaking();
    recognitionRef.current?.abort();
    setPhase("scoring");
    try {
      const data = await callAPI({ action: "score", sessionId: sessionIdRef.current });
      setScores(data.scores);
      setPhase("report");
    } catch (err: any) {
      toast({ title: "Scoring failed", description: err.message, variant: "destructive" });
      setPhase("interviewing");
    }
  };

  const endInterview = () => {
    stoppedRef.current = true;
    speakRef.current?.cancel();
    stopSpeaking();
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    try { recognitionRef.current?.abort(); } catch (_) {}
    recognitionRef.current = null;
    if (messages.length >= 2) generateScore();
    else navigate("/dashboard");
  };

  if (checkingAccess) return (
    <div className="min-h-screen bg-background flex items-center justify-center relative">
      <AnimatedGradientMesh />
      <Loader2 className="h-8 w-8 animate-spin text-violet-400" />
    </div>
  );

  return (
    <div className="min-h-screen bg-background relative">
      <AnimatedGradientMesh />

      <header className="border-b border-violet-500/10 glass-strong sticky top-0 z-50 relative">
        <div className="container flex items-center justify-between h-14">
          <div className="flex items-center gap-2">
            <img src="/logo.svg" alt="HiResume" className="h-7 w-7 rounded-lg" />
            <span className="font-bold text-foreground">HiResume</span>
            <Badge className="text-xs bg-violet-500/10 text-violet-300 border-violet-500/20">Voice Interview</Badge>
          </div>
          <button onClick={() => navigate("/mock-interview")} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
        </div>
      </header>

      <main className="container py-8 px-4 max-w-2xl relative z-10">
        {!canAccess && phase !== "report" && (
          <InterviewPayment
            accessInfo={accessInfo}
            userEmail={user?.email || ""}
            onPaymentSuccess={() => { setCanAccess(true); setPhase("setup"); }}
          />
        )}

        {canAccess && phase === "setup" && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center">
            <div className="mb-8">
              <div className="h-24 w-24 rounded-full bg-gradient-to-br from-violet-600/15 to-cyan-600/15 border-2 border-violet-500/30 flex items-center justify-center mx-auto mb-6 relative">
                <Mic className="h-10 w-10 text-violet-400" />
                <span className="absolute -top-1 -right-1 h-4 w-4 bg-emerald-400 rounded-full border-2 border-background" />
              </div>
              <h1 className="text-3xl font-bold mb-2 gradient-text-new">Voice Interview</h1>
              <p className="text-muted-foreground">Speak naturally — just like a real interview. AI listens, responds, and evaluates your answers.</p>
            </div>

            <div className="glass rounded-2xl border border-violet-500/15 max-w-sm mx-auto">
              <div className="p-6 space-y-4">
                <div>
                  <label className="text-sm font-medium mb-1.5 block text-foreground">Target Role</label>
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
                <AudioCheck />
                <div className="glass-subtle rounded-lg p-3 text-xs text-muted-foreground space-y-1 border border-violet-500/10">
                  <p>Find a quiet place; headphones with a mic work best</p>
                  <p>Interview takes 10-15 minutes</p>
                </div>
                <motion.button
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.99 }}
                  onClick={startInterview}
                  disabled={starting || !role}
                  className="w-full h-12 rounded-lg text-sm font-semibold bg-gradient-to-r from-violet-600 to-cyan-600 text-white hover:shadow-lg hover:shadow-violet-500/25 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mic className="h-4 w-4" />}
                  {starting ? "Starting..." : "Start Voice Interview"}
                </motion.button>
              </div>
            </div>
          </motion.div>
        )}

        {/* Main Interview UI */}
        {canAccess && phase === "interviewing" && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center gap-6">
            <div className="w-full">
              <div className="flex justify-between text-xs text-muted-foreground mb-1">
                <span>{role} · {experienceLevel}</span>
                <span>Question {questionNumber}</span>
              </div>
              <Progress value={Math.min((questionNumber / 8) * 100, 100)} className="h-1.5" />
            </div>

            {/* AI Avatar */}
            <div className="relative flex items-center justify-center my-4">
              {voiceState === "ai-speaking" && (
                <>
                  <motion.div
                    className="absolute rounded-full border border-violet-500/20"
                    animate={{ scale: [1, 1.8], opacity: [0.5, 0] }}
                    transition={{ duration: 1.5, repeat: Infinity, ease: "easeOut" }}
                    style={{ width: 140, height: 140 }}
                  />
                  <motion.div
                    className="absolute rounded-full border border-violet-500/15"
                    animate={{ scale: [1, 2.2], opacity: [0.4, 0] }}
                    transition={{ duration: 1.5, repeat: Infinity, ease: "easeOut", delay: 0.4 }}
                    style={{ width: 140, height: 140 }}
                  />
                </>
              )}
              {voiceState === "listening" && (
                <motion.div
                  className="absolute rounded-full border border-emerald-500/30"
                  animate={{ scale: [1, 1.6], opacity: [0.6, 0] }}
                  transition={{ duration: 1, repeat: Infinity, ease: "easeOut" }}
                  style={{ width: 140, height: 140 }}
                />
              )}

              <motion.div
                className={`h-36 w-36 rounded-full flex items-center justify-center relative z-10 border-2 transition-colors duration-500 ${
                  voiceState === "ai-speaking"
                    ? "bg-violet-500/10 border-violet-500/60"
                    : voiceState === "listening"
                    ? "bg-emerald-500/10 border-emerald-500/60"
                    : voiceState === "processing"
                    ? "bg-amber-500/10 border-amber-500/40"
                    : "glass border-violet-500/15"
                }`}
                animate={voiceState === "ai-speaking" ? { scale: [1, 1.04, 1] } : {}}
                transition={{ duration: 0.6, repeat: Infinity }}
              >
                {voiceState === "ai-speaking" && (
                  <div className="flex gap-1 items-end h-10">
                    {[0.3, 0.7, 1, 0.5, 0.8, 0.4, 0.9].map((h, i) => (
                      <motion.div
                        key={i}
                        className="w-1.5 bg-violet-400 rounded-full"
                        animate={{ scaleY: [h, h * 0.3, h] }}
                        transition={{ duration: 0.5 + i * 0.07, repeat: Infinity, ease: "easeInOut" }}
                        style={{ height: `${h * 40}px`, originY: 1 }}
                      />
                    ))}
                  </div>
                )}
                {voiceState === "listening" && (
                  <div className="flex gap-1 items-end h-10">
                    {[0.5, 0.8, 1, 0.6, 0.9, 0.4, 0.7].map((h, i) => (
                      <motion.div
                        key={i}
                        className="w-1.5 bg-emerald-400 rounded-full"
                        animate={{ scaleY: [h * 0.4, h, h * 0.4] }}
                        transition={{ duration: 0.4 + i * 0.06, repeat: Infinity, ease: "easeInOut" }}
                        style={{ height: `${h * 40}px`, originY: 1 }}
                      />
                    ))}
                  </div>
                )}
                {voiceState === "processing" && (
                  <Loader2 className="h-10 w-10 text-amber-400 animate-spin" />
                )}
                {voiceState === "idle" && (
                  <Mic className="h-10 w-10 text-muted-foreground" />
                )}
              </motion.div>
            </div>

            {/* Status label */}
            <AnimatePresence mode="wait">
              <motion.div
                key={voiceState}
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -5 }}
                className="text-center"
              >
                {voiceState === "ai-speaking" && (
                  <p className="text-sm font-medium text-violet-400">AI Interviewer is speaking...</p>
                )}
                {voiceState === "listening" && (
                  <p className="text-sm font-medium text-emerald-400">Listening to your answer...</p>
                )}
                {voiceState === "processing" && (
                  <p className="text-sm font-medium text-amber-400">Processing your response...</p>
                )}
                {voiceState === "idle" && (
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={startListening}
                    className="px-4 py-2 rounded-lg text-sm font-semibold bg-gradient-to-r from-violet-600 to-cyan-600 text-white hover:shadow-lg hover:shadow-violet-500/25 transition-all flex items-center gap-1.5"
                  >
                    <Mic className="h-4 w-4" /> Tap to Speak
                  </motion.button>
                )}
              </motion.div>
            </AnimatePresence>

            {audioIssue && (
              <div role="alert" className="w-full rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 space-y-3">
                <p className="text-sm flex gap-2 text-amber-100">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-300" />
                  {audioIssue === "blocked"
                    ? "Your browser blocked the interviewer's voice. Tap below to enable audio."
                    : audioIssue === "unsupported"
                      ? "This browser can't read questions aloud. Read the question below, then answer."
                      : audioIssue === "no-voices"
                        ? NO_VOICES_HELP
                      : "The interviewer's voice couldn't play. Tap to try again, or read the question below."}
                </p>
                <div className="flex flex-wrap gap-2">
                  {audioIssue !== "unsupported" && audioIssue !== "no-voices" && (
                    <button type="button" onClick={replayQuestion} className="px-3 py-2 rounded-lg text-sm font-semibold bg-gradient-to-r from-violet-600 to-cyan-600 text-white inline-flex items-center gap-1.5">
                      <Volume2 className="h-4 w-4" /> Tap to enable audio
                    </button>
                  )}
                  <button type="button" onClick={() => { setAudioIssue(null); startListening(); }} className="px-3 py-2 rounded-lg text-sm font-medium border border-violet-500/30 text-foreground">
                    <Mic className="h-4 w-4 inline mr-1" /> Answer without audio
                  </button>
                </div>
              </div>
            )}

            {micIssue && (
              <div role="alert" className="w-full rounded-xl border border-red-500/30 bg-red-500/10 p-4">
                <p className="text-sm font-medium text-red-200 flex gap-2"><MicOff className="h-4 w-4 shrink-0 mt-0.5" /> {micHelp(micIssue).title}</p>
                <p className="text-xs text-muted-foreground mt-1">{micHelp(micIssue).steps}</p>
              </div>
            )}

            {currentQuestion && (
              <div className="glass rounded-xl border border-violet-500/15 w-full p-4">
                <p className="text-xs text-muted-foreground mb-1 font-medium uppercase tracking-wide">AI Interviewer</p>
                <p className="text-sm leading-relaxed text-foreground">{currentQuestion}</p>
              </div>
            )}

            <AnimatePresence>
              {liveTranscript && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="w-full"
                >
                  <div className="glass rounded-xl border border-emerald-500/20 w-full p-3">
                    <p className="text-xs text-muted-foreground mb-1 font-medium uppercase tracking-wide">Your Answer</p>
                    <p className="text-sm italic text-muted-foreground">{liveTranscript}</p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <button
              onClick={endInterview}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-all mt-2"
            >
              <PhoneOff className="h-4 w-4" /> End Interview
            </button>
          </motion.div>
        )}

        {phase === "scoring" && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-20">
            <Loader2 className="h-12 w-12 animate-spin text-violet-400 mx-auto mb-4" />
            <h2 className="text-xl font-bold mb-2 text-foreground">Analyzing Your Interview</h2>
            <p className="text-muted-foreground text-sm">AI is evaluating your responses...</p>
            <Progress value={66} className="max-w-xs mx-auto mt-6" />
          </motion.div>
        )}

        {phase === "report" && scores && (
          <InterviewReport scores={scores} role={role} experienceLevel={experienceLevel} />
        )}
      </main>
    </div>
  );
}
