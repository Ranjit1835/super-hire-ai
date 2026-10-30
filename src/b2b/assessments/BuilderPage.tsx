// /assess/tests/:orgId/new and /assess/tests/:orgId/:assessmentId — the test builder.
// A test is sections (coding / MCQ); each section draws questions by pool rules ("2 easy arrays") and/or fixed picks.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { Empty, Loading, V1Shell } from "../layout/V1Shell";
import { Chip } from "../ui/broadcast";
import { assessTabs } from "../bank/BankPage";
import {
  AssessmentForm, assessmentFromRow, assessmentRow, checkDraw, describeRule, emptyAssessment, firstError, LANGUAGE_LABEL, LANGUAGES,
  paperCapacity, poolMatches, type PaperCapacity, type PoolRule, type SectionForm,
} from "../bank/forms";
import { friendly, saveAssessment, useAssessment, useCanEdit, useVerifiedPool, type PoolRow } from "../bank/queries";

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
  const bank = useVerifiedPool(orgId, canEdit.data === true);
  const [f, setF] = useState<AssessmentForm>(emptyAssessment);
  const [loaded, setLoaded] = useState(!assessmentId);
  const [error, setError] = useState<string | null>(null);
  const [errorField, setErrorField] = useState<"title" | "duration_min" | null>(null);
  const [busy, setBusy] = useState(false);
  const [batch, setBatch] = useState(100);   // students expected in one drive, for the uniqueness check
  const titleRef = useRef<HTMLInputElement>(null);
  const durationRef = useRef<HTMLInputElement>(null);

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
    setErrorField(null);
    const parsed = AssessmentForm.safeParse(f);
    if (!parsed.success) {
      setError(firstError(parsed.error));
      const path = parsed.error.issues[0]?.path[0];
      if (path === "title") { setErrorField("title"); titleRef.current?.focus(); }
      else if (path === "duration_min") { setErrorField("duration_min"); durationRef.current?.focus(); }
      return;
    }
    // The server quietly hands out fewer questions when a pool runs dry; a test in use must never do that.
    if (parsed.data.status === "ready" && !bank.data) {
      setError(bank.error ? `Couldn't load the question bank to check this test: ${friendly(bank.error)}` : "Still loading the question bank. Try again in a moment.");
      return;
    }
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

  const questionsPerCandidate = f.sections.reduce((n, s) => n + s.pick.reduce((m, r) => m + r.count, 0) + s.question_ids.length, 0);
  const shortfalls = f.sections.flatMap((s, si) =>
    s.pick.map((r, ri) => ({ si, ri, r, sure: draw.guaranteed[si]?.[ri] })).filter((x) => x.sure !== undefined && x.sure < x.r.count));

  return (
    <V1Shell title={title} tabs={assessTabs(orgId)}>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] items-start max-w-[1200px]">
      <div className="grid gap-6">
        <section className="grid gap-3 hr-rule-b pb-6">
          <h3 className="hr-display text-[15px]">Basics</h3>
          <div>
            <Label htmlFor="t-title">Title</Label>
            <Input id="t-title" ref={titleRef} value={f.title} onChange={(e) => set("title", e.target.value)}
                   aria-invalid={errorField === "title" ? "true" : undefined}
                   aria-describedby={errorField === "title" ? "builder-error" : undefined} />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div>
              <Label htmlFor="t-duration">Duration (minutes)</Label>
              <Input id="t-duration" ref={durationRef} type="number" min={5} max={300} value={f.duration_min} onChange={(e) => set("duration_min", Number(e.target.value))}
                     aria-invalid={errorField === "duration_min" ? "true" : undefined}
                     aria-describedby={errorField === "duration_min" ? "builder-error" : undefined} />
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
        </section>

        <section className="grid gap-3 hr-rule-b pb-6">
          <h3 className="hr-display text-[15px]">Languages and rules</h3>
          <fieldset>
            <legend className="hr-label mb-1.5">Languages</legend>
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
              Students may take this as practice (they see their score)
            </label>
            <label className="flex items-center gap-2">
              <Checkbox aria-label="One question at a time" checked={f.navigation === "linear"}
                        onCheckedChange={(c) => set("navigation", c === true ? "linear" : "free")} />
              One question at a time: students can't go back, and later questions aren't shown until they get there
            </label>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div>
              <Label htmlFor="t-overlap">Most two students may share (%)</Label>
              <Input id="t-overlap" type="number" min={1} max={100} value={f.max_overlap_pct}
                     onChange={(e) => set("max_overlap_pct", Number(e.target.value))} />
            </div>
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
              <p className="text-xs text-[var(--hr-muted)] mt-1">{POLICIES.find((p) => p.value === f.proctoring_policy)?.hint}</p>
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
          <h2 className="hr-display text-[18px]">Sections</h2>
          {f.sections.map((s, si) => (
            <SectionEditor key={si} index={si} section={s} bank={bank.data ?? []} languages={f.languages}
                           guaranteed={draw.guaranteed[si] ?? []} fixedAtRisk={draw.fixedAtRisk}
                           unavailable={bank.data ? s.question_ids.filter((id) => draw.unavailable.includes(id)) : []}
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

        {error && <p role="alert" id="builder-error" className="text-sm text-destructive">{error}</p>}
        <div className="flex gap-2">
          <Button onClick={submit} disabled={busy}>{busy ? "Saving…" : "Save test"}</Button>
          <Button variant="outline" asChild><Link to={`/assess/tests/${orgId}`}>Cancel</Link></Button>
        </div>
      </div>

      <aside className="lg:sticky lg:top-20 bg-[var(--hr-surface)] shadow-[inset_0_0_0_1px_var(--hr-rule)] px-5 py-4 grid gap-3">
        <h3 className="hr-label">Summary</h3>
        <div>
          <p className="hr-data text-2xl">{questionsPerCandidate}</p>
          <p className="text-xs text-[var(--hr-muted)]">questions per candidate</p>
        </div>
        <div>
          <p className="hr-data text-2xl">{f.duration_min}</p>
          <p className="text-xs text-[var(--hr-muted)]">minutes</p>
        </div>
        <PaperUniqueness cap={paperCapacity(bank.data ?? [], f.sections, f.languages, f.max_overlap_pct, batch, f.randomize)}
                         target={f.max_overlap_pct} batch={batch} onBatch={setBatch} loading={!bank.data} />
        {shortfalls.length > 0 && (
          <div className="grid gap-1">
            <p className="hr-label">Rule shortfalls</p>
            {shortfalls.map(({ si, ri, r, sure }) => (
              <p key={`${si}-${ri}`} className="text-xs text-[var(--hr-red-ink)]">
                Section {si + 1}, rule {ri + 1}: {describeRule(r)} (only {sure} certain)
              </p>
            ))}
          </div>
        )}
      </aside>
      </div>
    </V1Shell>
  );
}

function SectionEditor({ index, section, bank, languages, guaranteed, fixedAtRisk, unavailable, onChange, onRule, onRemove }: {
  index: number; section: SectionForm; bank: PoolRow[]; languages: string[]; guaranteed: number[]; fixedAtRisk: string[];
  /** This section's chosen ids the server can't serve any more (retired, back to draft, deleted). */
  unavailable: string[];
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
    <div className="border border-[var(--hr-rule)] bg-[var(--hr-surface)] p-4 grid gap-4" aria-label={`Section ${n}`} role="group">
      <div className="flex flex-wrap items-center justify-between gap-2 hr-rule-b pb-3">
        <div className="flex items-center gap-2">
          <span className="hr-label">Section {n}</span>
          <Chip tone="orange">{section.type === "coding" ? "Coding" : "MCQ"}</Chip>
        </div>
        {onRemove && <Button type="button" variant="ghost" size="sm" onClick={onRemove}>Remove section</Button>}
      </div>
      <div>
        <Label htmlFor={`s${n}-title`}>Section {n} title ({section.type === "coding" ? "coding" : "MCQ"})</Label>
        <Input id={`s${n}-title`} value={section.title} onChange={(e) => onChange({ title: e.target.value })} />
      </div>
      <div className="grid gap-2">
        <p className="hr-label">Pool rules</p>
        <div className="grid gap-0">
          {section.pick.map((r, ri) => {
            const available = poolMatches(bank, section.type, r, languages);
            const sure = guaranteed[ri] ?? available;
            const short = sure < r.count;
            return (
              <div key={ri} className={cn("grid grid-cols-[84px_140px_minmax(0,1fr)_auto] items-center gap-2 py-2.5", ri > 0 && "hr-rule-t")}>
                <Input aria-label={`Section ${n} rule ${ri + 1} count`} type="number" min={1} max={50} value={r.count}
                       onChange={(e) => onRule(ri, { count: Number(e.target.value) })} />
                <Select value={r.difficulty || "any"} onValueChange={(v) => onRule(ri, { difficulty: v === "any" ? "" : (v as PoolRule["difficulty"]) })}>
                  <SelectTrigger aria-label={`Section ${n} rule ${ri + 1} difficulty`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">Any difficulty</SelectItem>
                    {["easy", "medium", "hard"].map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Input aria-label={`Section ${n} rule ${ri + 1} topics`} placeholder="topics, comma separated (blank = any)"
                       value={r.topics} onChange={(e) => onRule(ri, { topics: e.target.value })} />
                <Button type="button" variant="ghost" size="sm" onClick={() => onChange({ pick: section.pick.filter((_, j) => j !== ri) })}>Remove</Button>
                <p className={cn("col-span-4 text-xs -mt-1", short ? "text-[var(--hr-red-ink)]" : "text-[var(--hr-muted)]")}>
                  {describeRule(r)} · {available} verified in bank{available < r.count ? " (not enough)"
                    : sure < r.count ? ` (only ${sure} certain: earlier rules or chosen questions can use the rest)` : ""}
                </p>
              </div>
            );
          })}
        </div>
        <Button type="button" variant="outline" size="sm" className="justify-self-start"
                onClick={() => onChange({ pick: [...section.pick, { difficulty: "", topics: "", count: 1 }] })}>Add rule</Button>
      </div>
      <div className="grid gap-2">
        <p className="hr-label">Always include these questions ({section.question_ids.length} chosen)</p>
        {unavailable.length > 0 && (
          <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-[var(--hr-red-ink)]">
            <span>
              {unavailable.length === 1 ? "1 chosen question is" : `${unavailable.length} chosen questions are`} no longer
              verified (retired, sent back to draft or deleted), so candidates wouldn't get {unavailable.length === 1 ? "it" : "them"}.
            </span>
            <Button type="button" size="sm" variant="outline"
                    onClick={() => onChange({ question_ids: section.question_ids.filter((id) => !unavailable.includes(id)) })}>
              Remove {unavailable.length === 1 ? "it" : "them"}
            </Button>
          </div>
        )}
        <Input aria-label={`Section ${n} search questions`} placeholder="Search verified questions" value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="max-h-48 overflow-y-auto border border-[var(--hr-rule)] p-2 grid gap-1">
          {pickable.length === 0 ? <p className="text-xs text-[var(--hr-muted)]">No verified {section.type === "coding" ? "coding" : "MCQ"} questions match.</p>
            : pickable.map((q) => (
              <label key={q.id} className="flex items-center gap-2 text-sm">
                <Checkbox aria-label={`Include ${q.title}`} checked={section.question_ids.includes(q.id)} onCheckedChange={(c) => toggle(q.id, c === true)} />
                <span>{q.title}</span>
                {section.question_ids.includes(q.id) && fixedAtRisk.includes(q.id)
                  && <span className="text-xs text-[var(--hr-red-ink)]">an earlier rule may draw this first</span>}
                <span className="text-xs text-[var(--hr-muted)] capitalize">{q.difficulty} · {q.topics.join(", ")}</span>
              </label>
            ))}
        </div>
      </div>
    </div>
  );
}

/** R2.1/R2.2: can this paper keep every pair of students under the overlap target for a batch this size? */
function PaperUniqueness({ cap, target, batch, onBatch, loading }: {
  cap: PaperCapacity; target: number; batch: number; onBatch: (n: number) => void; loading: boolean;
}) {
  const short = cap.rules.filter((r) => !r.ok);
  return (
    <section aria-label="Paper uniqueness" className="grid gap-1.5 hr-rule-t pt-3">
      <p className="hr-label">Different paper for each student</p>
      <label className="text-xs text-[var(--hr-muted)] flex items-center gap-2">
        Students in one drive
        <Input aria-label="Students in one drive" type="number" min={1} max={5000} value={batch} className="h-8 w-24"
               onChange={(e) => onBatch(Math.max(1, Number(e.target.value) || 1))} />
      </label>
      {loading ? <p className="text-xs text-[var(--hr-muted)]">Checking the question bank…</p> : (
        <>
          <p className={`text-sm ${cap.feasible ? "text-[var(--hr-gold)]" : "text-[var(--hr-red-ink)]"}`}>
            {cap.feasible ? `OK: papers overlap about ${cap.expectedOverlapPct}% on average (limit ${target}%).`
              : `Not enough questions to keep ${batch} papers under ${target}% overlap.`}
          </p>
          {!cap.fixed.ok && (
            <p className="text-xs text-[var(--hr-red-ink)]">
              {cap.fixed.count} hand-picked question{cap.fixed.count === 1 ? " is" : "s are"} in every paper ({cap.fixed.sharedPct}% of it). Use pick rules instead.
            </p>
          )}
          {short.map((r) => (
            <p key={`${r.section}-${r.rule}`} className="text-xs text-[var(--hr-red-ink)]">
              Section {r.section + 1}, {r.label}: {r.pool} in bank, about {r.needed} needed
            </p>
          ))}
          {!cap.feasible && <p className="text-xs text-[var(--hr-muted)]">A drive using this test can't be scheduled for that many students until the bank grows, unless HiResume approves an exception.</p>}
        </>
      )}
    </section>
  );
}
