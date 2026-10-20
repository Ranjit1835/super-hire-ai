// /assess/bank/:orgId — the org's question bank (org editors) plus verified global questions.
// /assess/bank/global — the global bank (super admin only).
import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Empty, Loading, V1Shell, type ShellTab } from "../layout/V1Shell";
import { ApiError, assessApi } from "../lib/api";
import { CodingDialog } from "./CodingDialog";
import { GenerateDialog, type GenerateResult } from "./GenerateDialog";
import { McqDialog } from "./McqDialog";
import type { QuestionRow } from "./forms";
import { friendly, orgOf, setQuestionStatus, useBank, useCanEdit } from "./queries";

export function assessTabs(orgParam: string): ShellTab[] {
  if (orgParam === "global") return [{ to: "/assess/bank/global", label: "Global question bank" }];
  // /portal/:orgId sends company orgs to /co/:orgId and colleges to /c/:orgId (track E).
  return [{ to: `/portal/${orgParam}`, label: "Portal" }, { to: `/assess/tests/${orgParam}`, label: "Tests" }, { to: `/assess/bank/${orgParam}`, label: "Question bank" }];
}

const STATUS_LABEL: Record<QuestionRow["status"], string> = { draft: "Draft", verified: "Verified", retired: "Retired" };

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

  return (
    <V1Shell title={title} subtitle={orgId === null ? "Shared with every organisation once verified" : "Your questions plus verified questions from the global bank"}
             tabs={assessTabs(orgParam)}
             actions={<div className="hidden sm:flex gap-2">
               <Button size="sm" variant="outline" onClick={() => setGenerating(true)}>Generate with AI</Button>
               <Button size="sm" variant="outline" onClick={() => setEditing({ kind: "mcq", row: null })}>New MCQ</Button>
               <Button size="sm" onClick={() => setEditing({ kind: "coding", row: null })}>New coding question</Button>
             </div>}>
      <div className="flex sm:hidden flex-wrap gap-2 mb-4">
        <Button size="sm" variant="outline" onClick={() => setGenerating(true)}>Generate with AI</Button>
        <Button size="sm" variant="outline" onClick={() => setEditing({ kind: "mcq", row: null })}>New MCQ</Button>
        <Button size="sm" onClick={() => setEditing({ kind: "coding", row: null })}>New coding question</Button>
      </div>
      <div className="flex flex-wrap gap-2 mb-4">
        <Input aria-label="Search questions" placeholder="Search by title or topic" className="max-w-xs" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select value={type} onValueChange={(v) => setType(v as typeof type)}>
          <SelectTrigger aria-label="Type" className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem><SelectItem value="coding">Coding</SelectItem><SelectItem value="mcq">MCQ</SelectItem>
          </SelectContent>
        </Select>
        {orgId !== null && (
          <Select value={owner} onValueChange={(v) => setOwner(v as typeof owner)}>
            <SelectTrigger aria-label="Source" className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Ours and global</SelectItem><SelectItem value="ours">Ours only</SelectItem><SelectItem value="global">Global only</SelectItem>
            </SelectContent>
          </Select>
        )}
      </div>
      {notice && <p role={notice.tone === "error" ? "alert" : "status"} className={`mb-4 text-sm ${notice.tone === "error" ? "text-destructive" : "text-emerald-600"}`}>{notice.text}</p>}
      {bank.isLoading ? <Loading /> : bank.error ? <p role="alert" className="text-sm text-destructive">{friendly(bank.error)}</p>
        : rows.length === 0 ? <Empty title="No questions yet" body="Write one, or generate a few with AI." /> : (
        <Table>
          <TableHeader>
            <TableRow><TableHead>Title</TableHead><TableHead>Type</TableHead><TableHead>Difficulty</TableHead><TableHead>Topics</TableHead>
              <TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((q) => (
              <TableRow key={q.id}>
                <TableCell className="font-medium">
                  {q.title}
                  {orgId !== null && q.org_id === null && <Badge variant="secondary" className="ml-2">Global</Badge>}
                  {q.source === "ai" && <Badge variant="outline" className="ml-2">AI</Badge>}
                </TableCell>
                <TableCell>{q.type === "coding" ? "Coding" : q.multi_select ? "MCQ (multi)" : "MCQ"}</TableCell>
                <TableCell className="capitalize">{q.difficulty}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{q.topics.join(", ")}</TableCell>
                <TableCell><Badge variant={q.status === "verified" ? "default" : "outline"}>{STATUS_LABEL[q.status]}</Badge></TableCell>
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
                  ) : <span className="text-xs text-muted-foreground">Read only</span>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <McqDialog open={editing?.kind === "mcq"} onOpenChange={(o) => { if (!o) setEditing(null); }} orgId={orgId} question={editing?.row}
                 onSaved={() => { setNotice({ tone: "ok", text: "Question saved." }); void refresh(); }} />
      <CodingDialog open={editing?.kind === "coding"} onOpenChange={(o) => { if (!o) setEditing(null); }} orgId={orgId} question={editing?.row}
                    onSaved={(id) => { void verify(id); }} />
      <GenerateDialog open={generating} onOpenChange={setGenerating} orgId={orgId} onDone={onGenerated} />
    </V1Shell>
  );
}
