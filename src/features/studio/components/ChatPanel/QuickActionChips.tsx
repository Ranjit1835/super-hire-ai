import { motion } from "framer-motion";
import { QUICK_ACTIONS } from "../../types/studio.types";

interface QuickActionChipsProps {
  onSelect: (prompt: string) => void;
  disabled?: boolean;
}

export function QuickActionChips({ onSelect, disabled }: QuickActionChipsProps) {
  return (
    <div className="flex flex-wrap gap-2 px-4 py-3">
      {QUICK_ACTIONS.map((action, i) => (
        <motion.button
          key={action.label}
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: i * 0.05 }}
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.97 }}
          disabled={disabled}
          onClick={() => onSelect(action.prompt)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium
            bg-white/5 border border-white/10 text-slate-300
            hover:bg-white/10 hover:border-violet-500/30 hover:text-white
            disabled:opacity-40 disabled:cursor-not-allowed
            transition-all duration-200"
        >
          <span>{action.icon}</span>
          <span>{action.label}</span>
        </motion.button>
      ))}
    </div>
  );
}
