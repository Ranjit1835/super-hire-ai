import { AlertTriangle, FileWarning, RefreshCw, Upload, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { UploadFailure } from "@/hooks/useGuestResumeUpload";

const ICONS = { busy: RefreshCw, unreadable: FileWarning, invalid: FileWarning, network: WifiOff, unknown: AlertTriangle } as const;

/** Full-width error state after a failed resume upload: says what happened and offers the next step. */
export function UploadFailurePanel({ failure, onRetry, onPickAnother }: {
  failure: UploadFailure;
  onRetry: () => void;
  onPickAnother: () => void;
}) {
  const Icon = ICONS[failure.kind];
  return (
    <div role="alert" className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-6 text-center max-w-lg mx-auto">
      <div className="mx-auto mb-3 h-12 w-12 rounded-full bg-amber-500/10 flex items-center justify-center">
        <Icon className="h-6 w-6 text-amber-400" aria-hidden />
      </div>
      <h2 className="text-lg font-semibold mb-1">{failure.title}</h2>
      <p className="text-sm text-muted-foreground leading-relaxed mb-5">{failure.message}</p>
      <div className="flex flex-col sm:flex-row gap-2 justify-center">
        {failure.file && (
          <Button onClick={onRetry} className="gap-2">
            <RefreshCw className="h-4 w-4" /> Try again
          </Button>
        )}
        <Button variant={failure.file ? "outline" : "default"} onClick={onPickAnother} className="gap-2">
          <Upload className="h-4 w-4" /> {failure.file ? "Choose a different file" : "Choose a PDF"}
        </Button>
      </div>
      {failure.file && <p className="text-xs text-muted-foreground mt-3">Retrying uses the same file: {failure.file.name}</p>}
      <p className="text-xs text-muted-foreground mt-4">
        Still stuck? <a className="text-primary hover:underline" href="mailto:support@hiresume.in">support@hiresume.in</a>
      </p>
    </div>
  );
}
