import { motion } from "framer-motion";
import { STUDIO_TEMPLATES, type StudioTemplateId } from "../../types/studio.types";
import { Check } from "lucide-react";

interface TemplateSwitcherProps {
  selected: StudioTemplateId;
  onChange: (id: StudioTemplateId) => void;
  open: boolean;
  onClose: () => void;
}

export function TemplateSwitcher({ selected, onChange, open, onClose }: TemplateSwitcherProps) {
  if (!open) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      className="absolute bottom-16 left-1/2 -translate-x-1/2 z-50 bg-[#14141f] border border-white/10 rounded-xl shadow-2xl p-4 w-[340px]"
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-white">Choose Template</h3>
        <button onClick={onClose} className="text-xs text-slate-400 hover:text-white">Close</button>
      </div>
      <div className="grid grid-cols-5 gap-2">
        {STUDIO_TEMPLATES.map((t) => (
          <button
            key={t.id}
            onClick={() => { onChange(t.id); onClose(); }}
            className={`relative rounded-lg overflow-hidden aspect-[3/4] border-2 transition-all ${
              selected === t.id
                ? "border-violet-500 shadow-lg shadow-violet-500/20"
                : "border-white/10 hover:border-white/30"
            }`}
          >
            <div className="absolute inset-0" style={{ background: t.preview }} />
            <div className="absolute inset-0 flex flex-col items-center justify-center p-1">
              <div className="w-6 h-0.5 bg-white/40 rounded mb-1" />
              <div className="w-8 h-0.5 bg-white/30 rounded mb-0.5" />
              <div className="w-7 h-0.5 bg-white/20 rounded mb-0.5" />
              <div className="w-8 h-0.5 bg-white/20 rounded" />
            </div>
            {selected === t.id && (
              <div className="absolute inset-0 bg-violet-500/20 flex items-center justify-center">
                <Check className="w-4 h-4 text-white" />
              </div>
            )}
            <span className="absolute bottom-0.5 inset-x-0 text-center text-[7px] text-white/70 font-medium">
              {t.name.split(" ")[0]}
            </span>
          </button>
        ))}
      </div>
    </motion.div>
  );
}
