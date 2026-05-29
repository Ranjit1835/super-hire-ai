import { useState } from "react";
import { motion } from "framer-motion";
import { Download, GitCompare, Palette, History, Share2 } from "lucide-react";
import { TemplateSwitcher } from "./TemplateSwitcher";
import type { StudioTemplateId } from "../../types/studio.types";

interface FloatingActionBarProps {
  templateId: StudioTemplateId;
  onTemplateChange: (id: StudioTemplateId) => void;
  onDownloadPdf: () => void;
  onToggleVersions: () => void;
  onCompareOriginal: () => void;
  onShare: () => void;
  showVersions: boolean;
}

export function FloatingActionBar({
  templateId,
  onTemplateChange,
  onDownloadPdf,
  onToggleVersions,
  onCompareOriginal,
  onShare,
  showVersions,
}: FloatingActionBarProps) {
  const [templateOpen, setTemplateOpen] = useState(false);

  const actions = [
    { icon: Download, label: "PDF", onClick: onDownloadPdf, accent: false },
    { icon: GitCompare, label: "Compare", onClick: onCompareOriginal, accent: false },
    { icon: Palette, label: "Template", onClick: () => setTemplateOpen(!templateOpen), accent: templateOpen },
    { icon: History, label: "Versions", onClick: onToggleVersions, accent: showVersions },
    { icon: Share2, label: "Share", onClick: onShare, accent: false },
  ];

  return (
    <div className="relative">
      <TemplateSwitcher
        selected={templateId}
        onChange={onTemplateChange}
        open={templateOpen}
        onClose={() => setTemplateOpen(false)}
      />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center gap-0.5 sm:gap-1 bg-[#14141f]/90 backdrop-blur-xl border border-white/10 rounded-xl px-1.5 sm:px-2 py-1.5 shadow-2xl"
      >
        {actions.map(({ icon: Icon, label, onClick, accent }) => (
          <button
            key={label}
            onClick={onClick}
            className={`flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-2 rounded-lg text-xs font-medium transition-all duration-200 ${
              accent
                ? "bg-violet-600/20 text-violet-300 border border-violet-500/30"
                : "text-slate-400 hover:text-white hover:bg-white/5"
            }`}
            title={label}
          >
            <Icon className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{label}</span>
          </button>
        ))}
      </motion.div>
    </div>
  );
}
