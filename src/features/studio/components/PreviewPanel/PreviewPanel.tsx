import { useState, useRef, useEffect, useCallback } from "react";
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

const RESUME_WIDTH = 612; // 8.5" at 72dpi

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
  const [zoom, setZoom] = useState(1); // 1 = fit-to-screen
  const [showOriginal, setShowOriginal] = useState(false);
  const [baseScale, setBaseScale] = useState(0.65);
  const containerRef = useRef<HTMLDivElement>(null);

  // Calculate base scale to fit resume in container
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const calc = () => {
      const padding = el.clientWidth < 500 ? 16 : 48; // less padding on mobile
      const available = el.clientWidth - padding;
      setBaseScale(Math.min(available / RESUME_WIDTH, 1));
    };

    calc();
    const observer = new ResizeObserver(calc);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const effectiveScale = baseScale * zoom;

  const zoomIn = useCallback(() => setZoom((z) => Math.min(z + 0.15, 2.5)), []);
  const zoomOut = useCallback(() => setZoom((z) => Math.max(z - 0.15, 0.5)), []);
  const resetZoom = useCallback(() => setZoom(1), []);

  // Pinch-to-zoom for touch devices
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let initialDistance = 0;
    let initialZoom = 1;

    const getDistance = (t1: Touch, t2: Touch) =>
      Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        initialDistance = getDistance(e.touches[0], e.touches[1]);
        initialZoom = zoom;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        const dist = getDistance(e.touches[0], e.touches[1]);
        const ratio = dist / initialDistance;
        setZoom(Math.min(Math.max(initialZoom * ratio, 0.5), 2.5));
      }
    };

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
    };
  }, [zoom]);

  const toggleCompare = useCallback(() => {
    setShowOriginal((prev) => !prev);
  }, []);

  return (
    <div className="flex flex-col h-full bg-[#0d0d15]">
      {/* Toolbar */}
      <div className="flex-shrink-0 flex items-center justify-between px-3 sm:px-4 py-2 border-b border-white/5">
        <div className="flex items-center gap-0.5 sm:gap-1">
          <button onClick={zoomOut} className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-white/5 active:bg-white/10">
            <ZoomOut className="w-4 h-4" />
          </button>
          <span className="text-xs text-slate-500 w-10 text-center tabular-nums">{Math.round(effectiveScale * 100)}%</span>
          <button onClick={zoomIn} className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-white/5 active:bg-white/10">
            <ZoomIn className="w-4 h-4" />
          </button>
          <button onClick={resetZoom} className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-white/5 active:bg-white/10">
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>

        {showOriginal && (
          <span className="text-xs text-amber-400 font-medium">Viewing Original</span>
        )}

        <div className="text-xs text-slate-500 truncate ml-2">
          {templateId.replace("-", " ").replace(/\b\w/g, (l) => l.toUpperCase())}
        </div>
      </div>

      {/* Preview Area */}
      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto overflow-x-hidden"
        style={{ background: "radial-gradient(circle at 50% 30%, #1a1a2e 0%, #0a0a0f 70%)" }}
      >
        <div className="flex justify-center p-2 sm:p-6">
          <div
            style={{
              width: RESUME_WIDTH,
              transform: `scale(${effectiveScale})`,
              transformOrigin: "top center",
              transition: "transform 0.2s ease",
            }}
          >
            <ResumeRenderer
              json={showOriginal ? originalJson : currentJson}
              templateId={templateId}
              pendingChanges={showOriginal ? [] : pendingChanges}
            />
          </div>
        </div>
      </div>

      {/* Floating Action Bar */}
      <div className="flex-shrink-0 flex justify-center pb-3 sm:pb-4 px-2 sm:px-4">
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
