import { motion } from "framer-motion";
import { Lightbulb, ArrowRight, AlertTriangle, Info } from "lucide-react";
import type { StudioSuggestion } from "../../types/studio.types";

interface SuggestionsListProps {
  suggestions: StudioSuggestion[];
  onApply: (suggestion: StudioSuggestion) => void;
}

const severityConfig = {
  high: { color: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/20", icon: AlertTriangle },
  medium: { color: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/20", icon: Lightbulb },
  low: { color: "text-blue-400", bg: "bg-blue-500/10", border: "border-blue-500/20", icon: Info },
};

export function SuggestionsList({ suggestions, onApply }: SuggestionsListProps) {
  if (suggestions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-slate-500">
        <Lightbulb className="w-8 h-8 mb-2 opacity-30" />
        <p className="text-xs">No suggestions — your resume looks great!</p>
      </div>
    );
  }

  return (
    <div className="space-y-2 p-3">
      <p className="text-xs text-slate-400 font-medium px-1 mb-2">
        {suggestions.length} suggestion{suggestions.length !== 1 ? "s" : ""} found
      </p>
      {suggestions.map((s, i) => {
        const config = severityConfig[s.severity] || severityConfig.medium;
        const Icon = config.icon;
        return (
          <motion.div
            key={s.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className={`rounded-lg border ${config.border} ${config.bg} p-3`}
          >
            <div className="flex items-start gap-2">
              <Icon className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${config.color}`} />
              <div className="flex-1 min-w-0">
                <p className="text-xs text-slate-300 leading-relaxed">{s.suggestion}</p>
                {s.target_path && (
                  <p className="text-[10px] text-slate-500 mt-1 font-mono">{s.target_path}</p>
                )}
              </div>
            </div>
            <button
              onClick={() => onApply(s)}
              className="mt-2 flex items-center gap-1 text-[10px] font-medium text-violet-400 hover:text-violet-300 transition-colors"
            >
              <span>Fix with AI</span>
              <ArrowRight className="w-3 h-3" />
            </button>
          </motion.div>
        );
      })}
    </div>
  );
}
