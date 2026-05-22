import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Upload, Sparkles, ArrowLeft, FileText, Loader2, Check, Zap, Brain, Shield } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import * as pdfjsLib from "pdfjs-dist";

// Set worker path
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

function StudioPaywallPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parseStep, setParseStep] = useState(0);
  const [dragOver, setDragOver] = useState(false);

  // Check for existing studio resumes
  const [existingResumes, setExistingResumes] = useState<any[]>([]);
  const [loaded, setLoaded] = useState(false);

  useState(() => {
    supabase
      .from("studio_resumes")
      .select("id, title, updated_at, template_id")
      .order("updated_at", { ascending: false })
      .limit(5)
      .then(({ data }) => {
        setExistingResumes(data || []);
        setLoaded(true);
      });
  });

  const extractText = async (pdfFile: File): Promise<string> => {
    const arrayBuffer = await pdfFile.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let text = "";
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      text += content.items.map((item: any) => item.str).join(" ") + "\n";
    }
    return text;
  };

  const handleFile = useCallback(
    async (selectedFile: File) => {
      if (selectedFile.type !== "application/pdf") {
        toast({ title: "Invalid file", description: "Please upload a PDF file", variant: "destructive" });
        return;
      }
      if (selectedFile.size > 10 * 1024 * 1024) {
        toast({ title: "File too large", description: "Max file size is 10MB", variant: "destructive" });
        return;
      }

      setFile(selectedFile);
      setParsing(true);
      setParseStep(1);

      try {
        // Step 1: Extract text
        setParseStep(1);
        const resumeText = await extractText(selectedFile);
        if (resumeText.trim().length < 50) {
          throw new Error("Could not extract enough text from this PDF");
        }

        // Step 2: AI parsing
        setParseStep(2);
        const { data, error } = await supabase.functions.invoke("studio-parse-resume", {
          body: { resumeText, title: selectedFile.name.replace(".pdf", "") },
        });

        if (error || !data?.resume?.id) {
          throw new Error(error?.message || "Failed to parse resume");
        }

        // Step 3: Done
        setParseStep(3);
        await new Promise((r) => setTimeout(r, 500));

        navigate(`/studio/${data.resume.id}`);
      } catch (err: any) {
        toast({ title: "Parsing failed", description: err.message, variant: "destructive" });
        setParsing(false);
        setParseStep(0);
        setFile(null);
      }
    },
    [navigate, toast]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const droppedFile = e.dataTransfer.files[0];
      if (droppedFile) handleFile(droppedFile);
    },
    [handleFile]
  );

  const parseSteps = [
    { label: "Extracting text from PDF", icon: FileText },
    { label: "AI analyzing resume structure", icon: Brain },
    { label: "Building your studio", icon: Sparkles },
  ];

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      {/* Header */}
      <header className="flex items-center gap-3 px-6 py-4 border-b border-white/5">
        <button
          onClick={() => navigate("/dashboard")}
          className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/5"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-600 to-cyan-600 flex items-center justify-center">
            <Sparkles className="w-3.5 h-3.5 text-white" />
          </div>
          <span className="text-sm font-semibold">Resume Studio</span>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-6 py-12">
        {/* Hero */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-10"
        >
          <h1 className="text-3xl font-bold mb-3">
            <span className="bg-gradient-to-r from-violet-400 to-cyan-400 bg-clip-text text-transparent">
              Chat with AI.
            </span>{" "}
            Watch your resume transform.
          </h1>
          <p className="text-slate-400 text-sm max-w-md mx-auto">
            Upload your resume and have a natural conversation with AI. Every improvement appears in real-time on a live preview.
          </p>
        </motion.div>

        {/* Parsing progress */}
        {parsing && (
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-[#14141f] border border-white/10 rounded-2xl p-8 mb-8"
          >
            <div className="flex items-center gap-3 mb-6">
              <Loader2 className="w-5 h-5 text-violet-400 animate-spin" />
              <span className="text-sm font-medium text-white">Preparing your studio...</span>
            </div>
            <div className="space-y-4">
              {parseSteps.map((step, i) => {
                const Icon = step.icon;
                const isActive = parseStep === i + 1;
                const isDone = parseStep > i + 1;
                return (
                  <div key={i} className="flex items-center gap-3">
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${
                        isDone
                          ? "bg-emerald-500/20 text-emerald-400"
                          : isActive
                          ? "bg-violet-500/20 text-violet-400"
                          : "bg-white/5 text-slate-600"
                      }`}
                    >
                      {isDone ? <Check className="w-4 h-4" /> : <Icon className="w-4 h-4" />}
                    </div>
                    <span
                      className={`text-sm ${
                        isDone ? "text-emerald-400" : isActive ? "text-white" : "text-slate-600"
                      }`}
                    >
                      {step.label}
                    </span>
                    {isActive && (
                      <div className="flex-1 h-1 bg-white/5 rounded-full overflow-hidden">
                        <motion.div
                          className="h-full bg-gradient-to-r from-violet-500 to-cyan-500 rounded-full"
                          initial={{ width: "0%" }}
                          animate={{ width: "80%" }}
                          transition={{ duration: 3, ease: "easeOut" }}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}

        {/* Upload zone */}
        {!parsing && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            className={`relative border-2 border-dashed rounded-2xl p-12 text-center transition-all cursor-pointer ${
              dragOver
                ? "border-violet-500 bg-violet-500/5"
                : "border-white/10 hover:border-white/20 hover:bg-white/[0.02]"
            }`}
            onClick={() => {
              const input = document.createElement("input");
              input.type = "file";
              input.accept = ".pdf";
              input.onchange = (e) => {
                const f = (e.target as HTMLInputElement).files?.[0];
                if (f) handleFile(f);
              };
              input.click();
            }}
          >
            <Upload className="w-10 h-10 text-slate-500 mx-auto mb-4" />
            <p className="text-sm text-slate-300 mb-1">Drop your resume PDF here or click to upload</p>
            <p className="text-xs text-slate-500">PDF only · Max 10MB</p>
          </motion.div>
        )}

        {/* Existing resumes */}
        {!parsing && existingResumes.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="mt-8"
          >
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Recent Resumes</h3>
            <div className="space-y-2">
              {existingResumes.map((r) => (
                <button
                  key={r.id}
                  onClick={() => navigate(`/studio/${r.id}`)}
                  className="w-full flex items-center gap-3 p-3 rounded-xl bg-[#14141f] border border-white/5 hover:border-violet-500/20 transition-all text-left"
                >
                  <FileText className="w-4 h-4 text-slate-500" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white truncate">{r.title}</p>
                    <p className="text-[10px] text-slate-500">
                      {new Date(r.updated_at).toLocaleDateString()}
                    </p>
                  </div>
                  <ArrowLeft className="w-3.5 h-3.5 text-slate-500 rotate-180" />
                </button>
              ))}
            </div>
          </motion.div>
        )}

        {/* Features grid */}
        {!parsing && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="mt-12 grid grid-cols-1 sm:grid-cols-3 gap-4"
          >
            {[
              { icon: Zap, title: "Real-time Preview", desc: "See changes appear instantly as AI edits your resume" },
              { icon: Brain, title: "AI-Powered", desc: "Claude AI understands context, not just keywords" },
              { icon: Shield, title: "Truthful Always", desc: "AI enhances phrasing but never fabricates experience" },
            ].map(({ icon: Icon, title, desc }) => (
              <div key={title} className="bg-[#14141f] border border-white/5 rounded-xl p-4">
                <Icon className="w-5 h-5 text-violet-400 mb-2" />
                <h3 className="text-sm font-semibold text-white mb-1">{title}</h3>
                <p className="text-xs text-slate-400">{desc}</p>
              </div>
            ))}
          </motion.div>
        )}
      </div>
    </div>
  );
}

export default StudioPaywallPage;
