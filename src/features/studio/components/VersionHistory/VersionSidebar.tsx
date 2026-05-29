import { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Clock, RotateCcw } from "lucide-react";
import type { StudioVersion } from "../../types/studio.types";

interface VersionSidebarProps {
  versions: StudioVersion[];
  loading: boolean;
  open: boolean;
  onClose: () => void;
  onRevert: (versionId: string) => void;
  onLoad: () => void;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function VersionSidebar({ versions, loading, open, onClose, onRevert, onLoad }: VersionSidebarProps) {
  useEffect(() => {
    if (open) onLoad();
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ x: "100%", opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: "100%", opacity: 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 30 }}
          className="absolute inset-0 md:left-auto md:w-72 z-40 bg-[#0d0d15] border-l border-white/10 flex flex-col"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-violet-400" />
              <span className="text-sm font-semibold text-white">Version History</span>
            </div>
            <button onClick={onClose} className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-white/5">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Versions List */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {loading && (
              <div className="flex items-center justify-center py-8">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-violet-400 border-t-transparent" />
              </div>
            )}

            {!loading && versions.length === 0 && (
              <p className="text-xs text-slate-500 text-center py-8">No versions yet. Changes will appear here as you edit.</p>
            )}

            {versions.map((v, i) => (
              <motion.div
                key={v.id}
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.04 }}
                className="group bg-[#14141f] rounded-lg border border-white/5 p-3 hover:border-violet-500/20 transition-all"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-slate-300 truncate">
                      {v.change_summary || "Version snapshot"}
                    </p>
                    <p className="text-[10px] text-slate-500 mt-1">{timeAgo(v.created_at)}</p>
                  </div>
                  <button
                    onClick={() => onRevert(v.id)}
                    className="opacity-0 group-hover:opacity-100 p-1.5 rounded-md text-slate-400 hover:text-violet-300 hover:bg-violet-500/10 transition-all"
                    title="Revert to this version"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                  </button>
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
