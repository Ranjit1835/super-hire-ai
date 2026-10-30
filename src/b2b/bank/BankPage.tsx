// /assess/bank/:orgId — the org's question bank (org editors) plus verified global questions.
// /assess/bank/global — the global bank (super admin only).
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { b2bDb } from "@/features/b2b/lib/db";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Empty, Loading, V1Shell, type ShellTab } from "../layout/V1Shell";
import { Chip, type Tone } from "../ui/broadcast";
import { ApiError, assessApi } from "../lib/api";
import { CodingDialog } from "./CodingDialog";
import { GenerateDialog, type GenerateResult } from "./GenerateDialog";
import { McqDialog } from "./McqDialog";
import { OverrideDialog } from "./OverrideDialog";
import { mcqCheckReason, type McqCheck } from "../../../supabase/functions/_shared/contracts/assess";
import { LANGUAGE_LABEL, type QuestionRow } from "./forms";
import { BANK_PAGE, friendly, orgOf, setQuestionStatus, useBankPage, useCanEdit, type BankOwner, type BankType } from "./queries";

export function assessTabs(orgParam: string): ShellTab[] {
  if (orgParam === "global") return [{ to: "/assess/bank/global", label: "Global question bank" }];
  // /portal/:orgId sends company orgs to /co/:orgId and colleges to /c/:orgId (track E).
  return [{ to: `/portal/${orgParam}`, label: "Portal" }, { to: `/assess/tests/${orgParam}`, label: "Tests" }, { to: `/assess/bank/${orgParam}`, label: "Question bank" }];
}

const STATUS_LABEL: Record<QuestionRow["status"], string> = { draft: "Draft", verified: "Verified", retired: "Retired" };
const STATUS_TONE: Record<QuestionRow["status"], Tone> = { verified: "gold", draft: "muted", retired: "muted" };

