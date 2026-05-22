import { useState, useRef, useEffect } from "react";
import { Send, Loader2 } from "lucide-react";

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
  isStreaming?: boolean;
  placeholder?: string;
}

export function ChatInput({ onSend, disabled, isStreaming, placeholder }: ChatInputProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = Math.min(el.scrollHeight, 120) + "px";
    }
  }, [value]);

  const handleSubmit = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled || isStreaming) return;
    onSend(trimmed);
    setValue("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="border-t border-white/5 bg-[#0d0d15]/80 backdrop-blur-sm p-3">
      <div className="flex items-end gap-2 bg-[#14141f] rounded-xl border border-white/10 px-3 py-2 focus-within:border-violet-500/40 transition-colors">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled || isStreaming}
          placeholder={placeholder || "Ask me to improve your resume..."}
          rows={1}
          className="flex-1 bg-transparent text-sm text-white placeholder-slate-500 resize-none outline-none max-h-[120px] py-1"
        />
        <button
          onClick={handleSubmit}
          disabled={!value.trim() || disabled || isStreaming}
          className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center
            bg-gradient-to-r from-violet-600 to-cyan-600 text-white
            disabled:opacity-30 disabled:cursor-not-allowed
            hover:shadow-lg hover:shadow-violet-500/25 transition-all duration-200"
        >
          {isStreaming ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Send className="w-4 h-4" />
          )}
        </button>
      </div>
    </div>
  );
}
