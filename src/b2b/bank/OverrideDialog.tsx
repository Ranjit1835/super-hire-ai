// R2.3: keep the author's answer key after the independent check disagreed or found the question unclear. Needs a
// written reason; the override is recorded on the question and in the audit log (b2b_override_mcq_check).
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { b2bDb } from "@/features/b2b/lib/db";
import { mcqCheckReason, type McqCheck } from "../../../supabase/functions/_shared/contracts/assess";

const capitalise = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

const REASON: Record<string, string> = {
  NOTE_REQUIRED: "Please explain in a sentence why your key is right.",
  NOT_CHECKED: "Run the check first (Verify).",
  CHANGED: "The question changed since it was checked. Verify it again.",
  RETIRED: "Retired questions can't be verified.",
};

export function OverrideDialog({ target, onClose, onDone }: {
  target: { questionId: string; version: number; check: McqCheck } | null; onClose: () => void; onDone: () => void;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (target) { setNote(""); setError(null); } }, [target]);

  const submit = async () => {
    if (!target) return;
    if (note.trim().length < 10) { setError(REASON.NOTE_REQUIRED); return; }
    setBusy(true);
    setError(null);
    try {
      const { data, error: e } = await b2bDb.rpc("b2b_override_mcq_check", { _question_id: target.questionId, _version: target.version, _note: note.trim() });
      if (e) throw e;
      const r = data as { ok: boolean; reason?: string };
      if (!r.ok) { setError(REASON[r.reason ?? ""] ?? "Couldn't save the override."); return; }
      onDone();
    } catch {
      setError("Couldn't save the override. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={target != null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Keep your answer key?</DialogTitle>
          <DialogDescription>
            {target ? `${capitalise(mcqCheckReason(target.check))} ` : ""}If you're sure the key is right,
            say why. Your reason is saved with the question and in the audit log.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="override-note">Why the key is right</Label>
          <Textarea id="override-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>{busy ? "Saving…" : "Keep my key"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
