import { motion } from "framer-motion";
import { Bot, User, AlertCircle } from "lucide-react";
import type { StudioMessage, ResumeChange } from "../../types/studio.types";

interface MessageBubbleProps {
  message: StudioMessage;
  isLatest?: boolean;
}

export function MessageBubble({ message, isLatest }: MessageBubbleProps) {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";

  // Strip JSON blocks from assistant messages for display
  const displayContent = isUser
    ? message.content
    : message.content.replace(/```json[\s\S]*?```/g, "").trim();

  const changes = message.changes_applied as ResumeChange[] | null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
      className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""} ${isSystem ? "justify-center" : ""}`}
    >
      {/* Avatar */}
      {!isSystem && (
        <div
          className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
            isUser
              ? "bg-gradient-to-br from-violet-500 to-cyan-500"
              : "bg-gradient-to-br from-slate-700 to-slate-600 ring-1 ring-white/10"
          }`}
        >
          {isUser ? <User className="w-4 h-4 text-white" /> : <Bot className="w-4 h-4 text-white" />}
        </div>
      )}

      {/* Bubble */}
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
          isUser
            ? "bg-gradient-to-br from-violet-600 to-violet-700 text-white"
            : isSystem
            ? "bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs px-3 py-2 flex items-center gap-2"
            : "bg-[#1a1a2e] border border-white/5 text-slate-200"
        }`}
      >
        {isSystem && <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />}

        {/* Render markdown-lite content */}
        <div className="whitespace-pre-wrap break-words">
          {displayContent.split("\n").map((line, i) => {
            // Bold
            const formatted = line.replace(
              /\*\*(.*?)\*\*/g,
              '<strong class="font-semibold text-white">$1</strong>'
            );
            return (
              <p
                key={i}
                className={i > 0 ? "mt-1.5" : ""}
                dangerouslySetInnerHTML={{ __html: formatted }}
              />
            );
          })}
        </div>

        {/* Change notification */}
        {changes && changes.length > 0 && !isUser && (
          <div className="mt-3 pt-3 border-t border-white/10">
            <p className="text-xs text-cyan-400 font-medium mb-1.5">
              Changes applied ({changes.length}):
            </p>
            {changes.slice(0, 3).map((c, i) => (
              <div key={i} className="text-xs text-slate-400 mb-1 pl-2 border-l-2 border-cyan-500/30">
                <span className="text-slate-500">{c.path}:</span>{" "}
                <span className="line-through text-red-400/60">{c.old?.slice(0, 40)}...</span>{" "}
                <span className="text-emerald-400/80">→ {c.new?.slice(0, 40)}...</span>
              </div>
            ))}
            {changes.length > 3 && (
              <p className="text-xs text-slate-500 pl-2">+{changes.length - 3} more changes</p>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}
