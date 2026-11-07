// R2.2 MCQ templates: write one question with parameters ("A train covers {{d}} km in {{t}} hours"), formulas for
// the answer and the wrong options, see a live preview, then have the server make up to 50 variants ahead of time.
// The preview runs the same code as the server (supabase/functions/_shared/mcq-template.ts); the server's variants
// are the ones saved.
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { generateVariants, templateErrors, type McqTemplate, type TemplateParam } from "../../../supabase/functions/_shared/mcq-template";
import { ApiError, assessApi } from "../lib/api";

interface ParamRow { name: string; min: string; max: string; step: string; choices: string }

const EXAMPLE = {
  title: "Train speed",
  statement: "A train covers {{d}} km in {{t}} hours. What is its average speed?",
  params: [{ name: "d", min: "60", max: "600", step: "30", choices: "" }, { name: "t", min: "2", max: "6", step: "1", choices: "" }],
  answer: "d / t",
  distractors: ["d * t", "d / t + 10", "d / (t + 1)"],
  unit: "km/h",
  conditions: "d % t == 0\nd % (t + 1) == 0",
};

const num = (s: string) => (s.trim() === "" ? undefined : Number(s));

export function toTemplate(f: { title: string; statement: string; params: ParamRow[]; answer: string; distractors: string[];
                                 decimals: number; unit: string; conditions: string }): McqTemplate {
  return {
    title: f.title.trim(), statement: f.statement.trim(), answer: f.answer.trim(), decimals: f.decimals,
    distractors: f.distractors.map((d) => d.trim()).filter(Boolean),
    unit: f.unit.trim() || undefined,
    constraints: f.conditions.split("\n").map((c) => c.trim()).filter(Boolean),
    params: f.params.filter((p) => p.name.trim()).map((p): TemplateParam => {
      const choices = p.choices.split(",").map((x) => x.trim()).filter(Boolean).map(Number);
      return choices.length ? { name: p.name.trim(), choices } : { name: p.name.trim(), min: num(p.min), max: num(p.max), step: num(p.step) };
    }),
  };
}

