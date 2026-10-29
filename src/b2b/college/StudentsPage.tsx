import { useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { b2bDb } from "@/features/b2b/lib/db";
import { Loading, Empty } from "../layout/V1Shell";
import { Chip, type Tone } from "../ui/broadcast";
import { collegeApi, ApiError } from "../lib/api";
import { CollegeShell, NativeSelect } from "./CollegeShell";
import { InviteLinks, type InviteLinkRow } from "./InviteLinks";
import { parseDob } from "./lib/import";
import { STATUS_TEXT, STUDENT_PAGE, friendly, numOrNull, useStudentFacets, useStudentStatusCounts, useStudents, type StudentQuery, type StudentRecord, type StudentStatus } from "./queries";

export default function StudentsPage() {
  return <CollegeShell>{({ orgId, isAdmin }) => <Students orgId={orgId} isAdmin={isAdmin} />}</CollegeShell>;
}

const STATUS_TONE: Record<StudentStatus, Tone> = {
  imported: "muted", invited: "blue", active: "gold", deactivated: "muted", held_minor: "red",
};

const STATUS_TABS: StudentStatus[] = ["active", "invited", "imported", "held_minor", "deactivated"];
const STATUS_TAB_LABEL: Partial<Record<StudentStatus, string>> = { held_minor: "Held" };

function Students({ orgId, isAdmin }: { orgId: string; isAdmin: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [q, setQ] = useState<StudentQuery>({ search: "", department: "", batchYear: "", status: "", page: 1 });
  const students = useStudents(orgId, q);
  const facets = useStudentFacets(orgId);
  const counts = useStudentStatusCounts(orgId);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<StudentRecord | "new" | null>(null);
  const [links, setLinks] = useState<{ links: InviteLinkRow[]; emailed: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  const set = (patch: Partial<StudentQuery>) => { setQ((cur) => ({ ...cur, page: 1, ...patch })); setSelected(new Set()); };
  const refresh = () => void qc.invalidateQueries({ queryKey: ["b2b-college"] });
  const data = students.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / STUDENT_PAGE)) : 1;
  const invitable = (s: StudentRecord) => s.status === "imported" || s.status === "invited";

  const invite = async (ids: string[]) => {
    setBusy(true);
    try {
      const r = await collegeApi("inviteStudents", { orgId, studentIds: ids });
      setLinks({ links: r.links, emailed: r.queued });
      toast({ title: `${r.links.length} invites created`, description: r.skipped.length ? `${r.skipped.length} skipped (already active, held or deactivated)` : undefined });
      setSelected(new Set());
      refresh();
    } catch (e) {
      toast({ title: "Couldn't send invites", description: e instanceof ApiError ? e.message : friendly(e), variant: "destructive" });
    } finally { setBusy(false); }
  };

  const setStatus = async (s: StudentRecord, status: StudentStatus) => {
    const { error } = await b2bDb.from("students").update({ status }).eq("id", s.id);
    if (error) toast({ title: "Couldn't update", description: friendly(error), variant: "destructive" });
    else {
      const { data } = await b2bDb.from("students").select("status").eq("id", s.id).single();
      const now = (data as { status?: string } | null)?.status;
      toast({ title: now === "held_minor" ? `${s.full_name} is still under 18 and stays on hold`
        : status === "deactivated" ? `${s.full_name} deactivated` : `${s.full_name} restored` });
      refresh();
    }
  };

  const c = counts.data;
  const total0 = c ? c.active + c.invited + c.imported + c.held_minor + c.deactivated : undefined;
  const otherFiltered = !!(q.search || q.department || q.batchYear);
  const clearOthers = () => set({ search: "", department: "", batchYear: "" });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="hr-display text-[22px]">Roster</h2>
          <p className="text-sm text-[var(--hr-muted)] mt-1.5">Every student imported for this college, across every batch and branch.</p>
          <p className="hr-data text-sm text-foreground mt-1.5">{total0 ?? "–"} students</p>
        </div>
        {isAdmin && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setEditing("new")}><Plus className="h-4 w-4 mr-1" />Add student</Button>
            <Button asChild><Link to={`/c/${orgId}/students/import`}><Upload className="h-4 w-4 mr-1" />Import</Link></Button>
          </div>
        )}
      </div>

      {/* Decision D4: status is a tab bar with counts; search, branch and batch sit behind one Filters button. */}
      <div className="flex flex-wrap items-end gap-x-2 gap-y-2 hr-rule-b">
        <div role="tablist" aria-label="Status" className="flex items-stretch overflow-x-auto -mb-px">
          {[{ key: "" as const, label: "All", n: total0 }, ...STATUS_TABS.map((s) => ({ key: s, label: STATUS_TAB_LABEL[s] ?? STATUS_TEXT[s], n: c?.[s] }))].map((t) => {
            const on = q.status === t.key;
            return (
              <button key={t.key || "all"} type="button" role="tab" aria-selected={on}
                      onClick={() => set({ status: t.key })}
                      className={cn("px-3 py-2 text-sm whitespace-nowrap", on ? "text-foreground shadow-[inset_0_-2px_0_var(--hr-orange)]" : "text-[var(--hr-muted)] hover:text-foreground")}>
                {t.label} <span className="hr-data text-xs ml-1">{t.n ?? "–"}</span>
              </button>
            );
          })}
        </div>
        <div className="ml-auto flex items-center gap-2 pb-1.5">
          {otherFiltered && <Button type="button" size="sm" variant="ghost" onClick={clearOthers}>Clear</Button>}
          <Button type="button" size="sm" variant="outline" aria-expanded={showFilters} onClick={() => setShowFilters((v) => !v)}>
            Filters{otherFiltered ? ` (${[q.search, q.department, q.batchYear].filter(Boolean).length})` : ""}
          </Button>
        </div>
      </div>
      {showFilters && (
        <div className="flex flex-wrap items-end gap-2" role="group" aria-label="Filter students">
          <div className="flex-1 min-w-48">
            <Label htmlFor="student-search" className="hr-label">Search</Label>
            <Input id="student-search" placeholder="Name, roll no or email" value={q.search} onChange={(e) => set({ search: e.target.value })} />
          </div>
          <div className="w-40">
            <Label htmlFor="f-dept" className="hr-label">Branch</Label>
            <NativeSelect id="f-dept" value={q.department} onChange={(e) => set({ department: e.target.value })}>
              <option value="">All</option>
              {facets.data?.departments.map((d) => <option key={d} value={d}>{d}</option>)}
            </NativeSelect>
          </div>
          <div className="w-32">
            <Label htmlFor="f-batch" className="hr-label">Batch</Label>
            <NativeSelect id="f-batch" value={q.batchYear} onChange={(e) => set({ batchYear: e.target.value })}>
              <option value="">All</option>
              {facets.data?.batchYears.map((y) => <option key={y} value={y}>{y}</option>)}
            </NativeSelect>
          </div>
        </div>
      )}

      {links && <InviteLinks links={links.links} emailed={links.emailed} />}

      {isAdmin && selected.size > 0 && (
        <div className="flex items-center gap-3 border border-[var(--hr-rule)] bg-[var(--hr-surface)] px-3 py-2 text-sm">
          <span className="hr-data">{selected.size} selected</span>
          <Button size="sm" disabled={busy} onClick={() => void invite([...selected])}>Send activation invites</Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
        </div>
      )}

      {students.isLoading ? <Loading /> : students.error ? <Empty title="Couldn't load students" body={friendly(students.error)} /> :
        !data?.rows.length ? (
          <Empty stage={!q.search && !q.department && !q.batchYear && !q.status
                   ? [{ label: "Import", state: "current" }, { label: "Invite", state: "todo" }, { label: "Assign", state: "todo" }]
                   : undefined}
                 title={q.search || q.department || q.batchYear || q.status ? "No students match" : "No students yet"}
                 body={isAdmin ? "Import your student list from Excel or CSV." : undefined}>
            {isAdmin && !q.search && <Button asChild><Link to={`/c/${orgId}/students/import`}>Import students</Link></Button>}
          </Empty>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  {isAdmin && (
                    <TableHead className="w-8">
                      <input type="checkbox" aria-label="Select all invitable students on this page"
                        checked={data.rows.filter(invitable).length > 0 && data.rows.filter(invitable).every((s) => selected.has(s.id))}
                        onChange={(e) => setSelected(e.target.checked ? new Set(data.rows.filter(invitable).map((s) => s.id)) : new Set())} />
                    </TableHead>
                  )}
                  <TableHead className="hr-label">Roll no</TableHead><TableHead className="hr-label">Name</TableHead>
                  <TableHead className="hr-label">Branch</TableHead><TableHead className="hr-label">Batch</TableHead>
                  <TableHead className="hr-label">Sec</TableHead><TableHead className="hr-label text-right">CGPA</TableHead>
                  <TableHead className="hr-label text-right">Backlogs</TableHead>
                  <TableHead className="hr-label">Status</TableHead>{isAdmin && <TableHead className="hr-label text-right">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.rows.map((s) => (
                  <TableRow key={s.id}>
                    {isAdmin && (
                      <TableCell>
                        <input type="checkbox" aria-label={`Select ${s.full_name}`} disabled={!invitable(s)} checked={selected.has(s.id)}
                          onChange={(e) => setSelected((cur) => { const n = new Set(cur); if (e.target.checked) n.add(s.id); else n.delete(s.id); return n; })} />
                      </TableCell>
                    )}
                    <TableCell className="hr-data text-xs text-[var(--hr-muted)]">{s.roll_no}</TableCell>
                    <TableCell><div className="font-medium">{s.full_name}</div><div className="text-xs text-[var(--hr-muted)]">{s.email}</div></TableCell>
                    <TableCell>{s.department ?? "–"}</TableCell><TableCell>{s.batch_year ?? "–"}</TableCell><TableCell>{s.section ?? "–"}</TableCell>
                    <TableCell className="hr-data text-right">{numOrNull(s.cgpa) ?? "–"}</TableCell>
                    <TableCell className="hr-data text-right">{s.active_backlogs ?? "–"}</TableCell>
                    <TableCell><Chip tone={STATUS_TONE[s.status]}>{STATUS_TEXT[s.status]}</Chip></TableCell>
                    {isAdmin && (
                      <TableCell className="text-right whitespace-nowrap">
                        <Button size="sm" variant="ghost" onClick={() => setEditing(s)}>Edit</Button>
                        {invitable(s) && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void invite([s.id])}>{s.status === "invited" ? "Resend" : "Invite"}</Button>}
                        {s.status === "held_minor" && <Button size="sm" variant="ghost" onClick={() => void setStatus(s, "imported")}>Release hold</Button>}
                        {s.status === "deactivated"
                          ? <Button size="sm" variant="ghost" onClick={() => void setStatus(s, s.user_id ? "active" : "imported")}>Restore</Button>
                          : <Button size="sm" variant="ghost" onClick={() => void setStatus(s, "deactivated")}>Deactivate</Button>}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="flex items-center justify-between text-sm">
              <span className="hr-data text-[var(--hr-muted)]">{data.total} students</span>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" disabled={q.page <= 1} onClick={() => setQ((c) => ({ ...c, page: c.page - 1 }))}>Previous</Button>
                <span className="hr-data text-xs">Page {q.page} of {pages}</span>
                <Button size="sm" variant="outline" disabled={q.page >= pages} onClick={() => setQ((c) => ({ ...c, page: c.page + 1 }))}>Next</Button>
              </div>
            </div>
          </>
        )}
      <StudentDialog orgId={orgId} student={editing} onClose={() => setEditing(null)} onSaved={refresh} />
    </div>
  );
}

const FIELDS = [
  ["roll_no", "Roll no"], ["full_name", "Name"], ["email", "Email"], ["phone", "Phone"], ["department", "Branch"],
  ["batch_year", "Batch (year of passing)"], ["section", "Section"], ["cgpa", "CGPA"], ["active_backlogs", "Active backlogs"],
  ["tenth_pct", "10th %"], ["twelfth_pct", "12th %"], ["dob", "Date of birth (DD-MM-YYYY)"],
] as const;
type FormKey = (typeof FIELDS)[number][0];

function toForm(s: StudentRecord | null): Record<FormKey, string> {
  const v = (x: unknown) => (x === null || x === undefined ? "" : String(x));
  const dob = s?.dob ? s.dob.split("-").reverse().join("-") : "";
  return {
    roll_no: v(s?.roll_no), full_name: v(s?.full_name), email: v(s?.email), phone: v(s?.phone), department: v(s?.department),
    batch_year: v(s?.batch_year), section: v(s?.section), cgpa: v(s?.cgpa), active_backlogs: v(s?.active_backlogs),
    tenth_pct: v(s?.tenth_pct), twelfth_pct: v(s?.twelfth_pct), dob,
  };
}

function StudentDialog({ orgId, student, onClose, onSaved }: {
  orgId: string; student: StudentRecord | "new" | null; onClose: () => void; onSaved: () => void;
}) {
  const existing = student && student !== "new" ? student : null;
  const [form, setForm] = useState<Record<FormKey, string>>(toForm(null));
  const [openFor, setOpenFor] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (student !== openFor) { setOpenFor(student); setForm(toForm(existing)); setError(null); }

  const save = async () => {
    setError(null);
    const t = (k: FormKey) => form[k].trim() || null;
    const nOrNull = (k: FormKey) => (form[k].trim() === "" ? null : Number(form[k]));
    if (!t("roll_no") || !t("full_name") || !t("email")) { setError("Roll no, name and email are needed."); return; }
    const dob = t("dob") ? parseDob(form.dob) : null;
    if (t("dob") && !dob) { setError("Date of birth isn't a valid date (DD-MM-YYYY)."); return; }
    const row = {
      roll_no: t("roll_no"), full_name: t("full_name"), email: form.email.trim().toLowerCase(), phone: t("phone"),
      department: t("department"), batch_year: nOrNull("batch_year"), section: t("section"), cgpa: nOrNull("cgpa"),
      active_backlogs: nOrNull("active_backlogs"), tenth_pct: nOrNull("tenth_pct"), twelfth_pct: nOrNull("twelfth_pct"), dob,
    };
    if (Object.values(row).some((v) => typeof v === "number" && !Number.isFinite(v))) { setError("Numbers only in the number fields."); return; }
    setBusy(true);
    const { error: err } = existing
      ? await b2bDb.from("students").update(row).eq("id", existing.id)
      : await b2bDb.from("students").insert({ ...row, org_id: orgId });
    setBusy(false);
    if (err) { setError(friendly(err)); return; }
    onSaved();
    onClose();
  };

  return (
    <Dialog open={student !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{existing ? `Edit ${existing.full_name}` : "Add a student"}</DialogTitle>
          <DialogDescription>Students under 18 are kept on hold and not invited.</DialogDescription>
        </DialogHeader>
        <div className="grid sm:grid-cols-2 gap-3">
          {FIELDS.map(([k, label]) => (
            <div key={k} className="space-y-1">
              <Label htmlFor={`st-${k}`}>{label}</Label>
              <Input id={`st-${k}`} value={form[k]} onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))} />
            </div>
          ))}
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void save()} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
