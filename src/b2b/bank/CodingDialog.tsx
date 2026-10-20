// Create / edit a coding question: statement, limits, languages + starter code, tests, reference solution.
// Saving stores it as a draft; the bank page then runs the reference solution on every test (verifyQuestion).
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CodingForm, codingFromRow, codingPayload, emptyCoding, firstError, LANGUAGE_LABEL, LANGUAGES, type QuestionRow } from "./forms";
import { friendly, loadCodingDetails, saveQuestion } from "./queries";

type Lang = CodingForm["languages"][number];

export function CodingDialog({ open, onOpenChange, orgId, question, onSaved }: {
  open: boolean; onOpenChange: (o: boolean) => void; orgId: string | null; question?: QuestionRow | null;
  onSaved: (questionId: string) => void;
}) {
  const [f, setF] = useState<CodingForm>(emptyCoding);
  const [starterLang, setStarterLang] = useState<Lang>("python");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (!question) { setF(emptyCoding()); return; }
    let live = true;
    setLoading(true);
    loadCodingDetails(question.id)
      .then((d) => { if (live) setF(codingFromRow(question, d.tests, d.reference)); })
      .catch((e: unknown) => { if (live) setError(friendly(e)); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [open, question]);

  const set = <K extends keyof CodingForm>(k: K, v: CodingForm[K]) => setF((p) => ({ ...p, [k]: v }));
  const toggleLang = (l: Lang, on: boolean) => set("languages", on ? Array.from(new Set([...f.languages, l])) : f.languages.filter((x) => x !== l));
  const setTest = (i: number, patch: Partial<CodingForm["tests"][number]>) => set("tests", f.tests.map((t, j) => (j === i ? { ...t, ...patch } : t)));

  const submit = async () => {
    setError(null);
    const parsed = CodingForm.safeParse(f);
    if (!parsed.success) { setError(firstError(parsed.error)); return; }
    setBusy(true);
    try {
      const r = await saveQuestion(codingPayload(orgId, parsed.data, question?.id));
      onSaved(r.questionId);
      onOpenChange(false);
    } catch (e) {
      setError(friendly(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{question ? "Edit coding question" : "New coding question"}</DialogTitle>
          <DialogDescription>
            Saved as a draft. It becomes usable in tests once the reference solution passes every test in the code runner.
          </DialogDescription>
        </DialogHeader>
        {loading ? <p className="text-sm text-muted-foreground">Loading tests…</p> : (
          <div className="grid gap-3">
            <div>
              <Label htmlFor="cq-title">Title</Label>
              <Input id="cq-title" value={f.title} onChange={(e) => set("title", e.target.value)} />
            </div>
            <div>
              <Label htmlFor="cq-statement">Problem statement (markdown)</Label>
              <Textarea id="cq-statement" rows={6} value={f.statement} onChange={(e) => set("statement", e.target.value)} />
            </div>
            <div>
              <Label htmlFor="cq-constraints">Constraints</Label>
              <Textarea id="cq-constraints" rows={2} value={f.constraints} onChange={(e) => set("constraints", e.target.value)} />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <Label>Difficulty</Label>
                <Select value={f.difficulty} onValueChange={(v) => set("difficulty", v as CodingForm["difficulty"])}>
                  <SelectTrigger aria-label="Difficulty"><SelectValue /></SelectTrigger>
                  <SelectContent>{["easy", "medium", "hard"].map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="cq-points">Points</Label>
                <Input id="cq-points" type="number" min={1} value={f.points} onChange={(e) => set("points", Number(e.target.value))} />
              </div>
              <div>
                <Label htmlFor="cq-time">Time limit (ms)</Label>
                <Input id="cq-time" type="number" min={100} max={20000} value={f.time_limit_ms} onChange={(e) => set("time_limit_ms", Number(e.target.value))} />
              </div>
              <div>
                <Label htmlFor="cq-mem">Memory limit (KB)</Label>
                <Input id="cq-mem" type="number" min={16000} value={f.memory_limit_kb} onChange={(e) => set("memory_limit_kb", Number(e.target.value))} />
              </div>
            </div>
            <div>
              <Label htmlFor="cq-topics">Topics</Label>
              <Input id="cq-topics" placeholder="e.g. arrays, two pointers" value={f.topics} onChange={(e) => set("topics", e.target.value)} />
            </div>
            <fieldset>
              <legend className="text-sm font-medium mb-1">Languages candidates may use</legend>
              <div className="flex flex-wrap gap-4">
                {LANGUAGES.map((l) => (
                  <label key={l} className="flex items-center gap-2 text-sm">
                    <Checkbox checked={f.languages.includes(l)} onCheckedChange={(c) => toggleLang(l, c === true)} aria-label={LANGUAGE_LABEL[l]} />
                    {LANGUAGE_LABEL[l]}
                  </label>
                ))}
              </div>
            </fieldset>
            <div>
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="cq-starter">Starter code (optional)</Label>
                <Select value={starterLang} onValueChange={(v) => setStarterLang(v as Lang)}>
                  <SelectTrigger aria-label="Starter code language" className="w-40"><SelectValue /></SelectTrigger>
                  <SelectContent>{LANGUAGES.map((l) => <SelectItem key={l} value={l}>{LANGUAGE_LABEL[l]}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <Textarea id="cq-starter" rows={4} className="font-mono text-xs mt-1" value={f.starter_code[starterLang] ?? ""}
                        onChange={(e) => set("starter_code", { ...f.starter_code, [starterLang]: e.target.value })} />
            </div>
            <fieldset className="grid gap-2">
              <legend className="text-sm font-medium mb-1">Tests (stdin → expected stdout). Samples are shown to candidates; hidden tests never are.</legend>
              {f.tests.map((t, i) => (
                <div key={i} className="rounded-md border border-border p-2 grid gap-2">
                  <div className="grid grid-cols-2 gap-2">
                    <Textarea aria-label={`Test ${i + 1} input`} rows={2} className="font-mono text-xs" placeholder="Input"
                              value={t.input} onChange={(e) => setTest(i, { input: e.target.value })} />
                    <Textarea aria-label={`Test ${i + 1} expected output`} rows={2} className="font-mono text-xs" placeholder="Expected output"
                              value={t.expected_output} onChange={(e) => setTest(i, { expected_output: e.target.value })} />
                  </div>
                  <div className="flex items-center gap-4 text-sm">
                    <label className="flex items-center gap-2">
                      <Checkbox checked={t.is_sample} onCheckedChange={(c) => setTest(i, { is_sample: c === true })} aria-label={`Test ${i + 1} is a sample`} />
                      Sample
                    </label>
                    <label className="flex items-center gap-2">
                      Weight
                      <Input aria-label={`Test ${i + 1} weight`} type="number" min={0.1} step={0.5} className="w-20 h-8" value={t.weight}
                             onChange={(e) => setTest(i, { weight: Number(e.target.value) })} />
                    </label>
                    <Button type="button" variant="ghost" size="sm" className="ml-auto" disabled={f.tests.length <= 2}
                            onClick={() => set("tests", f.tests.filter((_, j) => j !== i))}>Remove</Button>
                  </div>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" className="justify-self-start"
                      onClick={() => set("tests", [...f.tests, { input: "", expected_output: "", is_sample: false, weight: 1 }])}>Add test</Button>
            </fieldset>
            <div>
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="cq-ref">Reference solution (never shown to candidates)</Label>
                <Select value={f.reference_language} onValueChange={(v) => set("reference_language", v as Lang)}>
                  <SelectTrigger aria-label="Reference language" className="w-40"><SelectValue /></SelectTrigger>
                  <SelectContent>{LANGUAGES.map((l) => <SelectItem key={l} value={l}>{LANGUAGE_LABEL[l]}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <Textarea id="cq-ref" rows={6} className="font-mono text-xs mt-1" value={f.reference_code}
                        onChange={(e) => set("reference_code", e.target.value)} />
            </div>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={busy || loading}>{busy ? "Saving…" : "Save and verify"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
