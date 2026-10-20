// Invite candidates to a role: one person, or a CSV / XLSX list (email, name, phone). Without email configured,
// the links come back to copy or download as a CSV.
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { companyApi } from "../lib/api";
import { downloadCsvFile, fileStamp } from "../college/lib/exports";
import { buildCandidateRows, detectCandidateMapping, LINK_COLUMNS, linkRows, MAX_INVITE_ROWS, readTable, SKIP_REASON, type CandidateRowIn } from "./lib/candidates";

type Result = { invited: Array<{ fullName: string; email: string; link: string; emailed: boolean }>; skipped: Array<{ email: string; reason: string }>; emailConfigured: boolean };

export function InviteDialog({ open, onOpenChange, jobRoleId, roleTitle, onDone }: {
  open: boolean; onOpenChange: (v: boolean) => void; jobRoleId: string; roleTitle: string; onDone: () => void;
}) {
  const [mode, setMode] = useState<"one" | "file">("one");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [fileRows, setFileRows] = useState<CandidateRowIn[] | null>(null);
  const [fileIssues, setFileIssues] = useState<string[]>([]);
  const [sendEmail, setSendEmail] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  function reset() {
    setEmail(""); setName(""); setPhone(""); setFileRows(null); setFileIssues([]); setError(null); setResult(null);
  }

  async function onFile(f: File | undefined) {
    setError(null); setFileRows(null); setFileIssues([]);
    if (!f) return;
    try {
      const table = await readTable(f);
      if (table.length < 2) { setError("The file has no rows."); return; }
      const built = buildCandidateRows(table, detectCandidateMapping(table[0]));
      if (built.rows.length > MAX_INVITE_ROWS) { setError(`Up to ${MAX_INVITE_ROWS} candidates per upload.`); return; }
      setFileRows(built.rows);
      setFileIssues([
        ...built.errors.map((e) => `Row ${e.row}: ${e.message}`),
        ...built.duplicates.map((r) => `Row ${r}: same email as an earlier row (skipped)`),
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read the file.");
    }
  }

  async function submit() {
    setError(null);
    const candidates = mode === "one"
      ? [{ email: email.trim(), fullName: name.trim(), ...(phone.trim() ? { phone: phone.trim() } : {}) }]
      : (fileRows ?? []).map((r) => ({ email: r.email, fullName: r.fullName, ...(r.phone ? { phone: r.phone } : {}) }));
    if (!candidates.length) { setError(mode === "one" ? "Enter an email and a name." : "Choose a file with at least one valid row."); return; }
    setBusy(true);
    try {
      const r = await companyApi("inviteCandidates", { jobRoleId, candidates, sendEmail, source: mode === "file" ? "csv" : "invite" });
      setResult(r);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't send the invites.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Invite candidates</DialogTitle>
          <DialogDescription>To {roleTitle}. Each candidate gets a personal link; no password needed. Credits are used only when a candidate finishes.</DialogDescription>
        </DialogHeader>
        {result ? (
          <div className="space-y-3 text-sm">
            <p role="status">
              {result.invited.length} invited{result.invited.some((i) => i.emailed) ? `, ${result.invited.filter((i) => i.emailed).length} emailed` : ""}.
              {result.skipped.length > 0 && ` ${result.skipped.length} skipped.`}
            </p>
            {!result.emailConfigured && result.invited.length > 0 && (
              <p className="text-muted-foreground">Email isn't set up yet, so send these links yourself (download them as a CSV).</p>
            )}
            {result.skipped.length > 0 && (
              <ul className="list-disc pl-5" aria-label="Skipped">
                {result.skipped.map((s) => <li key={s.email + s.reason}>{s.email}: {SKIP_REASON[s.reason] ?? s.reason}</li>)}
              </ul>
            )}
            {result.invited.length > 0 && (
              <ul className="max-h-48 overflow-auto space-y-1" aria-label="Invite links">
                {result.invited.map((i) => (
                  <li key={i.email} className="flex items-center gap-2">
                    <span className="truncate flex-1">{i.fullName} ({i.email})</span>
                    <Button size="sm" variant="ghost" onClick={() => void navigator.clipboard?.writeText(i.link)}>Copy link</Button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex gap-2">
              {result.invited.length > 0 && (
                <Button variant="outline" onClick={() => downloadCsvFile(`invite-links-${fileStamp()}.csv`, LINK_COLUMNS, linkRows(result.invited))}>
                  Download links (CSV)
                </Button>
              )}
              <Button onClick={() => { reset(); onOpenChange(false); }}>Done</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex gap-2" role="tablist">
              <Button size="sm" role="tab" aria-selected={mode === "one"} variant={mode === "one" ? "default" : "outline"} onClick={() => setMode("one")}>One person</Button>
              <Button size="sm" role="tab" aria-selected={mode === "file"} variant={mode === "file" ? "default" : "outline"} onClick={() => setMode("file")}>Upload CSV / XLSX</Button>
            </div>
            {mode === "one" ? (
              <div className="grid gap-3">
                <div className="space-y-1"><Label htmlFor="inv-name">Name</Label><Input id="inv-name" value={name} onChange={(e) => setName(e.target.value)} /></div>
                <div className="space-y-1"><Label htmlFor="inv-email">Email</Label><Input id="inv-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
                <div className="space-y-1"><Label htmlFor="inv-phone">Phone (optional)</Label><Input id="inv-phone" value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="inv-file">File with columns: email, name, phone (optional)</Label>
                <Input id="inv-file" type="file" accept=".csv,.xlsx" onChange={(e) => void onFile(e.target.files?.[0])} />
                {fileRows && <p role="status" className="text-sm">{fileRows.length} candidate{fileRows.length === 1 ? "" : "s"} ready to invite.</p>}
                {fileIssues.length > 0 && (
                  <ul className="text-sm text-muted-foreground list-disc pl-5 max-h-32 overflow-auto" aria-label="File problems">
                    {fileIssues.map((m) => <li key={m}>{m}</li>)}
                  </ul>
                )}
              </div>
            )}
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} /> Email the invite (when email is set up)
            </label>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <Button onClick={submit} disabled={busy}>{busy ? "Inviting…" : "Send invites"}</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
