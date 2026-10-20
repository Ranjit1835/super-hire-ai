// Generate original questions with AI (b2b-assess generateQuestions). Coding questions are verified in the code
// runner before they can be used; anything that fails stays a draft.
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ApiError, assessApi } from "../lib/api";

export interface GenerateResult { verified: number; drafts: number; reasons: string[] }

export function GenerateDialog({ open, onOpenChange, orgId, onDone }: {
  open: boolean; onOpenChange: (o: boolean) => void; orgId: string | null; onDone: (r: GenerateResult) => void;
}) {
  const [type, setType] = useState<"coding" | "mcq">("coding");
  const [topic, setTopic] = useState("");
  const [difficulty, setDifficulty] = useState<"easy" | "medium" | "hard">("easy");
  const [role, setRole] = useState("");
  const [count, setCount] = useState(3);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (open) setError(null); }, [open]);

  const submit = async () => {
    setError(null);
    if (topic.trim().length < 2) { setError("Enter a topic (at least 2 characters)."); return; }
    if (!Number.isInteger(count) || count < 1 || count > 10) { setError("Generate between 1 and 10 questions at a time."); return; }
    setBusy(true);
    try {
      const r = await assessApi("generateQuestions", {
        orgId, type, topic: topic.trim(), difficulty, count, ...(role.trim() ? { role: role.trim() } : {}),
      }, { timeoutMs: 180_000 });
      onDone({
        verified: r.created.filter((c) => c.status === "verified").length,
        drafts: r.created.filter((c) => c.status === "draft").length,
        reasons: Array.from(new Set(r.created.map((c) => c.reason).filter((x): x is string => !!x))),
      });
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : "Couldn't generate questions.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Generate questions with AI</DialogTitle>
          <DialogDescription>
            AI writes original questions for the topic. Coding questions come with tests and a reference solution, which is run on
            every test; only questions that pass are marked verified. Review every question before using it.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Question type">
            {(["coding", "mcq"] as const).map((t) => (
              <Button key={t} type="button" variant={type === t ? "default" : "outline"} role="radio" aria-checked={type === t} onClick={() => setType(t)}>
                {t === "coding" ? "Coding" : "MCQ"}
              </Button>
            ))}
          </div>
          <div>
            <Label htmlFor="gen-topic">Topic</Label>
            <Input id="gen-topic" placeholder={type === "coding" ? "e.g. arrays, sliding window" : "e.g. operating systems, percentages"}
                   value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={80} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Difficulty</Label>
              <Select value={difficulty} onValueChange={(v) => setDifficulty(v as typeof difficulty)}>
                <SelectTrigger aria-label="Difficulty"><SelectValue /></SelectTrigger>
                <SelectContent>{["easy", "medium", "hard"].map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="gen-count">How many</Label>
              <Input id="gen-count" type="number" min={1} max={10} value={count} onChange={(e) => setCount(Number(e.target.value))} />
            </div>
          </div>
          <div>
            <Label htmlFor="gen-role">Role (optional)</Label>
            <Input id="gen-role" placeholder="e.g. backend developer" value={role} onChange={(e) => setRole(e.target.value)} maxLength={80} />
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>{busy ? "Generating… (this can take a minute)" : "Generate"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
