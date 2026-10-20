// Create / edit a role: paste a JD → AI suggests a skills matrix (recruiter edits it) → coding test, AI interview,
// proctoring policy (default Maximum), hiring managers, status. Saved through RLS (job_roles).
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { b2bDb } from "@/features/b2b/lib/db";
import { Loading } from "../layout/V1Shell";
import { companyApi } from "../lib/api";
import { CheckChip, NativeSelect, toggle } from "../college/CollegeShell";
import { DEFAULT_INTERVIEW_CONFIG, InterviewConfig } from "../../../supabase/functions/_shared/contracts/company";
import type { ProctoringPolicyV1 } from "../types";
import { CompanyShell } from "./CompanyShell";
import { addSkill, emptyMatrix, fromMatrix, matrixErrors, removeSkill, SENIORITY, toMatrix, updateSkill, type MatrixForm, type Seniority } from "./lib/matrix";
import { friendlyError, useCompanyAssessments, useRole, useTeam, type JobRoleRecord } from "./queries";

const SECTIONS: { value: InterviewConfig["sections"][number]; label: string }[] = [
  { value: "intro", label: "Intro" }, { value: "technical", label: "Technical" }, { value: "problem_solving", label: "Problem solving" },
  { value: "behavioral", label: "Behavioural" }, { value: "code_walkthrough", label: "Code walkthrough" },
  { value: "candidate_questions", label: "Candidate questions" }, { value: "close", label: "Close" },
];
const POLICIES: { value: ProctoringPolicyV1; label: string }[] = [
  { value: "maximum", label: "Maximum: pause the session on a hard violation (recommended)" },
  { value: "strict", label: "Strict: warnings, auto-submit after repeated violations" },
  { value: "standard", label: "Standard: log and warn, never interrupt" },
  { value: "off", label: "Off: no proctoring" },
];

export default function RoleFormPage() {
  const { roleId } = useParams();
  const role = useRole(roleId);
  return (
    <CompanyShell>
      {({ orgId, isEditor }) => !isEditor ? <p className="text-sm">Only recruiters and company admins can edit roles.</p>
        : roleId && role.isLoading ? <Loading />
        : <RoleForm orgId={orgId} role={role.data ?? null} />}
    </CompanyShell>
  );
}

