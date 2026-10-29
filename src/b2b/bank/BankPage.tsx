// /assess/bank/:orgId — the org's question bank (org editors) plus verified global questions.
// /assess/bank/global — the global bank (super admin only).
import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Empty, Loading, V1Shell, type ShellTab } from "../layout/V1Shell";
import { Chip, type Tone } from "../ui/broadcast";
import { ApiError, assessApi } from "../lib/api";
import { CodingDialog } from "./CodingDialog";
import { GenerateDialog, type GenerateResult } from "./GenerateDialog";
import { McqDialog } from "./McqDialog";
import { LANGUAGE_LABEL, type QuestionRow } from "./forms";
import { friendly, orgOf, setQuestionStatus, useBank, useCanEdit } from "./queries";

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
  const bank = useBank(orgId, canEdit.data === true);
  const [type, setType] = useState<"all" | "coding" | "mcq">("all");
  const [owner, setOwner] = useState<"all" | "ours" | "global">("all");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<{ kind: "mcq" | "coding"; row: QuestionRow | null } | null>(null);
  const [generating, setGenerating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: ["b2b-assess", "bank", orgId] });

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (bank.data ?? []).filter((q) => (type === "all" || q.type === type)
      && (owner === "all" || (owner === "global" ? q.org_id === null : q.org_id !== null))
      && (!s || q.title.toLowerCase().includes(s) || q.topics.some((t) => t.includes(s))));
  }, [bank.data, type, owner, search]);

  const counts = useMemo(() => {
    const all = bank.data ?? [];
    return {
      verified: all.filter((q) => q.status === "verified").length,
      draft: all.filter((q) => q.status === "draft").length,
      retired: all.filter((q) => q.status === "retired").length,
      coding: all.filter((q) => q.type === "coding").length,
      mcq: all.filter((q) => q.type === "mcq").length,
    };
  }, [bank.data]);

  const verify = async (id: string) => {
    setBusyId(id);
    setNotice(null);
    try {
      const r = await assessApi("verifyQuestion", { questionId: id }, { timeoutMs: 120_000 });
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
  const filtered = search.trim() !== "" || type !== "all" || owner !== "all";
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
            {bank.data ? counts.verified : "–"} verified · {bank.data ? counts.draft : "–"} draft · {bank.data ? counts.retired : "–"} retired · {bank.data ? counts.coding : "–"} coding · {bank.data ? counts.mcq : "–"} MCQ
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
            <Select value={type} onValueChange={(v) => setType(v as typeof type)}>
              <SelectTrigger aria-label="Type"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem><SelectItem value="coding">Coding</SelectItem><SelectItem value="mcq">MCQ</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {orgId !== null && (
            <div className="w-44">
              <p className="hr-label mb-1.5">Source</p>
              <Select value={owner} onValueChange={(v) => setOwner(v as typeof owner)}>
                <SelectTrigger aria-label="Source"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Ours and global</SelectItem><SelectItem value="ours">Ours only</SelectItem><SelectItem value="global">Global only</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        {notice && (
          <p role={notice.tone === "error" ? "alert" : "status"}
             className={`text-sm ${notice.tone === "error" ? "text-destructive" : "text-[var(--hr-gold)]"}`}>
            {notice.text}
          </p>
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
                <TableHead className="hr-label">Status</TableHead><TableHead className="hr-label text-right">Actions</TableHead></TableRow>
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
      </div>
      <McqDialog open={editing?.kind === "mcq"} onOpenChange={(o) => { if (!o) setEditing(null); }} orgId={orgId} question={editing?.row}
                 onSaved={() => { setNotice({ tone: "ok", text: "Question saved." }); void refresh(); }} />
      <CodingDialog open={editing?.kind === "coding"} onOpenChange={(o) => { if (!o) setEditing(null); }} orgId={orgId} question={editing?.row}
                    onSaved={(id) => { void verify(id); }} />
      <GenerateDialog open={generating} onOpenChange={setGenerating} orgId={orgId} onDone={onGenerated} />
    </V1Shell>
  );
}
