import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowLeft, ArrowUp, Loader2, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { CenteredSpinner, EmptyState } from "../components/B2BShell";
import { useOrgContext } from "../components/OrgContext";
import { useOrgModules, useOrgUsageSummary } from "../hooks/useB2B";
import { b2bDb } from "../lib/db";
import { friendlyDbError } from "../lib/format";
import {
  COMPANY_PACK_DISCLAIMER, MODULE_LIMITS, MODULE_TYPE_LABEL, emptyModuleSpec, normalizeModuleSpec,
  type ModuleErrors, type ModuleSpec, type ModuleType,
} from "../lib/shared";

type Draft = Omit<ModuleSpec, "pass_threshold" | "max_turns" | "max_minutes"> & {
  pass_threshold: string; max_turns: string; max_minutes: string;
};

const toDraft = (s: ModuleSpec): Draft => ({
  ...s, description: s.description ?? "", style_notes: s.style_notes ?? "",
  pass_threshold: String(s.pass_threshold), max_turns: String(s.max_turns), max_minutes: String(s.max_minutes),
});

/** /org/:orgId/modules/new and /org/:orgId/modules/:moduleId */
export default function ModuleEditor() {
  const { org, canManage } = useOrgContext();
  const { moduleId } = useParams();
  const isNew = !moduleId || moduleId === "new";
  const q = useOrgModules(org.id);
  const usage = useOrgUsageSummary(org.id);
  const { user } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { toast } = useToast();

  const existing = isNew ? undefined : q.data?.own.find((m) => m.id === moduleId);
  const [draft, setDraft] = useState<Draft | null>(isNew ? toDraft(emptyModuleSpec()) : null);
  const [topicInput, setTopicInput] = useState("");
  const [errors, setErrors] = useState<ModuleErrors>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isNew && existing && !draft) setDraft(toDraft(existing.spec));
  }, [existing, isNew, draft]);

  if (!canManage) return <Navigate to={`/org/${org.id}/modules`} replace />;
  if (q.isLoading) return <CenteredSpinner />;
  if (!isNew && !existing) return <EmptyState title="Module not found" body="It may belong to another institution." />;
  if (!draft) return <CenteredSpinner />;

  const packsAllowed = usage.data?.plan.company_packs_enabled ?? false;
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => {
    setDraft({ ...draft, [k]: v });
    if (errors[k as keyof ModuleErrors]) setErrors({ ...errors, [k]: undefined });
  };

  const addTopics = () => {
    // Paste-friendly: "Joins, Subqueries; Indexes" or one per line.
    const parts = topicInput.split(/[\n,;]+/).map((t) => t.trim()).filter(Boolean);
    if (!parts.length) return;
    const seen = new Set(draft.topics.map((t) => t.toLowerCase()));
    const fresh = parts.filter((t) => {
      const k = t.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    set("topics", [...draft.topics, ...fresh].slice(0, MODULE_LIMITS.topics[1]));
    setTopicInput("");
  };
  const moveTopic = (i: number, d: -1 | 1) => {
    const t = [...draft.topics];
    [t[i], t[i + d]] = [t[i + d], t[i]];
    set("topics", t);
  };

  const save = async () => {
    const { spec, errors: errs } = normalizeModuleSpec({
      ...draft,
      pass_threshold: draft.pass_threshold === "" ? NaN : Number(draft.pass_threshold),
      max_turns: draft.max_turns === "" ? NaN : Number(draft.max_turns),
      max_minutes: draft.max_minutes === "" ? NaN : Number(draft.max_minutes),
    });
    if (!spec) {
      setErrors(errs);
      return;
    }
    setSaving(true);
    const { error } = isNew
      ? await b2bDb.from("interview_modules").insert({ org_id: org.id, spec, created_by: user?.id })
      : await b2bDb.from("interview_modules").update({ spec }).eq("id", existing!.id);
    setSaving(false);
    if (error) {
      toast({ title: "Couldn't save module", description: friendlyDbError(error), variant: "destructive" });
      return;
    }
    toast({ title: isNew ? "Module created" : "Module saved", description: isNew ? "Students can see it now." : "New interviews will use this version." });
    await qc.invalidateQueries({ queryKey: ["b2b"] });
    navigate(`/org/${org.id}/modules`);
  };

  const err = (k: keyof ModuleErrors) =>
    errors[k] ? <p className="text-xs text-red-300 mt-1" role="alert">{errors[k]}</p> : null;
  const turns = Number(draft.max_turns);
  const minutes = Number(draft.max_minutes);
  const perQ = turns > 0 && minutes > 0 ? Math.round((minutes * 60) / turns) : null;

  return (
    <div className="max-w-2xl space-y-5">
      <Link to={`/org/${org.id}/modules`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Modules
      </Link>
      <h2 className="text-lg font-semibold">{isNew ? "New module" : `Edit ${existing!.name}`}</h2>
      {!isNew && existing?.template_id && (
        <p className="text-xs text-muted-foreground">Copied from the HiResume library. Changes only affect your institution.</p>
      )}

      <div className="grid sm:grid-cols-[1fr,220px] gap-3">
        <div>
          <Label htmlFor="m-name">Name</Label>
          <Input id="m-name" value={draft.name} onChange={(e) => set("name", e.target.value)} maxLength={MODULE_LIMITS.name[1]} placeholder="e.g. Spring Boot Basics" />
          {err("name")}
        </div>
        <div>
          <Label htmlFor="m-type">Type</Label>
          <Select value={draft.type} onValueChange={(v) => set("type", v as ModuleType)}>
            <SelectTrigger id="m-type"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="skill">{MODULE_TYPE_LABEL.skill}</SelectItem>
              <SelectItem value="hr">{MODULE_TYPE_LABEL.hr}</SelectItem>
              <SelectItem value="company_pack" disabled={!packsAllowed}>
                {MODULE_TYPE_LABEL.company_pack}{packsAllowed ? "" : " (Pilot / Pro)"}
              </SelectItem>
            </SelectContent>
          </Select>
          {err("type")}
        </div>
      </div>
      {draft.type === "company_pack" && <p className="text-xs text-amber-200/90">{COMPANY_PACK_DISCLAIMER} Don't use the company's logo or call it an official test.</p>}

      <div>
        <Label htmlFor="m-desc">Short description <span className="text-muted-foreground font-normal">(shown to students)</span></Label>
        <Input id="m-desc" value={draft.description} onChange={(e) => set("description", e.target.value)} maxLength={MODULE_LIMITS.description} />
        {err("description")}
      </div>

      <div>
        <Label htmlFor="m-topic">Topics <span className="text-muted-foreground font-normal">({draft.topics.length}/{MODULE_LIMITS.topics[1]}) — the interviewer stays strictly within these</span></Label>
        <div className="flex gap-2 mt-1">
          <Input
            id="m-topic"
            value={topicInput}
            onChange={(e) => setTopicInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTopics(); } }}
            placeholder="Type a topic and press Enter (or paste a comma-separated list)"
            disabled={draft.topics.length >= MODULE_LIMITS.topics[1]}
          />
          <Button type="button" variant="secondary" onClick={addTopics} aria-label="Add topic"><Plus className="h-4 w-4" /></Button>
        </div>
        {draft.topics.length > 0 && (
          <ol className="mt-2 space-y-1">
            {draft.topics.map((t, i) => (
              <li key={t} className="flex items-center gap-2 rounded-md border border-border/60 px-2 py-1 text-sm">
                <span className="text-muted-foreground tabular-nums w-5">{i + 1}.</span>
                <span className="flex-1">{t}</span>
                <button type="button" onClick={() => moveTopic(i, -1)} disabled={i === 0} className="p-1 text-muted-foreground disabled:opacity-30" aria-label={`Move ${t} up`}><ArrowUp className="h-3.5 w-3.5" /></button>
                <button type="button" onClick={() => moveTopic(i, 1)} disabled={i === draft.topics.length - 1} className="p-1 text-muted-foreground disabled:opacity-30" aria-label={`Move ${t} down`}><ArrowDown className="h-3.5 w-3.5" /></button>
                <button type="button" onClick={() => set("topics", draft.topics.filter((_, j) => j !== i))} className="p-1 text-muted-foreground hover:text-red-300" aria-label={`Remove ${t}`}><X className="h-3.5 w-3.5" /></button>
              </li>
            ))}
          </ol>
        )}
        {err("topics")}
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <Label htmlFor="m-turns">Questions</Label>
          <Input id="m-turns" type="number" inputMode="numeric" min={MODULE_LIMITS.maxTurns[0]} max={MODULE_LIMITS.maxTurns[1]} value={draft.max_turns} onChange={(e) => set("max_turns", e.target.value)} />
          {err("max_turns")}
        </div>
        <div>
          <Label htmlFor="m-min">Minutes</Label>
          <Input id="m-min" type="number" inputMode="numeric" min={MODULE_LIMITS.maxMinutes[0]} max={MODULE_LIMITS.maxMinutes[1]} value={draft.max_minutes} onChange={(e) => set("max_minutes", e.target.value)} />
          {err("max_minutes")}
        </div>
        <div>
          <Label htmlFor="m-pass">Pass mark (0–10)</Label>
          <Input id="m-pass" type="number" inputMode="decimal" step={0.5} min={0} max={10} value={draft.pass_threshold} onChange={(e) => set("pass_threshold", e.target.value)} />
          {err("pass_threshold")}
        </div>
      </div>
      {perQ !== null && <p className="text-xs text-muted-foreground -mt-3">About {perQ >= 60 ? `${Math.round(perQ / 6) / 10} min` : `${perQ} s`} per question. The interview ends at whichever limit comes first.</p>}

      <div>
        <Label htmlFor="m-style">Interviewer style notes <span className="text-muted-foreground font-normal">(optional)</span></Label>
        <Textarea
          id="m-style"
          rows={5}
          value={draft.style_notes}
          onChange={(e) => set("style_notes", e.target.value)}
          maxLength={MODULE_LIMITS.styleNotes}
          placeholder="e.g. Fresher level. Ask for real-world examples. Describe a small table and ask for the SQL query aloud."
        />
        <p className="text-xs text-muted-foreground mt-1 text-right tabular-nums">{draft.style_notes?.length ?? 0}/{MODULE_LIMITS.styleNotes}</p>
        {err("style_notes")}
      </div>

      {errors.form && <p className="text-sm text-red-300" role="alert">{errors.form}</p>}
      <div className="flex gap-2">
        <Button onClick={save} disabled={saving}>
          {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} {isNew ? "Create module" : "Save changes"}
        </Button>
        <Button variant="ghost" asChild><Link to={`/org/${org.id}/modules`}>Cancel</Link></Button>
      </div>
    </div>
  );
}
