import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Chip } from "../ui/broadcast";
import { collegeApi, ApiError } from "../lib/api";
import { CollegeShell, NativeSelect } from "./CollegeShell";
import { FIELDS, MAX_IMPORT_ROWS, buildRows, detectMapping, missingRequired, readTable, type ImportField, type Mapping, type RowError, type StudentRowInput } from "./lib/import";
import { InviteLinks } from "./InviteLinks";
import type { ContractOutput } from "../../../supabase/functions/_shared/contracts/common";
import type { collegeContract } from "../../../supabase/functions/_shared/contracts/college";

type ImportOut = ContractOutput<typeof collegeContract, "importStudents">;
type Step = "upload" | "map" | "preview" | "done";
const STEPS: { key: Step; label: string }[] = [
  { key: "upload", label: "Upload" }, { key: "map", label: "Map columns" },
  { key: "preview", label: "Check rows" }, { key: "done", label: "Done" },
];

const DUP_TEXT: Record<string, string> = {
  roll_no: "Same roll no as an existing student", email: "Same email as an existing student",
  both: "Already in your list (same roll no and email)", in_file: "Repeats an earlier row in this file",
};

/** The wizard's step state, drawn as a broadcast sequence: done steps settle gold, the live one reads orange. */
function StepRail({ step }: { step: Step }) {
  const i = STEPS.findIndex((s) => s.key === step);
  return (
    <ol className="flex items-stretch gap-6 overflow-x-auto hr-rule-b" aria-label="Import steps">
      {STEPS.map((s, idx) => {
        const state = idx < i ? "done" : idx === i ? "current" : "upcoming";
        return (
          <li key={s.key} className={cn("flex items-center gap-2 pb-3 shrink-0 whitespace-nowrap",
            state === "current" && "shadow-[inset_0_-2px_0_var(--hr-orange)]")} aria-current={state === "current" ? "step" : undefined}>
            <span className={cn("grid place-items-center h-5 w-5 shrink-0 border text-[10px] font-bold",
              state === "done" ? "border-[var(--hr-gold)] text-[var(--hr-gold)]"
                : state === "current" ? "border-[var(--hr-orange)] text-[var(--hr-orange)]" : "border-[var(--hr-rule)] text-[var(--hr-muted)]")}>
              {state === "done" ? <Check className="h-3 w-3" /> : idx + 1}
            </span>
            <span className={cn("hr-label", state === "current" && "text-foreground", state === "done" && "text-[var(--hr-gold)]")}>{s.label}</span>
          </li>
        );
      })}
    </ol>
  );
}

export default function ImportPage() {
  return <CollegeShell>{({ orgId, isAdmin }) => (isAdmin ? <ImportWizard orgId={orgId} /> : (
    <p className="text-sm text-muted-foreground">Only TPO admins can import students.</p>
  ))}</CollegeShell>;
}

/** Gallery/demo only: seeds the wizard's local step state so a mid-wizard screen can be captured without a real
 *  file upload. Production (`ImportPage`) never passes this. */
export interface ImportWizardInitial {
  step?: Step; fileName?: string; table?: string[][]; mapping?: Mapping;
  built?: { rows: StudentRowInput[]; errors: RowError[] }; preview?: ImportOut | null;
}

