// /c/:orgId/drives/:driveId/similarity — R2.8. Coding answers compared pairwise by Dolos (similarity %, longest shared
// fragment, matched lines side by side) and MCQ answer patterns (the same wrong choices). Evidence for a person to
// look at; short, standard problems often have similar honest solutions, so nothing here is a verdict.
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { b2bDb } from "@/features/b2b/lib/db";
import { cn } from "@/lib/utils";
import { Loading, Empty } from "../layout/V1Shell";
import { Chip, type Tone } from "../ui/broadcast";
import { CollegeShell } from "./CollegeShell";
import { fmtDateTime, friendly, useDrive } from "./queries";

interface Who { student_id: string; name: string; roll_no: string }
export interface SimilarityOverview {
  runs: { id: string; question: string; language: string; status: "queued" | "running" | "done" | "failed"; submissions: number; created_at: string; finished_at: string | null }[];
  pairs: { id: number; question: string; language: string; similarity: number; longest: number; a: Who; b: Who }[];
  mcq: { shared_wrong: number; wrong_a: number; wrong_b: number; a: Who; b: Who }[];
}
type Region = [number, number, number, number];
export interface SimilarityPair {
  id: number; similarity: number; longest: number; language: string; question: string;
  fragments: { a: Region; b: Region }[];
  a: { name: string; roll_no: string; code: string | null }; b: { name: string; roll_no: string; code: string | null };
}

const LANGUAGE_LABEL: Record<string, string> = { python: "Python 3", java: "Java", cpp: "C++", c: "C", javascript: "JavaScript" };
const RUN_LABEL = { queued: "Queued", running: "Checking", done: "Done", failed: "Failed" } as const;
const RUN_TONE: Record<keyof typeof RUN_LABEL, Tone> = { queued: "muted", running: "blue", done: "plain", failed: "red" };
const pct = (v: number) => `${Math.round(Number(v) * 100)}%`;

export const similarityKey = (driveId: string) => ["b2b-v1", "similarity", driveId];

/** Lines (0-based) covered by the matched regions on one side. */
export function matchedLines(fragments: { a: Region; b: Region }[], side: "a" | "b"): Set<number> {
  const out = new Set<number>();
  for (const f of fragments) {
    const [start, , end] = f[side];
    for (let i = start; i <= end && i - start < 10_000; i++) out.add(i);
  }
  return out;
}

export default function SimilarityPage() {
  const { driveId = "" } = useParams();
  return <CollegeShell>{({ orgId, isAdmin }) => <Similarity orgId={orgId} driveId={driveId} isAdmin={isAdmin} />}</CollegeShell>;
}

