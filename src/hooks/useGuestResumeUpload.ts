import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { extractTextFromPdf, hashContent } from "@/lib/pdf-parser";

export const MAX_RESUME_FILE_SIZE = 10 * 1024 * 1024;

export type UploadFailureKind = "busy" | "unreadable" | "invalid" | "network" | "unknown";

export interface UploadFailure {
  kind: UploadFailureKind;
  title: string;
  message: string;
  /** The file to retry with; null for problems that retrying the same file can't fix. */
  file: File | null;
}

class UploadError extends Error {
  constructor(public kind: UploadFailureKind, message: string) { super(message); }
}

/** Plain-language explanation for a failed analysis, shared with the dashboard. */
export function describeAnalysisError(raw: string | undefined, status?: number): { kind: UploadFailureKind; title: string; message: string } {
  const m = (raw || "").toLowerCase();
  if (status === 429 || status === 503 || m.includes("rate limit") || m.includes("busy") || m.includes("high demand") || m.includes("overloaded")) {
    return { kind: "busy", title: "Our AI is busy right now", message: "Lots of people are checking resumes at the moment. Your file is fine — please try again in a minute." };
  }
  if (m.includes("extract text") || m.includes("image-based") || m.includes("corrupted") || m.includes("password")) {
    return { kind: "unreadable", title: "We couldn't read text in this PDF", message: "It looks like a scanned or image-only PDF. Export your resume as a PDF from Word, Google Docs or a resume builder (not a photo or scan) and upload that." };
  }
  if (m.includes("failed to fetch") || m.includes("network") || m.includes("load failed")) {
    return { kind: "network", title: "Connection problem", message: "We couldn't reach our servers. Check your internet connection and try again." };
  }
  return { kind: "unknown", title: "Something went wrong", message: raw && raw.length < 160 ? raw : "We couldn't analyse your resume this time. Please try again." };
}

function validate(file: File): UploadFailure | null {
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (file.type !== "application/pdf" && ext !== "pdf") {
    const msg = ext === "docx" || ext === "doc"
      ? "Word files aren't supported yet. In Word, use File → Save As → PDF, then upload the PDF."
      : "Please upload your resume as a PDF file.";
    return { kind: "invalid", title: "Please upload a PDF", message: msg, file: null };
  }
  if (file.size === 0) return { kind: "invalid", title: "This file is empty", message: "Please choose your resume PDF again.", file: null };
  if (file.size > MAX_RESUME_FILE_SIZE) {
    return { kind: "invalid", title: "File too large", message: `The limit is 10 MB and this file is ${(file.size / 1024 / 1024).toFixed(1)} MB. Try exporting it again without images.`, file: null };
  }
  return null;
}

/**
 * Upload a resume from a public page. Signed-in users are handed to the dashboard (which analyses
 * and saves it); guests get a guest analysis. Failures are kept in state so the page can show a
 * full error screen with "Try again" using the same file instead of a passing toast.
 */
export function useGuestResumeUpload() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [processing, setProcessing] = useState(false);
  const [failure, setFailure] = useState<UploadFailure | null>(null);

  const upload = useCallback(async (file: File) => {
    setFailure(null);
    const invalid = validate(file);
    if (invalid) { setFailure(invalid); return; }

    setProcessing(true);
    try {
      let text: string;
      try {
        text = await extractTextFromPdf(file);
      } catch {
        throw new UploadError("unreadable", "extract text");
      }
      if (!text.trim()) throw new UploadError("unreadable", "extract text");
      const contentHash = await hashContent(text);

      if (user) {
        sessionStorage.setItem("pendingResume", JSON.stringify({ resumeText: text, fileName: file.name, contentHash }));
        navigate("/dashboard?autoAnalyze=true");
        return;
      }

      let res: Response;
      try {
        res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyze-resume`, {
          method: "POST",
          headers: { "Content-Type": "application/json", apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY },
          body: JSON.stringify({ resumeText: text, fileName: file.name, contentHash, guestMode: true }),
        });
      } catch {
        throw new UploadError("network", "failed to fetch");
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const d = describeAnalysisError(data?.error, res.status);
        throw new UploadError(d.kind, data?.error || "");
      }
      if (data.guestToken) navigate(`/analysis/guest/${data.guestToken}`);
      else if (data.id) navigate(`/analysis/${data.id}`);
      else throw new UploadError("unknown", "");
    } catch (err) {
      const raw = err instanceof Error ? err.message : "";
      const d = describeAnalysisError(raw, err instanceof UploadError && err.kind === "busy" ? 429 : undefined);
      setFailure({ ...d, file: d.kind === "busy" || d.kind === "network" || d.kind === "unknown" ? file : null });
    } finally {
      setProcessing(false);
    }
  }, [navigate, user]);

  const retry = useCallback(() => { if (failure?.file) void upload(failure.file); }, [failure, upload]);
  const reset = useCallback(() => setFailure(null), []);

  return { processing, failure, upload, retry, reset };
}