export function ImportWizard({ orgId, initial }: { orgId: string; initial?: ImportWizardInitial }) {
  const qc = useQueryClient();
  const [step, setStep] = useState<Step>(initial?.step ?? "upload");
  const [fileName, setFileName] = useState(initial?.fileName ?? "");
  const [table, setTable] = useState<string[][]>(initial?.table ?? []);
  const [mapping, setMapping] = useState<Mapping>(initial?.mapping ?? {});
  const [built, setBuilt] = useState<{ rows: StudentRowInput[]; errors: RowError[] }>(initial?.built ?? { rows: [], errors: [] });
  const [preview, setPreview] = useState<ImportOut | null>(initial?.preview ?? null);
  const [onDuplicate, setOnDuplicate] = useState<"skip" | "merge">("skip");
  const [sendInvites, setSendInvites] = useState(true);
  const [result, setResult] = useState<ImportOut | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pickedName, setPickedName] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const headers = table[0] ?? [];
  const missing = useMemo(() => missingRequired(mapping), [mapping]);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setPickedName(file.name);
    setError(null);
    try {
      const t = await readTable(file);
      if (t.length < 2) { setError("The file has no student rows."); return; }
      if (t.length - 1 > MAX_IMPORT_ROWS) { setError(`Too many rows (${t.length - 1}). Import at most ${MAX_IMPORT_ROWS} students per file.`); return; }
      setFileName(file.name);
      setTable(t);
      setMapping(detectMapping(t[0]));
      setStep("map");
    } catch (e) {
      setError((e as Error).message || "Couldn't read that file.");
    }
  };

  const check = async () => {
    setError(null);
    const b = buildRows(table, mapping);
    setBuilt(b);
    setBusy(true);
    try {
      const p = b.rows.length
        ? await collegeApi("importStudents", { orgId, mode: "preview", rows: b.rows, onDuplicate: "skip" })
        : { created: 0, merged: 0, skipped: 0, heldMinors: 0, duplicates: [], errors: [] };
      setPreview(p);
      setStep("preview");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally { setBusy(false); }
  };

  const commit = async () => {
    setError(null);
    setBusy(true);
    try {
      const r = await collegeApi("importStudents", { orgId, mode: "commit", rows: built.rows, onDuplicate, sendInvites });
      setResult(r);
      setStep("done");
      void qc.invalidateQueries({ queryKey: ["b2b-college"] });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally { setBusy(false); }
  };

  const existingDups = preview?.duplicates.filter((d) => d.reason !== "in_file") ?? [];
  const inFileDups = preview?.duplicates.filter((d) => d.reason === "in_file") ?? [];
  const allErrors = [...built.errors, ...(preview?.errors ?? [])].sort((a, b) => a.row - b.row);
  const rowByLine = new Map(built.rows.map((r) => [r.row, r]));

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <h2 className="hr-display text-[22px]">Import students</h2>
        <Link to={`/c/${orgId}/students`} className="text-sm text-[var(--hr-muted)] hover:text-foreground">Back to students</Link>
      </div>
      <StepRail step={step} />
      {error && <p role="alert" className="border border-[var(--hr-red)] bg-[var(--hr-red)]/10 text-[var(--hr-red-ink)] p-3 text-sm">{error}</p>}

      {step === "upload" && (
        <div className="border border-dashed border-[var(--hr-rule)] p-8 text-center space-y-3">
          <Upload className="mx-auto h-8 w-8 text-[var(--hr-muted)]" />
          <p className="text-sm">Upload your student list as <b>.xlsx</b> or <b>.csv</b>. The first row must be the column headings.</p>
          <p className="text-xs text-[var(--hr-muted)]">
            Needed: roll no (or hall ticket no), name, email. Optional: phone, branch, batch / year of passing, section, CGPA,
            active backlogs, 10th %, 12th %, date of birth. Students under 18 are added but not activated.
          </p>
          <input ref={fileInputRef} id="college-import-file" className="sr-only" aria-label="Student file" type="file" accept=".csv,.xlsx,text/csv" onChange={(e) => void onFile(e.target.files?.[0])} />
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()}>Choose CSV or XLSX file</Button>
            {pickedName && <span className="hr-data text-sm text-[var(--hr-muted)]">{pickedName}</span>}
          </div>
        </div>
      )}

      {step === "map" && (
        <div className="space-y-4">
          <p className="text-sm">
            <b>{fileName}</b>: {table.length - 1} rows. Check which column holds each detail. We matched the headings we recognised.
          </p>
          <div className="grid sm:grid-cols-2 gap-3">
            {FIELDS.map((f) => (
              <label key={f.key} className="text-sm space-y-1">
                <span className="hr-label !text-foreground !normal-case !tracking-normal !text-[13px] !font-normal">{f.label}{f.required && <span className="text-[var(--hr-red-ink)]"> *</span>}</span>
                <NativeSelect aria-label={f.label} value={mapping[f.key] ?? ""}
                  onChange={(e) => setMapping((m) => {
                    const next: Mapping = { ...m };
                    if (e.target.value === "") delete next[f.key as ImportField];
                    else next[f.key as ImportField] = Number(e.target.value);
                    return next;
                  })}>
                  <option value="">Not in this file</option>
                  {headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                </NativeSelect>
              </label>
            ))}
          </div>
          {missing.length > 0 && (
            <p className="text-sm text-[var(--hr-red-ink)]">Choose a column for: {missing.map((m) => FIELDS.find((f) => f.key === m)?.label).join(", ")}.</p>
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setStep("upload")}>Choose another file</Button>
            <Button onClick={() => void check()} disabled={missing.length > 0 || busy}>{busy ? "Checking…" : "Check rows"}</Button>
          </div>
        </div>
      )}

      {step === "preview" && preview && (
        <div className="space-y-5">
          <div className="flex flex-wrap gap-2 text-sm">
            <Chip>{preview.created} new</Chip>
            <Chip tone={existingDups.length ? "plain" : "muted"}>{existingDups.length} already in your list</Chip>
            <Chip tone={inFileDups.length ? "plain" : "muted"}>{inFileDups.length} repeated in the file</Chip>
            <Chip tone={preview.heldMinors ? "red" : "muted"}>{preview.heldMinors} under 18 (held)</Chip>
            <Chip tone={allErrors.length ? "red" : "muted"}>{allErrors.length} with errors</Chip>
          </div>

          {existingDups.length > 0 && (
            <section className="space-y-2">
              <h3 className="hr-display text-base">Students already in your list</h3>
              <fieldset className="flex flex-wrap gap-4 text-sm">
                <legend className="sr-only">What to do with students already in your list</legend>
                <label className="flex items-center gap-2"><input type="radio" name="dup" checked={onDuplicate === "skip"} onChange={() => setOnDuplicate("skip")} /> Skip them (keep what's stored)</label>
                <label className="flex items-center gap-2"><input type="radio" name="dup" checked={onDuplicate === "merge"} onChange={() => setOnDuplicate("merge")} /> Merge (update with this file; blank cells keep stored values)</label>
              </fieldset>
              <DupTable dups={existingDups} rowByLine={rowByLine} />
            </section>
          )}
          {inFileDups.length > 0 && (
            <section className="space-y-2">
              <h3 className="hr-display text-base">Repeated rows in this file (skipped; the first one is used)</h3>
              <DupTable dups={inFileDups} rowByLine={rowByLine} />
            </section>
          )}
          {allErrors.length > 0 && (
            <section className="space-y-2">
              <h3 className="hr-display text-base">Rows with errors (not imported)</h3>
              <Table>
                <TableHeader><TableRow className="hover:bg-transparent"><TableHead className="hr-label w-20">Row</TableHead><TableHead className="hr-label">Problem</TableHead></TableRow></TableHeader>
                <TableBody>
                  {allErrors.slice(0, 200).map((e) => <TableRow key={`${e.row}-${e.message}`}><TableCell className="hr-data text-xs">{e.row}</TableCell><TableCell>{e.message}</TableCell></TableRow>)}
                </TableBody>
              </Table>
              <p className="text-xs text-[var(--hr-muted)]">Fix these in your sheet and import it again; rows already imported are recognised as duplicates.</p>
            </section>
          )}

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={sendInvites} onChange={(e) => setSendInvites(e.target.checked)} />
            Send activation invites to the imported students now (not to students under 18)
          </label>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setStep("map")}>Back to columns</Button>
            <Button onClick={() => void commit()} disabled={busy || built.rows.length === 0}>
              {busy ? "Importing…" : `Import ${preview.created + (onDuplicate === "merge" ? existingDups.length : 0)} students`}
            </Button>
          </div>
        </div>
      )}

      {step === "done" && result && (
        <div className="space-y-4" role="status">
          <p className="hr-display text-lg">Import finished</p>
          <ul className="text-sm space-y-1">
            <li><span className="hr-data">{result.created}</span> added</li>
            <li><span className="hr-data">{result.merged}</span> updated</li>
            <li><span className="hr-data">{result.skipped}</span> skipped</li>
            <li><span className="hr-data">{result.heldMinors}</span> held because they are under 18</li>
            {result.errors.length > 0 && <li className="text-[var(--hr-red-ink)]"><span className="hr-data">{result.errors.length}</span> rows not imported because of errors</li>}
          </ul>
          {result.invites && <InviteLinks links={result.invites} emailed={result.emailed ?? 0} />}
          <Button asChild><Link to={`/c/${orgId}/students`}>Go to students</Link></Button>
        </div>
      )}
    </div>
  );
}

function DupTable({ dups, rowByLine }: { dups: ImportOut["duplicates"]; rowByLine: Map<number, StudentRowInput> }) {
  return (
    <Table>
      <TableHeader><TableRow className="hover:bg-transparent"><TableHead className="hr-label w-20">Row</TableHead><TableHead className="hr-label">Roll no</TableHead><TableHead className="hr-label">Name</TableHead><TableHead className="hr-label">Email</TableHead><TableHead className="hr-label">Why</TableHead></TableRow></TableHeader>
      <TableBody>
        {dups.slice(0, 200).map((d) => {
          const r = rowByLine.get(d.row);
          return (
            <TableRow key={d.row}>
              <TableCell className="hr-data text-xs">{d.row}</TableCell><TableCell className="hr-data text-xs">{r?.roll_no}</TableCell><TableCell>{r?.full_name}</TableCell>
              <TableCell className="text-xs">{r?.email}</TableCell><TableCell>{DUP_TEXT[d.reason]}</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
