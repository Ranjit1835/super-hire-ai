import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { Loader2, Eye, Sparkles } from "lucide-react";
import { ResumeRenderer } from "../components/PreviewPanel/ResumeRenderer";
import { supabase } from "@/integrations/supabase/client";
import type { ResumeJSON, StudioTemplateId } from "../types/studio.types";

function StudioSharedPage() {
  const { shareToken } = useParams<{ shareToken: string }>();
  const [resumeJson, setResumeJson] = useState<ResumeJSON | null>(null);
  const [templateId, setTemplateId] = useState<StudioTemplateId>("classic-ats");
  const [title, setTitle] = useState("Shared Resume");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!shareToken) return;

    supabase.functions
      .invoke("studio-share-link", {
        body: { action: "view", shareToken },
      })
      .then(({ data, error: err }) => {
        if (err || !data?.resume_json) {
          setError("This share link has expired or is invalid.");
        } else {
          setResumeJson(data.resume_json as ResumeJSON);
          setTemplateId((data.template_id || "classic-ats") as StudioTemplateId);
          setTitle(data.title || "Shared Resume");
        }
        setLoading(false);
      });
  }, [shareToken]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-violet-400 animate-spin" />
      </div>
    );
  }

  if (error || !resumeJson) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center text-center px-4">
        <div>
          <p className="text-slate-400 mb-4">{error}</p>
          <a href="https://hiresume.in/studio" className="text-sm text-violet-400 hover:text-violet-300">
            Create your own resume in Studio →
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f]">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-white/5">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-gradient-to-br from-violet-600 to-cyan-600 flex items-center justify-center">
            <Sparkles className="w-3 h-3 text-white" />
          </div>
          <span className="text-xs font-semibold text-white">Resume Studio</span>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-slate-500">
          <Eye className="w-3 h-3" />
          <span>View only</span>
        </div>
      </header>

      {/* Resume */}
      <div className="flex justify-center py-8 px-4">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          style={{ transform: "scale(0.7)", transformOrigin: "top center" }}
        >
          <ResumeRenderer json={resumeJson} templateId={templateId} />
        </motion.div>
      </div>

      {/* CTA */}
      <div className="text-center pb-12">
        <a
          href="https://hiresume.in/studio"
          className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-violet-600 to-cyan-600 text-white text-sm font-medium hover:shadow-lg hover:shadow-violet-500/25 transition-all"
        >
          <Sparkles className="w-4 h-4" />
          Create your resume with AI
        </a>
      </div>
    </div>
  );
}

export default StudioSharedPage;
