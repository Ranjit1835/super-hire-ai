// Create / edit an MCQ (single or multi-select). Saved through b2b_save_question.
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CATEGORY_LABEL, emptyMcq, firstError, McqForm, mcqFromRow, mcqPayload, OPTION_IDS, type QuestionRow } from "./forms";
import { friendly, saveQuestion } from "./queries";

export function McqDialog({ open, onOpenChange, orgId, question, onSaved }: {
  open: boolean; onOpenChange: (o: boolean) => void; orgId: string | null; question?: QuestionRow | null; onSaved: (questionId: string, ready: boolean) => void;
}) {
  const [f, setF] = useState<McqForm>(emptyMcq);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setF(question ? mcqFromRow(question) : emptyMcq());
    setError(null);
  }, [open, question]);

  const set = <K extends keyof McqForm>(k: K, v: McqForm[K]) => setF((p) => ({ ...p, [k]: v }));
  const toggleCorrect = (id: string, on: boolean) =>
    set("correct", on ? Array.from(new Set([...f.correct, id])) : f.correct.filter((c) => c !== id));
  const setOption = (i: number, text: string) => set("options", f.options.map((o, j) => (j === i ? { ...o, text } : o)));
  const addOption = () => {
    const id = OPTION_IDS.find((x) => !f.options.some((o) => o.id === x));
    if (id) set("options", [...f.options, { id, text: "" }]);
  };
  const removeOption = (id: string) => setF((p) => ({ ...p, options: p.options.filter((o) => o.id !== id), correct: p.correct.filter((c) => c !== id) }));

  const submit = async () => {
    setError(null);
    const parsed = McqForm.safeParse(f);
    if (!parsed.success) { setError(firstError(parsed.error)); return; }
    setBusy(true);
    try {
      const r = await saveQuestion(mcqPayload(orgId, parsed.data, question?.id));
      onSaved(r.questionId, parsed.data.ready);
      onOpenChange(false);
    } catch (e) {
      setError(friendly(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{question ? "Edit MCQ" : "New MCQ"}</DialogTitle>
          <DialogDescription>Tick every correct option. More than one tick makes it a multi-select question.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div>
            <Label htmlFor="mcq-title">Title</Label>
            <Input id="mcq-title" value={f.title} onChange={(e) => set("title", e.target.value)} />
          </div>
          <div>
            <Label htmlFor="mcq-statement">Question</Label>
            <Textarea id="mcq-statement" rows={4} value={f.statement} onChange={(e) => set("statement", e.target.value)} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>Difficulty</Label>
              <Select value={f.difficulty} onValueChange={(v) => set("difficulty", v as McqForm["difficulty"])}>
                <SelectTrigger aria-label="Difficulty"><SelectValue /></SelectTrigger>
                <SelectContent>{["easy", "medium", "hard"].map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Category</Label>
              <Select value={f.category} onValueChange={(v) => set("category", v as McqForm["category"])}>
                <SelectTrigger aria-label="Category"><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(CATEGORY_LABEL).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="mcq-points">Points</Label>
              <Input id="mcq-points" type="number" min={0.5} step={0.5} value={f.points} onChange={(e) => set("points", Number(e.target.value))} />
            </div>
          </div>
          <div>
            <Label htmlFor="mcq-topics">Topics</Label>
            <Input id="mcq-topics" placeholder="e.g. percentages, ratios" value={f.topics} onChange={(e) => set("topics", e.target.value)} />
          </div>
          <fieldset className="grid gap-2">
            <legend className="text-sm font-medium mb-1">Options</legend>
            {f.options.map((o, i) => (
              <div key={o.id} className="flex items-center gap-2">
                <Checkbox aria-label={`Option ${o.id.toUpperCase()} is correct`} checked={f.correct.includes(o.id)}
                          onCheckedChange={(c) => toggleCorrect(o.id, c === true)} />
                <span className="w-5 text-sm text-muted-foreground">{o.id.toUpperCase()}</span>
                <Input aria-label={`Option ${o.id.toUpperCase()}`} value={o.text} onChange={(e) => setOption(i, e.target.value)} />
                <Button type="button" variant="ghost" size="sm" disabled={f.options.length <= 2} onClick={() => removeOption(o.id)}
                        aria-label={`Remove option ${o.id.toUpperCase()}`}>Remove</Button>
              </div>
            ))}
            {f.options.length < OPTION_IDS.length && (
              <Button type="button" variant="outline" size="sm" className="justify-self-start" onClick={addOption}>Add option</Button>
            )}
          </fieldset>
          <div>
            <Label htmlFor="mcq-explanation">Explanation (optional; shown in practice results only)</Label>
            <Textarea id="mcq-explanation" rows={2} value={f.explanation} onChange={(e) => set("explanation", e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={f.ready} onCheckedChange={(c) => set("ready", c === true)} aria-label="Ready to use in tests" />
            Check the answer and make it ready for tests (an independent check solves it without your key)
          </label>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
