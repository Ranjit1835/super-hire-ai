import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { b2bDb } from "@/features/b2b/lib/db";
import { Loading } from "../layout/V1Shell";
import { collegeApi, ApiError } from "../lib/api";
import type { ProctoringPolicyV1, ResultsReleaseV1 } from "../types";
import type { ContractOutput } from "../../../supabase/functions/_shared/contracts/common";
import type { collegeContract } from "../../../supabase/functions/_shared/contracts/college";
import { CheckChip, CollegeShell, NativeSelect, toggle } from "./CollegeShell";
import { emptyEligibility, fromEligibility, toEligibility, type EligibilityForm } from "./lib/filters";
import { friendly, useAssessments, useDrive, useInterviewModules, useStudentFacets, type DriveRecord } from "./queries";

export default function DriveFormPage() {
  const { driveId } = useParams();
  return <CollegeShell>{({ orgId }) => <DriveFormLoader orgId={orgId} driveId={driveId} />}</CollegeShell>;
}

function DriveFormLoader({ orgId, driveId }: { orgId: string; driveId?: string }) {
  const drive = useDrive(driveId);
  if (driveId && drive.isLoading) return <Loading />;
  return <DriveForm orgId={orgId} drive={drive.data ?? null} />;
}

const POLICY_TEXT: Record<ProctoringPolicyV1, string> = {
  off: "Off (no proctoring)", standard: "Standard: flags for review, never stops the test",
  strict: "Strict: repeated violations end the test", maximum: "Maximum: pauses on violations",
};

/** datetime-local value in the browser's zone ⇄ ISO. */
const toLocal = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const fromLocal = (v: string) => (v ? new Date(v).toISOString() : null);