export function TemplateDialog({ open, onOpenChange, orgId, onDone }: {
  open: boolean; onOpenChange: (o: boolean) => void; orgId: string | null;
  onDone: (r: { created: number; verified: number; reason?: string }) => void;
}) {
  const [title, setTitle] = useState(EXAMPLE.title);
  const [statement, setStatement] = useState(EXAMPLE.statement);
  const [params, setParams] = useState<ParamRow[]>(EXAMPLE.params);
  const [answer, setAnswer] = useState(EXAMPLE.answer);
  const [distractors, setDistractors] = useState<string[]>(EXAMPLE.distractors);
  const [decimals, setDecimals] = useState(0);
  const [unit, setUnit] = useState(EXAMPLE.unit);
  const [conditions, setConditions] = useState(EXAMPLE.conditions);
  const [difficulty, setDifficulty] = useState<"easy" | "medium" | "hard">("easy");
  const [topics, setTopics] = useState("speed, aptitude");
  const [count, setCount] = useState(20);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) setError(null); }, [open]);

  const template = useMemo(() => toTemplate({ title, statement, params, answer, distractors, decimals, unit, conditions }),
    [title, statement, params, answer, distractors, decimals, unit, conditions]);
  const errors = useMemo(() => templateErrors(template), [template]);
  const preview = useMemo(() => {
    if (errors.length) return null;
    try { return generateVariants(template, Math.min(count, 50), "preview"); } catch { return null; }
  }, [template, errors, count]);

  const setParam = (i: number, patch: Partial<ParamRow>) => setParams((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  const submit = async () => {
    setError(null);
    if (title.trim().length < 3) { setError("Give the template a title (at least 3 characters)."); return; }
    if (errors.length) { setError(errors[0]); return; }
    if (!preview?.variants.length) { setError("None of the number combinations gave four different options. Widen the ranges or relax the conditions."); return; }
    setBusy(true);
    try {
      const r = await assessApi("generateVariants", {
        orgId, template, count, difficulty, category: "aptitude",
        topics: topics.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 10),
      }, { timeoutMs: 180_000 });
      onDone(r);
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : "Couldn't make the questions.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl w-[calc(100vw-2rem)] max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Questions from a template</DialogTitle>
          <DialogDescription>
            Write one question with numbers that change, and formulas for the answer and the wrong options. Each student
            gets a different version; no AI runs during the test.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="grid gap-3 content-start">
            <div><Label htmlFor="tpl-title">Title</Label><Input id="tpl-title" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
            <div>
              <Label htmlFor="tpl-statement">Question (use {"{{name}}"} for a number, {"{{= formula}}"} for a computed one)</Label>
              <Textarea id="tpl-statement" rows={3} value={statement} onChange={(e) => setStatement(e.target.value)} />
            </div>
            <fieldset className="grid gap-2">
              <legend className="text-sm font-medium mb-1">Numbers</legend>
              {params.map((p, i) => (
                <div key={i} className="grid grid-cols-[4rem_repeat(3,minmax(0,1fr))_minmax(0,1.4fr)_auto] gap-1.5 items-center">
                  <Input aria-label={`Name ${i + 1}`} value={p.name} onChange={(e) => setParam(i, { name: e.target.value })} className="hr-data" />
                  <Input aria-label={`${p.name || "Number"} from`} placeholder="from" value={p.min} onChange={(e) => setParam(i, { min: e.target.value })} />
                  <Input aria-label={`${p.name || "Number"} to`} placeholder="to" value={p.max} onChange={(e) => setParam(i, { max: e.target.value })} />
                  <Input aria-label={`${p.name || "Number"} step`} placeholder="step" value={p.step} onChange={(e) => setParam(i, { step: e.target.value })} />
                  <Input aria-label={`${p.name || "Number"} or exact values`} placeholder="or: 2, 5, 7" value={p.choices} onChange={(e) => setParam(i, { choices: e.target.value })} />
                  <Button type="button" size="sm" variant="ghost" disabled={params.length <= 1} aria-label={`Remove ${p.name || "number"}`}
                          onClick={() => setParams((ps) => ps.filter((_, j) => j !== i))}>Remove</Button>
                </div>
              ))}
              {params.length < 8 && (
                <Button type="button" size="sm" variant="outline" className="justify-self-start"
                        onClick={() => setParams((ps) => [...ps, { name: "", min: "", max: "", step: "1", choices: "" }])}>Add a number</Button>
              )}
            </fieldset>
            <div><Label htmlFor="tpl-answer">Correct answer formula</Label><Input id="tpl-answer" className="hr-data" value={answer} onChange={(e) => setAnswer(e.target.value)} /></div>
            <fieldset className="grid gap-1.5">
              <legend className="text-sm font-medium mb-1">Wrong-option formulas (common mistakes)</legend>
              {distractors.map((d, i) => (
                <Input key={i} aria-label={`Wrong option ${i + 1}`} className="hr-data" value={d}
                       onChange={(e) => setDistractors((ds) => ds.map((x, j) => (j === i ? e.target.value : x)))} />
              ))}
            </fieldset>
            <div>
              <Label htmlFor="tpl-conditions">Conditions, one per line (e.g. d % t == 0 for whole-number answers)</Label>
              <Textarea id="tpl-conditions" rows={2} className="hr-data" value={conditions} onChange={(e) => setConditions(e.target.value)} />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div><Label htmlFor="tpl-unit">Unit</Label><Input id="tpl-unit" value={unit} onChange={(e) => setUnit(e.target.value)} /></div>
              <div><Label htmlFor="tpl-decimals">Decimals</Label>
                <Input id="tpl-decimals" type="number" min={0} max={4} value={decimals} onChange={(e) => setDecimals(Number(e.target.value))} /></div>
              <div><Label htmlFor="tpl-count">How many</Label>
                <Input id="tpl-count" type="number" min={1} max={50} value={count} onChange={(e) => setCount(Math.max(1, Math.min(50, Number(e.target.value) || 1)))} /></div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label htmlFor="tpl-difficulty">Difficulty</Label>
                <Select value={difficulty} onValueChange={(v) => setDifficulty(v as typeof difficulty)}>
                  <SelectTrigger id="tpl-difficulty"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="easy">Easy</SelectItem><SelectItem value="medium">Medium</SelectItem><SelectItem value="hard">Hard</SelectItem></SelectContent>
                </Select>
              </div>
              <div><Label htmlFor="tpl-topics">Topics (comma separated)</Label><Input id="tpl-topics" value={topics} onChange={(e) => setTopics(e.target.value)} /></div>
            </div>
          </div>

          <section aria-labelledby="tpl-preview" className="space-y-2 min-w-0">
            <h3 id="tpl-preview" className="hr-label">Preview</h3>
            {errors.length > 0 ? (
              <ul className="text-sm text-destructive list-disc pl-5 space-y-1">{errors.slice(0, 6).map((e) => <li key={e}>{e}</li>)}</ul>
            ) : !preview?.variants.length ? (
              <p className="text-sm text-destructive">No combination of these numbers works. Widen the ranges or relax the conditions.</p>
            ) : (
              <>
                <p className="text-xs text-[var(--hr-muted)]">
                  {preview.variants.length < count
                    ? `Only ${preview.variants.length} different versions are possible with these numbers.`
                    : `${preview.variants.length} versions.`} Two are checked by an independent solver before any are used.
                </p>
                <ol className="space-y-3">
                  {preview.variants.slice(0, 3).map((v, i) => (
                    <li key={i} className="text-sm shadow-[inset_0_0_0_1px_var(--hr-rule)] p-3 space-y-1.5">
                      <p>{v.statement}</p>
                      <ul className="grid grid-cols-2 gap-1">
                        {v.options.map((o) => (
                          <li key={o.id} className={o.id === v.answer[0] ? "font-semibold" : "text-[var(--hr-muted)]"}>
                            {o.id.toUpperCase()}. {o.text}{o.id === v.answer[0] ? " ✓" : ""}
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ol>
              </>
            )}
          </section>
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={busy || errors.length > 0}>{busy ? "Making questions…" : `Make ${count} questions`}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