export default function BankPage() {
  const { orgId: orgParam = "" } = useParams();
  const orgId = orgOf(orgParam);
  const qc = useQueryClient();
  const canEdit = useCanEdit(orgId);
  const [type, setType] = useState<BankType>("all");
  const [owner, setOwner] = useState<BankOwner>("all");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");   // the search actually sent: settles 300ms after typing stops
  const [page, setPage] = useState(1);
  useEffect(() => {
    const h = setTimeout(() => { setQuery(search.trim()); setPage(1); }, 300);
    return () => clearTimeout(h);
  }, [search]);
  const bank = useBankPage(orgId, { type, owner, search: query, page }, canEdit.data === true);
  const [editing, setEditing] = useState<{ kind: "mcq" | "coding"; row: QuestionRow | null } | null>(null);
  const [generating, setGenerating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  /** The last MCQ check that disagreed, so the editor can keep their key with a reason. */
  const [disputed, setDisputed] = useState<{ questionId: string; version: number; check: McqCheck } | null>(null);
  const [overriding, setOverriding] = useState(false);

  const refresh = () => qc.invalidateQueries({ queryKey: ["b2b-assess", "bank", orgId] });

  const rows = bank.data?.rows ?? [];
  const counts = bank.data?.counts;
  const total = bank.data?.total ?? 0;

  const verify = async (id: string) => {
    setBusyId(id);
    setNotice(null);
    try {
      setDisputed(null);
      const r = await assessApi("verifyQuestion", { questionId: id }, { timeoutMs: 120_000 });
      if (r.check) {
        // MCQ: an independent model solved it without the key (R2.3).
        const c = r.check;
        setNotice(r.status === "verified"
          ? { tone: "ok", text: "Verified: an independent check reached the same answer. The question can now be used in tests." }
          : { tone: "error", text: `Not verified: ${mcqCheckReason(c)}${c.note ? ` Its working: “${c.note}”` : ""} Fix the question, or keep your key with a reason.` });
        if (r.status !== "verified" && r.version != null) setDisputed({ questionId: id, version: r.version, check: c });
        return;
      }
      setNotice(r.status === "verified"
        ? { tone: "ok", text: "Verified: the reference solution passed every test. The question can now be used in tests." }
        : { tone: "error", text: `Not verified: the reference solution failed ${r.failures.length} test${r.failures.length === 1 ? "" : "s"} (${Array.from(new Set(r.failures.map((f) => f.status))).join(", ") || "no tests ran"}). Fix the tests or the solution and try again.` });
    } catch (e) {
      setNotice({ tone: "error", text: e instanceof ApiError || e instanceof Error ? e.message : "Couldn't verify the question." });
    } finally {
      setBusyId(null);
      void refresh();
    }
  };

  const retire = async (row: QuestionRow) => {
    setBusyId(row.id);
    setNotice(null);
    try {
      await setQuestionStatus(row.id, row.status === "retired" ? "draft" : "retired");
      void refresh();
    } catch (e) {
      setNotice({ tone: "error", text: friendly(e) });
    } finally {
      setBusyId(null);
    }
  };

  const onGenerated = (r: GenerateResult) => {
    const parts = [`${r.verified} verified`, `${r.drafts} saved as draft${r.drafts === 1 ? "" : "s"}`];
    setNotice({ tone: r.drafts > 0 ? "error" : "ok", text: `Generated: ${parts.join(", ")}.${r.reasons.length ? ` ${r.reasons.join(" ")}` : ""}` });
    void refresh();
  };

  const title = orgId === null ? "Global question bank" : "Question bank";
  if (canEdit.isLoading) return <V1Shell title={title}><Loading /></V1Shell>;
  if (canEdit.data !== true) {
    return <V1Shell title={title}><Empty title="You don't have access to this question bank" body="Only staff of this organisation can manage its questions." /></V1Shell>;
  }

  const mine = (q: QuestionRow) => q.org_id === orgId;
  const filtered = query !== "" || type !== "all" || owner !== "all";
  const empty = rows.length === 0;

  return (
    <V1Shell title={title} subtitle={orgId === null ? "Shared once verified" : "Yours plus the global bank"}
             tabs={assessTabs(orgParam)}
             actions={<div className="hidden sm:flex gap-2">
               <Button size="sm" variant="outline" onClick={() => setGenerating(true)}>Generate with AI</Button>
               <Button size="sm" variant="outline" onClick={() => setEditing({ kind: "mcq", row: null })}>New MCQ</Button>
               <Button size="sm" onClick={() => setEditing({ kind: "coding", row: null })}>New coding question</Button>
             </div>}>
      <div className="space-y-4">
        <div>
          <h2 className="hr-display text-[22px]">{orgId === null ? "Global bank" : "Your bank"}</h2>
          <p className="text-sm text-[var(--hr-muted)] mt-1.5">
            {orgId === null ? "Verified questions every organisation can draw from." : "Your own questions plus every verified question from the global bank."}
          </p>
          <p className="hr-data text-sm text-foreground mt-1.5">
            {counts ? counts.verified : "–"} verified · {counts ? counts.draft : "–"} draft · {counts ? counts.retired : "–"} retired · {counts ? counts.coding : "–"} coding · {counts ? counts.mcq : "–"} MCQ
          </p>
        </div>

        <div className="flex sm:hidden flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setGenerating(true)}>Generate with AI</Button>
          <Button size="sm" variant="outline" onClick={() => setEditing({ kind: "mcq", row: null })}>New MCQ</Button>
          <Button size="sm" onClick={() => setEditing({ kind: "coding", row: null })}>New coding question</Button>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <div className="flex-1 min-w-48">
            <Label htmlFor="bank-search" className="hr-label">Search questions</Label>
            <Input id="bank-search" aria-label="Search questions" placeholder="Title or topic" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="w-36">
            <p className="hr-label mb-1.5">Type</p>
            <Select value={type} onValueChange={(v) => { setType(v as BankType); setPage(1); }}>
              <SelectTrigger aria-label="Type"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem><SelectItem value="coding">Coding</SelectItem><SelectItem value="mcq">MCQ</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {orgId !== null && (
            <div className="w-44">
              <p className="hr-label mb-1.5">Source</p>
              <Select value={owner} onValueChange={(v) => { setOwner(v as BankOwner); setPage(1); }}>
                <SelectTrigger aria-label="Source"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Ours and global</SelectItem><SelectItem value="ours">Ours only</SelectItem><SelectItem value="global">Global only</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        {orgId !== null && <RetireOverexposed orgId={orgId} onDone={(n) => {
          setNotice({ tone: "ok", text: n ? `Retired ${n} over-used question${n === 1 ? "" : "s"}.` : "No questions have been used that often." });
          void refresh();
        }} />}

        {notice && (
          <p role={notice.tone === "error" ? "alert" : "status"}
             className={`text-sm ${notice.tone === "error" ? "text-destructive" : "text-[var(--hr-gold)]"}`}>
            {notice.text}
          </p>
        )}
        {disputed && (
          <Button size="sm" variant="outline" className="self-start" onClick={() => setOverriding(true)}>Keep my key…</Button>
        )}

        {bank.isLoading ? <Loading /> : bank.error ? <p role="alert" className="text-sm text-destructive">{friendly(bank.error)}</p>
          : empty ? (
            <Empty stage={!filtered
                     ? [{ label: "Write", state: "current" }, { label: "Verify", state: "todo" }, { label: "Use", state: "todo" }]
                     : undefined}
                   title={filtered ? "No questions match" : "No questions yet"}
                   body={filtered ? "Try a different search, type or source." : "Write one, or generate a few with AI."}>
              {!filtered && <Button onClick={() => setGenerating(true)}>Generate with AI</Button>}
            </Empty>
          ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent"><TableHead className="hr-label">Title</TableHead><TableHead className="hr-label">Type</TableHead><TableHead className="hr-label">Difficulty</TableHead>
                <TableHead className="hr-label">Topics</TableHead><TableHead className="hr-label">Languages</TableHead>
                <TableHead className="hr-label">Status</TableHead>
                <TableHead className="hr-label text-right" title="Papers this question has been in">Papers</TableHead>
                <TableHead className="hr-label text-right">Actions</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((q) => (
                <TableRow key={q.id} className="hr-rule-b">
                  <TableCell className="font-medium">
                    {q.title}
                    {orgId !== null && q.org_id === null && <Chip tone="muted" className="ml-2">Global</Chip>}
                    {q.source === "ai" && <Chip tone="muted" className="ml-2">AI</Chip>}
                  </TableCell>
                  <TableCell>{q.type === "coding" ? "Coding" : q.multi_select ? "MCQ (multi)" : "MCQ"}</TableCell>
                  <TableCell className="capitalize">{q.difficulty}</TableCell>
                  <TableCell className="text-xs text-[var(--hr-muted)]">{q.topics.join(", ") || "–"}</TableCell>
                  <TableCell className="hr-data text-xs text-[var(--hr-muted)]">
                    {q.type === "coding" ? q.languages.map((l) => LANGUAGE_LABEL[l] ?? l).join(", ") || "–" : "–"}
                  </TableCell>
                  <TableCell><Chip tone={STATUS_TONE[q.status]} solid={q.status === "verified"}>{STATUS_LABEL[q.status]}</Chip></TableCell>
                  <TableCell className="hr-data text-right text-xs">{q.exposure_count ?? 0}</TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    {mine(q) ? (
                      <>
                        <Button size="sm" variant="ghost" onClick={() => setEditing({ kind: q.type, row: q })}>Edit</Button>
                        {q.status === "draft" && (
                          <Button size="sm" variant="ghost" disabled={busyId === q.id} onClick={() => verify(q.id)}>
                            {busyId === q.id ? "Verifying…" : "Verify"}
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" disabled={busyId === q.id} onClick={() => retire(q)}>
                          {q.status === "retired" ? "Restore" : "Retire"}
                        </Button>
                      </>
                    ) : <span className="text-xs text-[var(--hr-muted)]">Read only</span>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {total > BANK_PAGE && (
          <div className="flex justify-end items-center gap-2 text-sm">
            <Button size="sm" variant="outline" disabled={page <= 1 || bank.isFetching} onClick={() => setPage((p) => p - 1)}>Previous</Button>
            <span className="hr-data text-xs">Page {page} of {Math.ceil(total / BANK_PAGE)} · {total} questions</span>
            <Button size="sm" variant="outline" disabled={page * BANK_PAGE >= total || bank.isFetching} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        )}
      </div>
      <McqDialog open={editing?.kind === "mcq"} onOpenChange={(o) => { if (!o) setEditing(null); }} orgId={orgId} question={editing?.row}
                 onSaved={(id, ready) => { if (ready) void verify(id); else { setNotice({ tone: "ok", text: "Question saved." }); void refresh(); } }} />
      <OverrideDialog target={overriding ? disputed : null} onClose={() => setOverriding(false)}
                      onDone={() => { setOverriding(false); setDisputed(null); setNotice({ tone: "ok", text: "Verified with your reason. The override is recorded in the audit log." }); void refresh(); }} />
      <CodingDialog open={editing?.kind === "coding"} onOpenChange={(o) => { if (!o) setEditing(null); }} orgId={orgId} question={editing?.row}
                    onSaved={(id) => { void verify(id); }} />
      <GenerateDialog open={generating} onOpenChange={setGenerating} orgId={orgId} onDone={onGenerated} />
    </V1Shell>
  );
}

/** R2.3: retire this org's questions once they've been in too many papers (b2b_retire_overexposed). */
function RetireOverexposed({ orgId, onDone }: { orgId: string; onDone: (n: number) => void }) {
  const [threshold, setThreshold] = useState(200);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setBusy(true); setError(null);
    try {
      const { data, error: e } = await b2bDb.rpc("b2b_retire_overexposed", { _org_id: orgId, _threshold: threshold });
      if (e) throw new Error(e.message);
      onDone(Number(data));
    } catch (e) {
      setError(friendly(e));
    } finally { setBusy(false); }
  };
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-[var(--hr-muted)]">Retire your questions used in</span>
      <Input aria-label="Retire after this many papers" type="number" min={1} value={threshold} className="h-8 w-24"
             onChange={(e) => setThreshold(Math.max(1, Number(e.target.value) || 1))} />
      <span className="text-[var(--hr-muted)]">or more papers</span>
      <Button size="sm" variant="outline" onClick={() => void run()} disabled={busy}>{busy ? "Retiring…" : "Retire"}</Button>
      {error && <span role="alert" className="text-[var(--hr-red-ink)]">{error}</span>}
    </div>
  );
}
