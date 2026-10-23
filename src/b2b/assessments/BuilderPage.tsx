// /assess/tests/:orgId/new and /assess/tests/:orgId/:assessmentId — the test builder.
// A test is sections (coding / MCQ); each section draws questions by pool rules ("2 easy arrays") and/or fixed picks.
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Empty, Loading, V1Shell } from "../layout/V1Shell";
import { assessTabs } from "../bank/BankPage";
import {
  AssessmentForm, assessmentFromRow, assessmentRow, checkDraw, describeRule, emptyAssessment, firstError, LANGUAGE_LABEL, LANGUAGES,
  poolMatches, type PoolRule, type QuestionRow, type SectionForm,
} from "../bank/forms";
import { friendly, saveAssessment, useAssessment, useBank, useCanEdit } from "../bank/queries";

const POLICIES: { value: AssessmentForm["proctoring_policy"]; label: string; hint: string }[] = [
  { value: "off", label: "Off", hint: "No proctoring." },
  { value: "standard", label: "Standard", hint: "Everything is logged for review and the candidate sees warnings; the test is never interrupted." },
  { value: "strict", label: "Strict", hint: "Warnings plus a violation counter; the test is submitted automatically after the limit below." },
  { value: "maximum", label: "Maximum", hint: "Any serious violation (screen share stopped, camera off, extra monitor, full-screen exit) pauses the test until fixed." },
];

type Lang = AssessmentForm["languages"][number];