export function DriveForm({ orgId, drive }: { orgId: string; drive: DriveRecord | null }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const assessments = useAssessments(orgId);
  const modules = useInterviewModules(orgId);
  const facets = useStudentFacets(orgId);
  const [name, setName] = useState(drive?.name ?? "");
  const [description, setDescription] = useState(drive?.description ?? "");
  const [assessmentId, setAssessmentId] = useState(drive?.assessment_id ?? "");
  const [moduleId, setModuleId] = useState(drive?.interview_module_id ?? "");
  const [resumeTask, setResumeTask] = useState(drive?.resume_task ?? false);
  const [elig, setElig] = useState<EligibilityForm>(drive ? fromEligibility(drive.eligibility) : emptyEligibility);
  const [start, setStart] = useState(toLocal(drive?.window_start ?? null));
  const [end, setEnd] = useState(toLocal(drive?.window_end ?? null));
  const [policy, setPolicy] = useState<ProctoringPolicyV1>(drive?.proctoring_policy ?? "standard");
  const [release, setRelease] = useState<ResultsReleaseV1>(drive?.results_release ?? "manual");
  const [preview, setPreview] = useState<ContractOutput<typeof collegeContract, "previewEligibility"> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Eligibility changed → the old preview no longer applies.
  useEffect(() => { setPreview(null); }, [elig]);

  const checkEligible = async () => {
    setError(null);
    try {
      setPreview(await collegeApi("previewEligibility", { orgId, eligibility: toEligibility(elig) }));
    } catch (e) { setError(e instanceof ApiError ? e.message : friendly(e)); }
  };

  const save = async () => {
    setError(null);
    if (name.trim().length < 3) { setError("Give the drive a name (at least 3 characters)."); return; }
    if (!assessmentId && !moduleId && !resumeTask) { setError("Pick a test, an interview or the resume task (or a mix)."); return; }
    if (start && end && new Date(end) <= new Date(start)) { setError("The window must end after it starts."); return; }
    const row = {
      name: name.trim(), description: description.trim() || null, assessment_id: assessmentId || null,
      interview_module_id: moduleId || null, resume_task: resumeTask, eligibility: toEligibility(elig),
      window_start: fromLocal(start), window_end: fromLocal(end), proctoring_policy: policy, results_release: release,
    };
    setBusy(true);
    const res = drive
      ? await b2bDb.from("drives").update(row).eq("id", drive.id).select("id").single()
      : await b2bDb.from("drives").insert({ ...row, org_id: orgId }).select("id").single();
    setBusy(false);
    if (res.error) { setError(friendly(res.error)); return; }
    void qc.invalidateQueries({ queryKey: ["b2b-college"] });
    navigate(`/c/${orgId}/drives/${(res.data as { id: string }).id}`);
  };

  const set = (patch: Partial<EligibilityForm>) => setElig((e) => ({ ...e, ...patch }));

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold">{drive ? "Edit drive" : "New drive"}</h2>
        <Link to={drive ? `/c/${orgId}/drives/${drive.id}` : `/c/${orgId}/drives`} className="text-sm underline">Cancel</Link>
      </div>

      <section className="space-y-3">
        <div className="space-y-1"><Label htmlFor="d-name">Name</Label>
          <Input id="d-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. CSE 2027 placement test" /></div>
        <div className="space-y-1"><Label htmlFor="d-desc">Note for students (optional)</Label>
          <Textarea id="d-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} /></div>
      </section>

      <section className="space-y-3">
        <h3 className="font-medium">What students do</h3>
        <div className="space-y-1"><Label htmlFor="d-assess">Coding / MCQ test</Label>
          <NativeSelect id="d-assess" value={assessmentId} onChange={(e) => setAssessmentId(e.target.value)}>
            <option value="">No test</option>
            {assessments.data?.map((a) => <option key={a.id} value={a.id}>{a.title}{a.status === "draft" ? " (draft)" : ""}</option>)}
          </NativeSelect></div>
        <div className="space-y-1"><Label htmlFor="d-module">AI interview</Label>
          <NativeSelect id="d-module" value={moduleId} onChange={(e) => setModuleId(e.target.value)}>
            <option value="">No interview</option>
            {modules.data?.map((m) => <option key={m.id} value={m.id}>{m.name}{m.org_id ? "" : " (library)"}</option>)}
          </NativeSelect></div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={resumeTask} onChange={(e) => setResumeTask(e.target.checked)} /> Resume task (students submit a resume for review)
        </label>
      </section>

      <section className="space-y-3">
        <h3 className="font-medium">Who can take it</h3>
        {facets.data?.departments.length ? (
          <div className="space-y-1"><p className="text-sm">Branch</p>
            <div className="flex flex-wrap gap-2">{facets.data.departments.map((d) => (
              <CheckChip key={d} label={d} checked={elig.departments.includes(d)} onChange={(on) => set({ departments: toggle(elig.departments, d, on) })} />
            ))}</div></div>
        ) : null}
        {facets.data?.batchYears.length ? (
          <div className="space-y-1"><p className="text-sm">Batch</p>
            <div className="flex flex-wrap gap-2">{facets.data.batchYears.map((y) => (
              <CheckChip key={y} label={String(y)} checked={elig.batchYears.includes(y)} onChange={(on) => set({ batchYears: toggle(elig.batchYears, y, on) })} />
            ))}</div></div>
        ) : null}
        <div className="grid sm:grid-cols-3 gap-3">
          <div className="space-y-1"><Label htmlFor="e-sec">Sections (comma-separated)</Label>
            <Input id="e-sec" value={elig.sections} onChange={(e) => set({ sections: e.target.value })} placeholder="All" /></div>
          <div className="space-y-1"><Label htmlFor="e-cgpa">Minimum CGPA</Label>
            <Input id="e-cgpa" inputMode="decimal" value={elig.minCgpa} onChange={(e) => set({ minCgpa: e.target.value })} placeholder="Any" /></div>
          <div className="space-y-1"><Label htmlFor="e-back">Most active backlogs allowed</Label>
            <Input id="e-back" inputMode="numeric" value={elig.maxBacklogs} onChange={(e) => set({ maxBacklogs: e.target.value })} placeholder="Any" /></div>
          <div className="space-y-1"><Label htmlFor="e-10">Minimum 10th %</Label>
            <Input id="e-10" inputMode="decimal" value={elig.minTenth} onChange={(e) => set({ minTenth: e.target.value })} placeholder="Any" /></div>
          <div className="space-y-1"><Label htmlFor="e-12">Minimum 12th %</Label>
            <Input id="e-12" inputMode="decimal" value={elig.minTwelfth} onChange={(e) => set({ minTwelfth: e.target.value })} placeholder="Any" /></div>
        </div>
        <div className="flex items-center gap-3">
          <Button type="button" variant="outline" onClick={() => void checkEligible()}>Check who is eligible</Button>
          {preview && (
            <p className="text-sm" role="status">
              <b>{preview.count}</b> eligible students{preview.sample.length ? `, e.g. ${preview.sample.slice(0, 5).map((s) => `${s.full_name} (${s.roll_no})`).join(", ")}` : ""}.
            </p>
          )}
        </div>
        <p className="text-xs text-muted-foreground">A blank backlog cell in your sheet counts as 0. Students without a CGPA or a mark don't meet a minimum. Deactivated students and students under 18 are never included.</p>
      </section>

      <section className="space-y-3">
        <h3 className="font-medium">When and how</h3>
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="space-y-1"><Label htmlFor="d-start">Opens</Label><Input id="d-start" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} /></div>
          <div className="space-y-1"><Label htmlFor="d-end">Closes</Label><Input id="d-end" type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} /></div>
        </div>
        <div className="space-y-1"><Label htmlFor="d-policy">Proctoring</Label>
          <NativeSelect id="d-policy" value={policy} onChange={(e) => setPolicy(e.target.value as ProctoringPolicyV1)}>
            {(Object.keys(POLICY_TEXT) as ProctoringPolicyV1[]).map((p) => <option key={p} value={p}>{POLICY_TEXT[p]}</option>)}
          </NativeSelect></div>
        <div className="space-y-1"><Label htmlFor="d-release">Results for students</Label>
          <NativeSelect id="d-release" value={release} onChange={(e) => setRelease(e.target.value as ResultsReleaseV1)}>
            <option value="manual">Show when I release them</option>
            <option value="immediate">Show as soon as they finish</option>
            <option value="never">Never show (placement office only)</option>
          </NativeSelect></div>
      </section>

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button onClick={() => void save()} disabled={busy}>{busy ? "Saving…" : drive ? "Save changes" : "Create drive"}</Button>
    </div>
  );
}
