import { useRef, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MessageBubble } from "./MessageBubble";
import { ChatInput } from "./ChatInput";
import { QuickActionChips } from "./QuickActionChips";
import { PersonaSelector } from "./PersonaSelector";
import { Bot, Sparkles, Clock, Lock } from "lucide-react";
import type { StudioMessage, PersonaId, ResumeJSON } from "../../types/studio.types";

interface ChatPanelProps {
  messages: StudioMessage[];
  persona: PersonaId;
  onPersonaChange: (persona: PersonaId) => void;
  onSendMessage: (message: string) => void;
  isStreaming: boolean;
  streamingContent: string;
  resumeJson?: ResumeJSON;
  messagesRemaining: number;
  isPaid: boolean;
  isExpired: boolean;
  expiresAt?: string;
  onUpgradeClick: () => void;
}

export function ChatPanel({
  messages,
  persona,
  onPersonaChange,
  onSendMessage,
  isStreaming,
  streamingContent,
  resumeJson,
  messagesRemaining,
  isPaid,
  isExpired,
  expiresAt,
  onUpgradeClick,
}: ChatPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showChips, setShowChips] = useState(messages.length <= 1);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streamingContent]);

  // Hide chips after first user message
  useEffect(() => {
    if (messages.filter((m) => m.role === "user").length > 0) {
      setShowChips(false);
    }
  }, [messages]);

  const handleSend = (msg: string) => {
    if (isExpired) return;
    onSendMessage(msg);
  };

  // Countdown timer
  const [timeLeft, setTimeLeft] = useState("");
  useEffect(() => {
    if (!expiresAt || !isPaid) return;
    const update = () => {
      const diff = new Date(expiresAt).getTime() - Date.now();
      if (diff <= 0) {
        setTimeLeft("Expired");
        return;
      }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      setTimeLeft(`${h}h ${m}m left`);
    };
    update();
    const interval = setInterval(update, 60000);
    return () => clearInterval(interval);
  }, [expiresAt, isPaid]);

  const isDisabled = isExpired || (!isPaid && messagesRemaining <= 0);

  return (
    <div className="flex flex-col h-full bg-[#0a0a0f]">
      {/* Header */}
      <div className="flex-shrink-0 border-b border-white/5">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-600 to-cyan-600 flex items-center justify-center">
              <Sparkles className="w-3.5 h-3.5 text-white" />
            </div>
            <span className="text-sm font-semibold text-white">Resume Studio AI</span>
          </div>
          <div className="flex items-center gap-2">
            {isPaid && timeLeft && (
              <span className="text-xs text-slate-400 flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {timeLeft}
              </span>
            )}
            {!isPaid && (
              <span className="text-xs text-amber-400 flex items-center gap-1">
                {messagesRemaining} free {messagesRemaining === 1 ? "message" : "messages"} left
              </span>
            )}
          </div>
        </div>
        <PersonaSelector selected={persona} onChange={onPersonaChange} />
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/10">
        {/* Welcome message */}
        {messages.length === 0 && resumeJson && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex gap-3"
          >
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-slate-700 to-slate-600 ring-1 ring-white/10 flex items-center justify-center">
              <Bot className="w-4 h-4 text-white" />
            </div>
            <div className="max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed bg-[#1a1a2e] border border-white/5 text-slate-200">
              <p>
                Hi{resumeJson.personal_info?.name ? ` ${resumeJson.personal_info.name.split(" ")[0]}` : ""}! 👋
              </p>
              <p className="mt-2">
                I can see your resume with{" "}
                {resumeJson.experience?.length || 0} experience{resumeJson.experience?.length !== 1 ? "s" : ""},{" "}
                {resumeJson.skills?.reduce((a, s) => a + s.items.length, 0) || 0} skills, and{" "}
                {resumeJson.projects?.length || 0} projects.
              </p>
              <p className="mt-2">What would you like to improve today? Pick a quick action below or type your own request.</p>
            </div>
          </motion.div>
        )}

        {/* Message list */}
        <AnimatePresence>
          {messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} />
          ))}
        </AnimatePresence>

        {/* Streaming indicator */}
        {isStreaming && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex gap-3"
          >
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-slate-700 to-slate-600 ring-1 ring-white/10 flex items-center justify-center">
              <Bot className="w-4 h-4 text-white" />
            </div>
            <div className="max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed bg-[#1a1a2e] border border-white/5 text-slate-200">
              {streamingContent ? (
                <div className="whitespace-pre-wrap break-words">
                  {streamingContent.replace(/```json[\s\S]*?```/g, "").trim()}
                  <span className="inline-block w-1.5 h-4 bg-violet-400 animate-pulse ml-0.5 rounded-sm" />
                </div>
              ) : (
                <div className="flex items-center gap-1.5">
                  <span className="text-slate-400 text-xs">Analyzing your resume</span>
                  <span className="flex gap-1">
                    {[0, 1, 2].map((i) => (
                      <motion.span
                        key={i}
                        className="w-1.5 h-1.5 rounded-full bg-violet-400"
                        animate={{ opacity: [0.3, 1, 0.3] }}
                        transition={{ duration: 1, repeat: Infinity, delay: i * 0.2 }}
                      />
                    ))}
                  </span>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </div>

      {/* Quick Actions */}
      <AnimatePresence>
        {showChips && !isStreaming && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="flex-shrink-0 border-t border-white/5"
          >
            <QuickActionChips onSelect={handleSend} disabled={isDisabled} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Free limit paywall overlay */}
      {!isPaid && messagesRemaining <= 0 && !isExpired && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex-shrink-0 border-t border-violet-500/20 bg-gradient-to-r from-violet-900/30 to-cyan-900/30 px-4 py-3"
        >
          <div className="flex items-center gap-3">
            <Lock className="w-4 h-4 text-violet-400 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-sm text-white font-medium">Free preview complete</p>
              <p className="text-xs text-slate-400">Upgrade to continue chatting with AI</p>
            </div>
            <button
              onClick={onUpgradeClick}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-gradient-to-r from-violet-600 to-cyan-600 text-white hover:shadow-lg hover:shadow-violet-500/25 transition-all"
            >
              Upgrade
            </button>
          </div>
        </motion.div>
      )}

      {/* Input */}
      <ChatInput
        onSend={handleSend}
        disabled={isDisabled}
        isStreaming={isStreaming}
        placeholder={
          isExpired
            ? "Session expired — please upgrade"
            : !isPaid && messagesRemaining <= 0
            ? "Upgrade to continue..."
            : undefined
        }
      />
    </div>
  );
}