export default function BuilderPage() {
  const { orgId = "", assessmentId } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const canEdit = useCanEdit(orgId);
  const existing = useAssessment(assessmentId);
  const bank = useBank(orgId, canEdit.data === true);
  const [f, setF] = useState<AssessmentForm>(emptyAssessment);
  const [loaded, setLoaded] = useState(!assessmentId);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (assessmentId && existing.data && !loaded) { setF(assessmentFromRow(existing.data)); setLoaded(true); }
  }, [assessmentId, existing.data, loaded]);

  const set = <K extends keyof AssessmentForm>(k: K, v: AssessmentForm[K]) => setF((p) => ({ ...p, [k]: v }));
  const setSection = (i: number, patch: Partial<SectionForm>) => set("sections", f.sections.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const setRule = (si: number, ri: number, patch: Partial<PoolRule>) =>
    setSection(si, { pick: f.sections[si].pick.map((r, j) => (j === ri ? { ...r, ...patch } : r)) });

  const draw = useMemo(() => checkDraw(bank.data ?? [], f.sections, f.languages), [bank.data, f.sections, f.languages]);

  const submit = async () => {
    setError(null);
    const parsed = AssessmentForm.safeParse(f);
    if (!parsed.success) { setError(firstError(parsed.error)); return; }
    // The server quietly hands out fewer questions when a pool runs dry; a test in use must never do that.
    if (parsed.data.status === "ready" && draw.short) {
      setError("Some candidates would get fewer questions than this test asks for (see the rules marked in red). Add questions to the bank, lower the counts, or save it as a draft.");
      return;
    }
    setBusy(true);
    try {
      await saveAssessment(assessmentId, assessmentRow(orgId, parsed.data));
      await qc.invalidateQueries({ queryKey: ["b2b-assess", "assessments", orgId] });
      if (assessmentId) await qc.invalidateQueries({ queryKey: ["b2b-assess", "assessment", assessmentId] });
      navigate(`/assess/tests/${orgId}`);
    } catch (e) {
      setError(friendly(e));
    } finally {
      setBusy(false);
    }
  };

  const title = assessmentId ? "Edit test" : "New test";
  if (canEdit.isLoading || (assessmentId && existing.isLoading)) return <V1Shell title={title}><Loading /></V1Shell>;
  if (canEdit.data !== true) return <V1Shell title={title}><Empty title="You don't have access to these tests" /></V1Shell>;
  if (assessmentId && existing.error) return <V1Shell title={title}><Empty title="Couldn't load this test" body={friendly(existing.error)} /></V1Shell>;

  return (
    <V1Shell title={title} tabs={assessTabs(orgId)}>
      <div className="grid gap-6 max-w-3xl">
        <section className="grid gap-3">
          <div>
            <Label htmlFor="t-title">Title</Label>
            <Input id="t-title" value={f.title} onChange={(e) => set("title", e.target.value)} />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div>
              <Label htmlFor="t-duration">Duration (minutes)</Label>
              <Input id="t-duration" type="number" min={5} max={300} value={f.duration_min} onChange={(e) => set("duration_min", Number(e.target.value))} />
            </div>
            <div>
              <Label htmlFor="t-late">Late join allowed (minutes, blank = any time in the window)</Label>
              <Input id="t-late" type="number" min={0} value={f.late_join_min}
                     onChange={(e) => set("late_join_min", e.target.value === "" ? "" : Number(e.target.value))} />
            </div>
            <div>
              <Label>Status</Label>
              <Select value={f.status} onValueChange={(v) => set("status", v as AssessmentForm["status"])}>
                <SelectTrigger aria-label="Status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Draft</SelectItem><SelectItem value="ready">Ready to use</SelectItem><SelectItem value="archived">Archived</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <fieldset>
            <legend className="text-sm font-medium mb-1">Languages</legend>
            <div className="flex flex-wrap gap-4">
              {LANGUAGES.map((l) => (
                <label key={l} className="flex items-center gap-2 text-sm">
                  <Checkbox aria-label={LANGUAGE_LABEL[l]} checked={f.languages.includes(l)}
                            onCheckedChange={(c) => set("languages", c === true ? Array.from(new Set([...f.languages, l as Lang])) : f.languages.filter((x) => x !== l))} />
                  {LANGUAGE_LABEL[l]}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="grid gap-2 text-sm">
            <label className="flex items-center gap-2">
              <Checkbox aria-label="Randomize questions per candidate" checked={f.randomize} onCheckedChange={(c) => set("randomize", c === true)} />
              Give each candidate a different selection and order of questions
            </label>
            <label className="flex items-center gap-2">
              <Checkbox aria-label="Shuffle MCQ options" checked={f.shuffle_options} onCheckedChange={(c) => set("shuffle_options", c === true)} />
              Shuffle MCQ options
            </label>
            <label className="flex items-center gap-2">
              <Checkbox aria-label="Allow practice" checked={f.practice_enabled} onCheckedChange={(c) => set("practice_enabled", c === true)} />
              Students may take this as practice (uses ¼ credit per practice attempt; they see their score)
            </label>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div>
              <Label htmlFor="t-negative">Negative marking for wrong MCQs (fraction of points)</Label>
              <Input id="t-negative" type="number" min={0} max={1} step={0.25} value={f.negative_marking}
                     onChange={(e) => set("negative_marking", Number(e.target.value))} />
            </div>
            <div>
              <Label>Proctoring</Label>
              <Select value={f.proctoring_policy} onValueChange={(v) => set("proctoring_policy", v as AssessmentForm["proctoring_policy"])}>
                <SelectTrigger aria-label="Proctoring"><SelectValue /></SelectTrigger>
                <SelectContent>{POLICIES.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}</SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">{POLICIES.find((p) => p.value === f.proctoring_policy)?.hint}</p>
            </div>
            {f.proctoring_policy === "strict" && (
              <div>
                <Label htmlFor="t-violations">Violations before auto-submit</Label>
                <Input id="t-violations" type="number" min={1} max={50} value={f.strict_max_violations}
                       onChange={(e) => set("strict_max_violations", Number(e.target.value))} />
              </div>
            )}
          </div>
        </section>

        <section className="grid gap-4">
          <h2 className="font-semibold">Sections</h2>
          {f.sections.map((s, si) => (
            <SectionEditor key={si} index={si} section={s} bank={bank.data ?? []} languages={f.languages}
                           guaranteed={draw.guaranteed[si] ?? []} fixedAtRisk={draw.fixedAtRisk}
                           onChange={(patch) => setSection(si, patch)} onRule={(ri, patch) => setRule(si, ri, patch)}
                           onRemove={f.sections.length > 1 ? () => set("sections", f.sections.filter((_, j) => j !== si)) : undefined} />
          ))}
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm"
                    onClick={() => set("sections", [...f.sections, { type: "coding", title: "Coding", pick: [{ difficulty: "easy", topics: "", count: 1 }], question_ids: [] }])}>
              Add coding section
            </Button>
            <Button type="button" variant="outline" size="sm"
                    onClick={() => set("sections", [...f.sections, { type: "mcq", title: "MCQ", pick: [{ difficulty: "", topics: "", count: 10 }], question_ids: [] }])}>
              Add MCQ section
            </Button>
          </div>
        </section>

        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex gap-2">
          <Button onClick={submit} disabled={busy}>{busy ? "Saving…" : "Save test"}</Button>
          <Button variant="outline" asChild><Link to={`/assess/tests/${orgId}`}>Cancel</Link></Button>
        </div>
      </div>
    </V1Shell>
  );
}

function SectionEditor({ index, section, bank, languages, guaranteed, fixedAtRisk, onChange, onRule, onRemove }: {
  index: number; section: SectionForm; bank: QuestionRow[]; languages: string[]; guaranteed: number[]; fixedAtRisk: string[];
  onChange: (patch: Partial<SectionForm>) => void; onRule: (ri: number, patch: Partial<PoolRule>) => void; onRemove?: () => void;
}) {
  const [search, setSearch] = useState("");
  const n = index + 1;
  const pickable = useMemo(() => {
    const s = search.trim().toLowerCase();
    return bank.filter((q) => q.type === section.type && q.status === "verified"
      && (!s || q.title.toLowerCase().includes(s) || q.topics.some((t) => t.includes(s)))).slice(0, 50);
  }, [bank, section.type, search]);
  const toggle = (id: string, on: boolean) =>
    onChange({ question_ids: on ? Array.from(new Set([...section.question_ids, id])) : section.question_ids.filter((x) => x !== id) });

  return (
    <div className="rounded-lg border border-border p-4 grid gap-3" aria-label={`Section ${n}`} role="group">
      <div className="flex items-end gap-3">
        <div className="flex-1">
          <Label htmlFor={`s${n}-title`}>Section {n} title ({section.type === "coding" ? "coding" : "MCQ"})</Label>
          <Input id={`s${n}-title`} value={section.title} onChange={(e) => onChange({ title: e.target.value })} />
        </div>
        {onRemove && <Button type="button" variant="ghost" size="sm" onClick={onRemove}>Remove section</Button>}
      </div>
      <div className="grid gap-2">
        <p className="text-sm font-medium">Pool rules</p>
        {section.pick.map((r, ri) => {
          const available = poolMatches(bank, section.type, r, languages);
          const sure = guaranteed[ri] ?? available;
          return (
            <div key={ri} className="flex flex-wrap items-center gap-2 text-sm">
              <Input aria-label={`Section ${n} rule ${ri + 1} count`} type="number" min={1} max={50} className="w-20" value={r.count}
                     onChange={(e) => onRule(ri, { count: Number(e.target.value) })} />
              <Select value={r.difficulty || "any"} onValueChange={(v) => onRule(ri, { difficulty: v === "any" ? "" : (v as PoolRule["difficulty"]) })}>
                <SelectTrigger aria-label={`Section ${n} rule ${ri + 1} difficulty`} className="w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Any difficulty</SelectItem>
                  {["easy", "medium", "hard"].map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                </SelectContent>
              </Select>
              <Input aria-label={`Section ${n} rule ${ri + 1} topics`} placeholder="topics, comma separated (blank = any)" className="flex-1 min-w-48"
                     value={r.topics} onChange={(e) => onRule(ri, { topics: e.target.value })} />
              <span className={sure < r.count ? "text-destructive text-xs" : "text-muted-foreground text-xs"}>
                {describeRule(r)} · {available} verified in bank{available < r.count ? " (not enough)"
                  : sure < r.count ? ` (only ${sure} certain: earlier rules or chosen questions can use the rest)` : ""}
              </span>
              <Button type="button" variant="ghost" size="sm" onClick={() => onChange({ pick: section.pick.filter((_, j) => j !== ri) })}>Remove</Button>
            </div>
          );
        })}
        <Button type="button" variant="outline" size="sm" className="justify-self-start"
                onClick={() => onChange({ pick: [...section.pick, { difficulty: "", topics: "", count: 1 }] })}>Add rule</Button>
      </div>
      <div className="grid gap-2">
        <p className="text-sm font-medium">Always include these questions ({section.question_ids.length} chosen)</p>
        <Input aria-label={`Section ${n} search questions`} placeholder="Search verified questions" value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="max-h-48 overflow-y-auto rounded-md border border-border p-2 grid gap-1">
          {pickable.length === 0 ? <p className="text-xs text-muted-foreground">No verified {section.type === "coding" ? "coding" : "MCQ"} questions match.</p>
            : pickable.map((q) => (
              <label key={q.id} className="flex items-center gap-2 text-sm">
                <Checkbox aria-label={`Include ${q.title}`} checked={section.question_ids.includes(q.id)} onCheckedChange={(c) => toggle(q.id, c === true)} />
                <span>{q.title}</span>
                {section.question_ids.includes(q.id) && fixedAtRisk.includes(q.id)
                  && <span className="text-xs text-destructive">an earlier rule may draw this first</span>}
                <span className="text-xs text-muted-foreground capitalize">{q.difficulty} · {q.topics.join(", ")}</span>
              </label>
            ))}
        </div>
      </div>
    </div>
  );
}
