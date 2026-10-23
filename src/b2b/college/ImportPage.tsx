import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { collegeApi, ApiError } from "../lib/api";
import { CollegeShell, NativeSelect } from "./CollegeShell";
import { FIELDS, MAX_IMPORT_ROWS, buildRows, detectMapping, missingRequired, readTable, type ImportField, type Mapping, type RowError, type StudentRowInput } from "./lib/import";
import { InviteLinks } from "./InviteLinks";
import type { ContractOutput } from "../../../supabase/functions/_shared/contracts/common";
import type { collegeContract } from "../../../supabase/functions/_shared/contracts/college";

type ImportOut = ContractOutput<typeof collegeContract, "importStudents">;
type Step = "upload" | "map" | "preview" | "done";

const DUP_TEXT: Record<string, string> = {
  roll_no: "Same roll no as an existing student", email: "Same email as an existing student",
  both: "Already in your list (same roll no and email)", in_file: "Repeats an earlier row in this file",
};

export default function ImportPage() {
  return <CollegeShell>{({ orgId, isAdmin }) => (isAdmin ? <ImportWizard orgId={orgId} /> : (
    <p className="text-sm text-muted-foreground">Only TPO admins can import students.</p>
  ))}</CollegeShell>;
}

export function ImportWizard({ orgId }: { orgId: string }) {
  const qc = useQueryClient();
  const [step, setStep] = useState<Step>("upload");
  const [fileName, setFileName] = useState("");
  const [table, setTable] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Mapping>({});
  const [built, setBuilt] = useState<{ rows: StudentRowInput[]; errors: RowError[] }>({ rows: [], errors: [] });
  const [preview, setPreview] = useState<ImportOut | null>(null);
  const [onDuplicate, setOnDuplicate] = useState<"skip" | "merge">("skip");
  const [sendInvites, setSendInvites] = useState(true);
  const [result, setResult] = useState<ImportOut | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const headers = table[0] ?? [];
  const missing = useMemo(() => missingRequired(mapping), [mapping]);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
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
        <h2 className="text-lg font-semibold">Import students</h2>
        <Link to={`/c/${orgId}/students`} className="text-sm underline">Back to students</Link>
      </div>
      {error && <p role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm">{error}</p>}

      {step === "upload" && (
        <div className="rounded-lg border border-dashed p-8 text-center space-y-3">
          <Upload className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="text-sm">Upload your student list as <b>.xlsx</b> or <b>.csv</b>. The first row must be the column headings.</p>
          <p className="text-xs text-muted-foreground">
            Needed: roll no (or hall ticket no), name, email. Optional: phone, branch, batch / year of passing, section, CGPA,
            active backlogs, 10th %, 12th %, date of birth. Students under 18 are added but not activated.
          </p>
          <label className="inline-block">
            <span className="sr-only">Student file</span>
            <input aria-label="Student file" type="file" accept=".csv,.xlsx,text/csv" onChange={(e) => void onFile(e.target.files?.[0])} />
          </label>
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
                <span>{f.label}{f.required && <span className="text-destructive"> *</span>}</span>
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
            <p className="text-sm text-destructive">Choose a column for: {missing.map((m) => FIELDS.find((f) => f.key === m)?.label).join(", ")}.</p>
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
            <Badge variant="outline">{preview.created} new</Badge>
            <Badge variant="outline">{existingDups.length} already in your list</Badge>
            <Badge variant="outline">{inFileDups.length} repeated in the file</Badge>
            <Badge variant="outline">{preview.heldMinors} under 18 (held)</Badge>
            <Badge variant={allErrors.length ? "destructive" : "outline"}>{allErrors.length} with errors</Badge>
          </div>

          {existingDups.length > 0 && (
            <section className="space-y-2">
              <h3 className="font-medium">Students already in your list</h3>
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
              <h3 className="font-medium">Repeated rows in this file (skipped; the first one is used)</h3>
              <DupTable dups={inFileDups} rowByLine={rowByLine} />
            </section>
          )}
          {allErrors.length > 0 && (
            <section className="space-y-2">
              <h3 className="font-medium">Rows with errors (not imported)</h3>
              <Table>
                <TableHeader><TableRow><TableHead className="w-20">Row</TableHead><TableHead>Problem</TableHead></TableRow></TableHeader>
                <TableBody>
                  {allErrors.slice(0, 200).map((e) => <TableRow key={`${e.row}-${e.message}`}><TableCell>{e.row}</TableCell><TableCell>{e.message}</TableCell></TableRow>)}
                </TableBody>
              </Table>
              <p className="text-xs text-muted-foreground">Fix these in your sheet and import it again; rows already imported are recognised as duplicates.</p>
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
          <p className="font-medium">Import finished</p>
          <ul className="text-sm list-disc pl-5">
            <li>{result.created} added</li>
            <li>{result.merged} updated</li>
            <li>{result.skipped} skipped</li>
            <li>{result.heldMinors} held because they are under 18</li>
            {result.errors.length > 0 && <li>{result.errors.length} rows not imported because of errors</li>}
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
      <TableHeader><TableRow><TableHead className="w-20">Row</TableHead><TableHead>Roll no</TableHead><TableHead>Name</TableHead><TableHead>Email</TableHead><TableHead>Why</TableHead></TableRow></TableHeader>
      <TableBody>
        {dups.slice(0, 200).map((d) => {
          const r = rowByLine.get(d.row);
          return (
            <TableRow key={d.row}>
              <TableCell>{d.row}</TableCell><TableCell>{r?.roll_no}</TableCell><TableCell>{r?.full_name}</TableCell>
              <TableCell>{r?.email}</TableCell><TableCell>{DUP_TEXT[d.reason]}</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