export function RoleForm({ orgId, role }: { orgId: string; role: JobRoleRecord | null }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const assessments = useCompanyAssessments(orgId);
  const team = useTeam(orgId);
  const [title, setTitle] = useState(role?.title ?? "");
  const [jd, setJd] = useState(role?.jd_text ?? "");
  const [matrix, setMatrix] = useState<MatrixForm>(role ? fromMatrix(role.skills_matrix as never) : emptyMatrix());
  const [assessmentId, setAssessmentId] = useState(role?.assessment_id ?? "");
  const [iv, setIv] = useState<InterviewConfig>(role?.interview_config ?? DEFAULT_INTERVIEW_CONFIG);
  const [policy, setPolicy] = useState<ProctoringPolicyV1>(role?.proctoring_policy ?? "maximum");
  const [expiry, setExpiry] = useState(String(role?.invite_expiry_days ?? 7));
  const [status, setStatus] = useState<JobRoleRecord["status"]>(role?.status ?? "draft");
  const [hms, setHms] = useState<string[]>(role?.hiring_manager_ids ?? []);
  const [extracting, setExtracting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const managers = (team.data?.members ?? []).filter((m) => m.role === "hiring_manager");
  const mErrors = matrixErrors(matrix);
  const hasStep = !!assessmentId || iv.enabled;

  async function extract() {
    setError(null); setNotice(null);
    if (jd.trim().length < 80) { setError("Paste the full job description (at least 80 characters)."); return; }
    setExtracting(true);
    try {
      const r = await companyApi("skillsFromJd", { orgId, jd });
      setMatrix(fromMatrix(r.skills));
      setNotice("Skills suggested by AI from the JD. Check and edit them; you decide what matters.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read the JD.");
    } finally {
      setExtracting(false);
    }
  }

  async function save() {
    setError(null);
    if (title.trim().length < 2) { setError("Give the role a title."); return; }
    if (mErrors.length) { setError(mErrors[0]); return; }
    if (status === "open" && !hasStep) { setError("An open role needs a coding test or the AI interview."); return; }
    const parsedIv = InterviewConfig.safeParse(iv);
    if (!parsedIv.success) { setError("Pick at least one interview section."); return; }
    const row = {
      org_id: orgId, title: title.trim(), jd_text: jd.trim() || null, skills_matrix: toMatrix(matrix),
      assessment_id: assessmentId || null, interview_config: parsedIv.data, proctoring_policy: policy,
      invite_expiry_days: Math.min(60, Math.max(1, Number(expiry) || 7)), status, hiring_manager_ids: hms,
    };
    setSaving(true);
    try {
      const res = role
        ? await b2bDb.from("job_roles").update(row).eq("id", role.id).select("id").single()
        : await b2bDb.from("job_roles").insert(row).select("id").single();
      if (res.error) throw new Error(res.error.message);
      await qc.invalidateQueries({ queryKey: ["b2b-company"] });
      navigate(`/co/${orgId}/roles/${(res.data as { id: string }).id}`);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-8">
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{role ? "Edit role" : "New role from a job description"}</h2>
        <div className="space-y-1">
          <Label htmlFor="role-title">Role title</Label>
          <Input id="role-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Backend engineer" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="role-jd">Job description</Label>
          <Textarea id="role-jd" rows={8} value={jd} onChange={(e) => setJd(e.target.value)} placeholder="Paste the full JD here" />
          <div className="flex items-center gap-3">
            <Button type="button" variant="outline" onClick={extract} disabled={extracting}>
              {extracting ? "Reading the JD…" : "Suggest skills from the JD"}
            </Button>
            <span className="text-xs text-muted-foreground">AI suggestion; you edit and decide.</span>
          </div>
        </div>
      </section>

      <section className="space-y-3" aria-label="Skills matrix">
        <h3 className="font-semibold">Skills matrix</h3>
        {notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
        {(["must", "nice"] as const).map((kind) => (
          <div key={kind} className="space-y-2">
            <p className="text-sm font-medium">{kind === "must" ? "Must-have" : "Nice-to-have"}</p>
            {matrix.rows.filter((r) => r.kind === kind).map((r) => (
              <div key={r.key} className="flex items-center gap-2">
                <Input aria-label={`${kind === "must" ? "Must-have" : "Nice-to-have"} skill`} value={r.skill} className="flex-1"
                       onChange={(e) => setMatrix(updateSkill(matrix, r.key, { skill: e.target.value }))} />
                <Input aria-label={`Weight for ${r.skill || "skill"}`} type="number" min={1} max={5} className="w-20" value={r.weight}
                       onChange={(e) => setMatrix(updateSkill(matrix, r.key, { weight: Number(e.target.value) }))} />
                <NativeSelect aria-label={`Type of ${r.skill || "skill"}`} className="w-36" value={r.kind}
                              onChange={(e) => setMatrix(updateSkill(matrix, r.key, { kind: e.target.value as "must" | "nice" }))}>
                  <option value="must">Must-have</option><option value="nice">Nice-to-have</option>
                </NativeSelect>
                <Button type="button" variant="ghost" size="sm" aria-label={`Remove ${r.skill || "skill"}`} onClick={() => setMatrix(removeSkill(matrix, r.key))}>Remove</Button>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={() => setMatrix(addSkill(matrix, kind))}>
              Add {kind === "must" ? "must-have" : "nice-to-have"} skill
            </Button>
          </div>
        ))}
        <p className="text-xs text-muted-foreground">Weight 1–5: how central the skill is. Must-haves count double in the AI match score.</p>
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="role-seniority">Seniority</Label>
            <NativeSelect id="role-seniority" value={matrix.seniority} onChange={(e) => setMatrix({ ...matrix, seniority: e.target.value as Seniority })}>
              {SENIORITY.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </NativeSelect>
          </div>
        </div>
        {mErrors.length > 0 && matrix.rows.length > 0 && <p className="text-sm text-destructive">{mErrors[0]}</p>}
      </section>

      <section className="space-y-3">
        <h3 className="font-semibold">Coding test</h3>
        <NativeSelect aria-label="Coding test" value={assessmentId} onChange={(e) => setAssessmentId(e.target.value)}>
          <option value="">No coding test</option>
          {(assessments.data ?? []).map((a) => <option key={a.id} value={a.id}>{a.title}{a.status !== "ready" ? " (draft)" : ""}</option>)}
        </NativeSelect>
        <p className="text-sm text-muted-foreground">
          Pick a test, or <Link className="underline" to={`/assess/tests/${orgId}`}>build one</Link> from the question bank (or generate questions with AI).
        </p>
      </section>

      <section className="space-y-3">
        <h3 className="font-semibold">AI interview</h3>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={iv.enabled} onChange={(e) => setIv({ ...iv, enabled: e.target.checked })} /> Include an AI interview
        </label>
        {iv.enabled && (
          <div className="space-y-3">
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="iv-duration">Duration (minutes)</Label>
                <Input id="iv-duration" type="number" min={5} max={90} value={iv.duration_min}
                       onChange={(e) => setIv({ ...iv, duration_min: Math.round(Number(e.target.value) || 20) })} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="iv-difficulty">Difficulty</Label>
                <NativeSelect id="iv-difficulty" value={iv.difficulty} onChange={(e) => setIv({ ...iv, difficulty: e.target.value as InterviewConfig["difficulty"] })}>
                  <option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option>
                </NativeSelect>
              </div>
            </div>
            <div className="flex flex-wrap gap-2" aria-label="Interview sections">
              {SECTIONS.map((s) => <CheckChip key={s.value} label={s.label} checked={iv.sections.includes(s.value)}
                onChange={(on) => setIv({ ...iv, sections: toggle(iv.sections, s.value, on) })} />)}
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={iv.code_walkthrough} onChange={(e) => setIv({ ...iv, code_walkthrough: e.target.checked })} />
              Ask the candidate to walk through their coding submission
            </label>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h3 className="font-semibold">Proctoring and invites</h3>
        <div className="space-y-1">
          <Label htmlFor="role-policy">Proctoring policy</Label>
          <NativeSelect id="role-policy" value={policy} onChange={(e) => setPolicy(e.target.value as ProctoringPolicyV1)}>
            {POLICIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </NativeSelect>
          <p className="text-xs text-muted-foreground">AI proctoring flags evidence for your team to review; it never fails a candidate on its own.</p>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="role-expiry">Invite links valid for (days)</Label>
            <Input id="role-expiry" type="number" min={1} max={60} value={expiry} onChange={(e) => setExpiry(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="role-status">Status</Label>
            <NativeSelect id="role-status" value={status} onChange={(e) => setStatus(e.target.value as JobRoleRecord["status"])}>
              <option value="draft">Draft</option><option value="open">Open (candidates can be invited)</option><option value="closed">Closed</option>
            </NativeSelect>
          </div>
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="font-semibold">Hiring managers</h3>
        {managers.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hiring managers on the team yet. Invite them from Credits &amp; team.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {managers.map((m) => <CheckChip key={m.user_id} label={m.full_name || m.email || "Hiring manager"} checked={hms.includes(m.user_id)}
              onChange={(on) => setHms(toggle(hms, m.user_id, on))} />)}
          </div>
        )}
        <p className="text-xs text-muted-foreground">Hiring managers see only the roles they're assigned to. They can read reports, comment and record decisions.</p>
      </section>

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button onClick={save} disabled={saving}>{saving ? "Saving…" : role ? "Save role" : "Create role"}</Button>
        <Button variant="outline" asChild><Link to={role ? `/co/${orgId}/roles/${role.id}` : `/co/${orgId}/roles`}>Cancel</Link></Button>
      </div>
    </div>
  );
}