export function Similarity({ orgId, driveId, isAdmin }: { orgId: string; driveId: string; isAdmin: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const drive = useDrive(driveId);
  const [compare, setCompare] = useState<number | null>(null);
  const data = useQuery({
    queryKey: similarityKey(driveId),
    queryFn: async () => {
      const { data: r, error } = await b2bDb.rpc("b2b_drive_similarity", { _drive_id: driveId });
      if (error) throw error;
      return r as SimilarityOverview;
    },
    // Poll while a check is waiting or running.
    refetchInterval: (q) => (q.state.data?.runs.some((r) => r.status === "queued" || r.status === "running") ? 15_000 : false),
  });
  const request = useMutation({
    mutationFn: async () => {
      const { data: n, error } = await b2bDb.rpc("b2b_request_similarity", { _drive_id: driveId });
      if (error) throw error;
      return Number(n ?? 0);
    },
    onSuccess: (n) => {
      toast({ title: n ? `${n} check${n === 1 ? "" : "s"} queued` : "Already up to date",
              description: n ? "Results usually appear within 10 minutes." : "No answers changed since the last check." });
      void qc.invalidateQueries({ queryKey: similarityKey(driveId) });
    },
    onError: (e) => toast({ title: "Couldn't start the check", description: friendly(e), variant: "destructive" }),
  });

  if (data.isLoading || drive.isLoading) return <Loading />;
  if (data.error || !data.data) return <Empty title="Couldn't load similarity" body={data.error ? friendly(data.error) : undefined} />;
  const { runs, pairs, mcq } = data.data;

  return (
    <div className="space-y-6">
      <nav aria-label="Breadcrumb" className="text-xs text-[var(--hr-muted)]">
        <Link to={`/c/${orgId}/drives`} className="hover:text-foreground">Drives</Link> /{" "}
        <Link to={`/c/${orgId}/drives/${driveId}`} className="hover:text-foreground">{drive.data?.name ?? "Drive"}</Link> /{" "}
        <span className="text-foreground">Similarity</span>
      </nav>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="hr-display text-[26px]">Similarity</h2>
          <p className="text-sm text-[var(--hr-muted)] max-w-2xl mt-1">
            Pairs of students whose answers look alike. Short, standard problems often have similar honest solutions, so look
            at the matched code before deciding anything. Checks run automatically after the drive window closes.
          </p>
        </div>
        {isAdmin && <Button onClick={() => request.mutate()} disabled={request.isPending}>Check now</Button>}
      </div>

      <section aria-labelledby="sim-runs" className="space-y-2">
        <h3 id="sim-runs" className="hr-label">Checks</h3>
        {runs.length === 0 ? <p className="text-sm text-[var(--hr-muted)]">No checks yet. They need at least two finished coding answers in the same language.</p> : (
          <ul className="flex flex-wrap gap-2">
            {runs.map((r) => (
              <li key={r.id} className="flex items-center gap-2 text-sm shadow-[inset_0_0_0_1px_var(--hr-rule)] px-2.5 py-1.5">
                <span>{r.question}</span>
                <span className="text-[var(--hr-muted)]">{LANGUAGE_LABEL[r.language] ?? r.language} · {r.submissions} answers</span>
                <Chip tone={RUN_TONE[r.status]}>{RUN_LABEL[r.status]}</Chip>
                {r.finished_at && <span className="hr-data text-xs text-[var(--hr-muted)]">{fmtDateTime(r.finished_at)}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="sim-code" className="space-y-2">
        <h3 id="sim-code" className="hr-label">Coding answers</h3>
        {pairs.length === 0 ? <p className="text-sm text-[var(--hr-muted)]">No pairs at 30% similarity or more.</p> : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Similarity</TableHead><TableHead>Students</TableHead><TableHead>Question</TableHead>
                <TableHead className="hidden md:table-cell">Longest match</TableHead><TableHead><span className="sr-only">Compare</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pairs.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className={cn("hr-data w-10", p.similarity >= 0.8 && "text-[var(--hr-red)] font-semibold")}>{pct(p.similarity)}</span>
                      <span aria-hidden className="h-1.5 w-16 bg-[var(--hr-rule)] hidden sm:block">
                        <span className="block h-full" style={{ width: pct(p.similarity), background: p.similarity >= 0.8 ? "var(--hr-red)" : "var(--hr-muted)" }} />
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">{p.a.name} <span className="hr-data text-xs text-[var(--hr-muted)]">{p.a.roll_no}</span>
                    {" · "}{p.b.name} <span className="hr-data text-xs text-[var(--hr-muted)]">{p.b.roll_no}</span></TableCell>
                  <TableCell className="text-sm">{p.question} <span className="text-[var(--hr-muted)]">({LANGUAGE_LABEL[p.language] ?? p.language})</span></TableCell>
                  <TableCell className="hidden md:table-cell hr-data text-xs">{p.longest} tokens</TableCell>
                  <TableCell><Button size="sm" variant="outline" onClick={() => setCompare(p.id)}
                                     aria-label={`Compare ${p.a.name} and ${p.b.name}`}>Compare</Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      <section aria-labelledby="sim-mcq" className="space-y-2">
        <h3 id="sim-mcq" className="hr-label">MCQ answer patterns</h3>
        <p className="text-xs text-[var(--hr-muted)]">Pairs who picked the same wrong option on 3 or more questions they both answered. Matching right answers don't count.</p>
        {mcq.length === 0 ? <p className="text-sm text-[var(--hr-muted)]">No unusual patterns.</p> : (
          <ul className="space-y-1.5">
            {mcq.map((m, i) => (
              <li key={i} className="text-sm">
                {m.a.name} <span className="hr-data text-xs text-[var(--hr-muted)]">{m.a.roll_no}</span> and {m.b.name}{" "}
                <span className="hr-data text-xs text-[var(--hr-muted)]">{m.b.roll_no}</span>:{" "}
                <span className="font-semibold">{m.shared_wrong} identical wrong answers</span>{" "}
                <span className="text-[var(--hr-muted)]">(of {m.wrong_a} and {m.wrong_b} wrong)</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <CompareDialog pairId={compare} onClose={() => setCompare(null)} />
    </div>
  );
}

function CompareDialog({ pairId, onClose }: { pairId: number | null; onClose: () => void }) {
  const q = useQuery({
    queryKey: ["b2b-v1", "similarity-pair", pairId],
    enabled: pairId != null,
    queryFn: async () => {
      const { data, error } = await b2bDb.rpc("b2b_similarity_pair", { _pair_id: pairId });
      if (error) throw error;
      return data as SimilarityPair;
    },
  });
  return (
    <Dialog open={pairId != null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-6xl w-[calc(100vw-2rem)] max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{q.data ? `${q.data.question}: ${pct(q.data.similarity)} similar` : "Compare answers"}</DialogTitle>
          <DialogDescription>Highlighted lines are the parts Dolos matched between the two answers.</DialogDescription>
        </DialogHeader>
        {q.isLoading ? <Loading /> : !q.data ? <Empty title="Couldn't load this pair" /> : (
          <div className="grid gap-3 md:grid-cols-2">
            {(["a", "b"] as const).map((side) => (
              <CodeColumn key={side} who={q.data[side]} lines={matchedLines(q.data.fragments, side)} />
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CodeColumn({ who, lines }: { who: { name: string; roll_no: string; code: string | null }; lines: Set<number> }) {
  const code = (who.code ?? "").split("\n");
  return (
    <figure className="min-w-0">
      <figcaption className="text-sm font-semibold mb-1">{who.name} <span className="hr-data text-xs text-[var(--hr-muted)] font-normal">{who.roll_no}</span></figcaption>
      <pre aria-label={`${who.name}'s answer`} className="hr-data text-xs leading-5 bg-[var(--hr-surface)] shadow-[inset_0_0_0_1px_var(--hr-rule)] p-2 overflow-auto max-h-[60vh]">
        {code.map((l, i) => (
          <div key={i} data-matched={lines.has(i) || undefined} className={cn("flex", lines.has(i) && "bg-[color-mix(in_srgb,var(--hr-orange)_22%,transparent)]")}>
            <span aria-hidden className="select-none w-8 shrink-0 text-right pr-3 text-[var(--hr-muted)]">{i + 1}</span>
            <span className="whitespace-pre">{l || " "}</span>
          </div>
        ))}
      </pre>
    </figure>
  );
}
