import { useState, useRef, useCallback } from "react";
import { motion } from "framer-motion";
import { ResumeRenderer } from "./ResumeRenderer";
import { FloatingActionBar } from "./FloatingActionBar";
import { ZoomIn, ZoomOut, RotateCcw } from "lucide-react";
import type { ResumeJSON, StudioTemplateId, ResumeChange } from "../../types/studio.types";

interface PreviewPanelProps {
  currentJson: ResumeJSON;
  originalJson: ResumeJSON;
  templateId: StudioTemplateId;
  pendingChanges: ResumeChange[];
  onTemplateChange: (id: StudioTemplateId) => void;
  onDownloadPdf: () => void;
  onToggleVersions: () => void;
  onShare: () => void;
  showVersions: boolean;
}

export function PreviewPanel({
  currentJson,
  originalJson,
  templateId,
  pendingChanges,
  onTemplateChange,
  onDownloadPdf,
  onToggleVersions,
  onShare,
  showVersions,
}: PreviewPanelProps) {
  const [zoom, setZoom] = useState(0.65);
  const [showOriginal, setShowOriginal] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const zoomIn = () => setZoom((z) => Math.min(z + 0.1, 1.2));
  const zoomOut = () => setZoom((z) => Math.max(z - 0.1, 0.3));
  const resetZoom = () => setZoom(0.65);

  const toggleCompare = useCallback(() => {
    setShowOriginal((prev) => !prev);
  }, []);

  return (
    <div className="flex flex-col h-full bg-[#0d0d15]">
      {/* Toolbar */}
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-2 border-b border-white/5">
        <div className="flex items-center gap-1">
          <button onClick={zoomOut} className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-white/5">
            <ZoomOut className="w-4 h-4" />
          </button>
          <span className="text-xs text-slate-500 w-10 text-center">{Math.round(zoom * 100)}%</span>
          <button onClick={zoomIn} className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-white/5">
            <ZoomIn className="w-4 h-4" />
          </button>
          <button onClick={resetZoom} className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-white/5">
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>

        {showOriginal && (
          <span className="text-xs text-amber-400 font-medium">Viewing Original</span>
        )}

        <div className="text-xs text-slate-500">
          {templateId.replace("-", " ").replace(/\b\w/g, (l) => l.toUpperCase())}
        </div>
      </div>

      {/* Preview Area */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto p-6 flex justify-center"
        style={{ background: "radial-gradient(circle at 50% 30%, #1a1a2e 0%, #0a0a0f 70%)" }}
      >
        <motion.div
          layout
          transition={{ type: "spring", stiffness: 200, damping: 25 }}
          style={{ transform: `scale(${zoom})`, transformOrigin: "top center" }}
        >
          <ResumeRenderer
            json={showOriginal ? originalJson : currentJson}
            templateId={templateId}
            pendingChanges={showOriginal ? [] : pendingChanges}
          />
        </motion.div>
      </div>

      {/* Floating Action Bar */}
      <div className="flex-shrink-0 flex justify-center pb-4 px-4">
        <FloatingActionBar
          templateId={templateId}
          onTemplateChange={onTemplateChange}
          onDownloadPdf={onDownloadPdf}
          onToggleVersions={onToggleVersions}
          onCompareOriginal={toggleCompare}
          onShare={onShare}
          showVersions={showVersions}
        />
      </div>
    </div>
  );
}
