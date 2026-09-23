import { useRef, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Download, FileUp, Loader2, MinusCircle, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { invitesApi, type ImportResponse } from "../lib/api";
import { downloadCsv, toCsv } from "../lib/csv-export";
import { ROSTER_TEMPLATE_CSV, validateRoster, type RosterParseResult } from "../lib/shared";
import { useOrgContext } from "../components/OrgContext";

const MAX_FILE_BYTES = 2 * 1024 * 1024;

/** /org/:orgId/import — CSV roster → validated preview → invites. */
export default function OrgImport() {
  const { org, canManage } = useOrgContext();
  const qc = useQueryClient();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<RosterParseResult | null>(null);
  const [sendEmail, setSendEmail] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ImportResponse | null>(null);

  if (!canManage) return <Navigate to={`/org/${org.id}`} replace />;

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setResult(null);
    if (file.size > MAX_FILE_BYTES) {
      setFileName(file.name);
      setParsed({ rows: [], errors: [], fileErrors: ["File is larger than 2 MB. Split it into smaller files."] });
      return;
    }
    if (/\.(xlsx?|ods)$/i.test(file.name)) {
      setFileName(file.name);
      setParsed({ rows: [], errors: [], fileErrors: ["That's an Excel file. In Excel choose File → Save As → CSV UTF-8, then upload the .csv."] });
      return;
    }
    setFileName(file.name);
    setParsed(validateRoster(await file.text()));
  };

  const reset = () => {
    setParsed(null);
    setFileName(null);
    setResult(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const submit = async () => {
    if (!parsed?.rows.length) return;
    setSubmitting(true);
    try {
      const res = await invitesApi.import(org.id, parsed.rows, sendEmail);
      setResult(res);
      qc.invalidateQueries({ queryKey: ["b2b"] });
    } catch (e) {
      toast({ title: "Import failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const downloadLinks = () => {
    if (!result) return;
    downloadCsv(
      `${org.slug}-invite-links.csv`,
      toCsv(["roll_no", "name", "email", "invite_link"], result.invited.map((i) => [i.roll_no, i.full_name, i.email, i.link])),
    );
  };

  // ── Results ────────────────────────────────────────────────────────────────
  if (result) {
    const invited = result.results.filter((r) => r.status === "invited").length;
    const skipped = result.results.filter((r) => r.status === "skipped");
    const errored = result.results.filter((r) => r.status === "error");
    return (
      <div className="space-y-5 max-w-3xl">
        <div className="grid grid-cols-3 gap-3">
          <Summary icon={<CheckCircle2 className="h-4 w-4 text-emerald-400" />} label="Invited" value={invited} />
          <Summary icon={<MinusCircle className="h-4 w-4 text-muted-foreground" />} label="Skipped (duplicates)" value={skipped.length} />
          <Summary icon={<XCircle className="h-4 w-4 text-red-400" />} label="Not imported" value={errored.length} />
        </div>

        {sendEmail && result.email.error && (
          <Notice tone="warn">
            Emails could not be sent: {result.email.error} Download the invite links below and share them (e.g. on
            your batch WhatsApp group or LMS).
          </Notice>
        )}
        {sendEmail && !result.email.error && result.email.sent > 0 && (
          <Notice tone="ok">Invite emails sent to {result.email.sent} students.</Notice>
        )}

        {result.invited.length > 0 && (
          <div className="rounded-lg border border-border/60 p-4 space-y-2">
            <p className="text-sm">
              <strong>Save the invite links now.</strong> Each link is personal and is shown only once; you can
              generate a new link for any student from the Invites tab.
            </p>
            <Button onClick={downloadLinks} variant="secondary">
              <Download className="h-4 w-4 mr-1" /> Download invite links (CSV)
            </Button>
          </div>
        )}

        {(skipped.length > 0 || errored.length > 0) && (
          <RowTable rows={[...errored, ...skipped].sort((a, b) => a.row - b.row).map((r) => ({ row: r.row, status: r.status, text: r.reason ?? "" }))} />
        )}

        <div className="flex gap-2">
          <Button onClick={reset}>Upload another file</Button>
          <Button variant="ghost" asChild><Link to={`/org/${org.id}/invites`}>View all invites</Link></Button>
        </div>
      </div>
    );
  }

  // ── Upload + preview ───────────────────────────────────────────────────────
  return (
    <div className="space-y-5 max-w-3xl">
      <div>
        <h2 className="font-semibold">Add students from a CSV</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Columns: <code>name, email, roll_no, department, batch</code>. Common headers like “Hall Ticket No”,
          “Student Name”, “Branch” and “Section” are recognised. Duplicates are skipped automatically, so re-uploading
          the same file is safe.
        </p>
        <Button
          variant="link"
          className="px-0 h-auto mt-1"
          onClick={() => downloadCsv("hiresume-student-roster-template.csv", ROSTER_TEMPLATE_CSV.trimEnd())}
        >
          <Download className="h-3.5 w-3.5 mr-1" /> Download template
        </Button>
      </div>

      <label
        className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border/80 p-8 cursor-pointer hover:bg-white/5"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); onFile(e.dataTransfer.files?.[0]); }}
      >
        <FileUp className="h-6 w-6 text-muted-foreground" />
        <span className="text-sm">{fileName ?? "Choose a .csv file or drop it here"}</span>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          onChange={(e) => onFile(e.target.files?.[0])}
          aria-label="Student roster CSV"
        />
      </label>

      {parsed && parsed.fileErrors.length > 0 && (
        <Notice tone="error">{parsed.fileErrors.join(" ")}</Notice>
      )}

      {parsed && parsed.fileErrors.length === 0 && (
        <>
          <p className="text-sm">
            <strong className="text-emerald-300">{parsed.rows.length}</strong> students ready
            {parsed.errors.length > 0 && (
              <> · <strong className="text-red-300">{parsed.errors.length}</strong> rows have problems and will be left out</>
            )}
          </p>

          {parsed.errors.length > 0 && (
            <RowTable rows={parsed.errors.map((e) => ({ row: e.row, status: "error" as const, text: e.errors.join("; "), who: e.raw.full_name || e.raw.email }))} />
          )}

          {parsed.rows.length > 0 && (
            <details className="rounded-lg border border-border/60">
              <summary className="px-4 py-2 text-sm cursor-pointer">Preview students ({parsed.rows.length})</summary>
              <div className="max-h-80 overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Row</TableHead><TableHead>Roll no</TableHead><TableHead>Name</TableHead>
                      <TableHead>Email</TableHead><TableHead>Batch</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {parsed.rows.slice(0, 500).map((r) => (
                      <TableRow key={r.row}>
                        <TableCell className="text-muted-foreground tabular-nums">{r.row}</TableCell>
                        <TableCell className="tabular-nums">{r.roll_no}</TableCell>
                        <TableCell>{r.full_name}</TableCell>
                        <TableCell className="text-muted-foreground">{r.email}</TableCell>
                        <TableCell>{r.batch}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </details>
          )}

          <div className="flex items-center gap-2">
            <Checkbox id="send-email" checked={sendEmail} onCheckedChange={(v) => setSendEmail(v === true)} />
            <Label htmlFor="send-email" className="text-sm font-normal">Email each student their invite link</Label>
          </div>

          <div className="flex gap-2">
            <Button onClick={submit} disabled={submitting || parsed.rows.length === 0}>
              {submitting && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              {submitting ? "Inviting…" : `Invite ${parsed.rows.length} students`}
            </Button>
            <Button variant="ghost" onClick={reset} disabled={submitting}>Cancel</Button>
          </div>
        </>
      )}
    </div>
  );
}

function Summary({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border/60 bg-card/40 p-4">
      <p className="text-xs text-muted-foreground flex items-center gap-1.5">{icon}{label}</p>
      <p className="text-2xl font-semibold mt-1 tabular-nums">{value}</p>
    </div>
  );
}

function Notice({ tone, children }: { tone: "warn" | "ok" | "error"; children: React.ReactNode }) {
  const cls = {
    warn: "border-amber-500/30 bg-amber-500/10 text-amber-100",
    ok: "border-emerald-500/30 bg-emerald-500/10 text-emerald-100",
    error: "border-red-500/30 bg-red-500/10 text-red-100",
  }[tone];
  return (
    <div className={`rounded-lg border p-3 text-sm flex gap-2 ${cls}`} role={tone === "error" ? "alert" : "status"}>
      {tone !== "ok" && <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />}
      <div>{children}</div>
    </div>
  );
}

function RowTable({ rows }: { rows: Array<{ row: number; status: "error" | "skipped" | "invited"; text: string; who?: string }> }) {
  return (
    <div className="rounded-lg border border-border/60 max-h-72 overflow-auto">
      <Table>
        <TableHeader>
          <TableRow><TableHead className="w-16">Row</TableHead>{rows.some((r) => r.who) && <TableHead>Student</TableHead>}<TableHead>Problem</TableHead></TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={`${r.row}-${r.status}`}>
              <TableCell className="tabular-nums text-muted-foreground">{r.row}</TableCell>
              {rows.some((x) => x.who) && <TableCell>{r.who || "—"}</TableCell>}
              <TableCell className={r.status === "error" ? "text-red-300" : "text-muted-foreground"}>{r.text}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
