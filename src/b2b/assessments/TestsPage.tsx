// /assess/tests/:orgId — the org's tests (assessments). Staff build them from the question bank.
import { Link, useParams } from "react-router-dom";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Empty, Loading, V1Shell } from "../layout/V1Shell";
import { Chip, type Tone } from "../ui/broadcast";
import { assessTabs } from "../bank/BankPage";
import { friendly, useAssessments, useCanEdit } from "../bank/queries";
import { describeRule, type PoolRule } from "../bank/forms";

const STATUS_LABEL = { draft: "Draft", ready: "Ready", archived: "Archived" } as const;
const STATUS_TONE: Record<keyof typeof STATUS_LABEL, Tone> = { ready: "gold", draft: "muted", archived: "muted" };

export default function TestsPage() {
  const { orgId = "" } = useParams();
  const canEdit = useCanEdit(orgId);
  const list = useAssessments(orgId);

  if (canEdit.isLoading) return <V1Shell title="Tests"><Loading /></V1Shell>;
  if (canEdit.data !== true) {
    return <V1Shell title="Tests"><Empty title="You don't have access to these tests" body="Only staff of this organisation can build tests." /></V1Shell>;
  }

  return (
    <V1Shell title="Tests" subtitle="Built from your question bank" tabs={assessTabs(orgId)}>
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="hr-display text-[22px]">Tests</h2>
            <p className="text-sm text-[var(--hr-muted)] mt-1">Each test is sections drawn from the question bank by rule or by hand.</p>
          </div>
          <Button asChild><Link to={`/assess/tests/${orgId}/new`}><Plus className="h-4 w-4 mr-1" />New test</Link></Button>
        </div>

        {list.isLoading ? <Loading /> : list.error ? <p role="alert" className="text-sm text-destructive">{friendly(list.error)}</p>
          : (list.data ?? []).length === 0 ? (
            <Empty stage={[{ label: "Bank", state: "done" }, { label: "Build", state: "current" }, { label: "Assign", state: "todo" }]}
                   title="No tests yet" body="A test is a set of sections; each section picks questions from the bank by rule or by hand.">
              <Button asChild><Link to={`/assess/tests/${orgId}/new`}>Build your first test</Link></Button>
            </Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="hr-label">Title</TableHead><TableHead className="hr-label">Sections</TableHead><TableHead className="hr-label">Duration</TableHead>
                  <TableHead className="hr-label">Proctoring</TableHead><TableHead className="hr-label">Status</TableHead><TableHead /></TableRow>
              </TableHeader>
              <TableBody>
                {(list.data ?? []).map((a) => (
                  <TableRow key={a.id} className="hr-rule-b">
                    <TableCell className="font-medium">{a.title}{a.practice_enabled && <Chip tone="muted" className="ml-2">Practice</Chip>}</TableCell>
                    <TableCell className="text-xs text-[var(--hr-muted)]">
                      {a.sections.map((s) => `${s.title}: ${[
                        ...(s.pick ?? []).map((p) => describeRule({ difficulty: (p.difficulty ?? "") as PoolRule["difficulty"], topics: (p.topics ?? []).join(","), count: p.count })),
                        ...(s.question_ids?.length ? [`${s.question_ids.length} chosen`] : []),
                      ].join(" + ")}`).join(" · ")}
                    </TableCell>
                    <TableCell className="hr-data text-sm whitespace-nowrap">{a.duration_min} min</TableCell>
                    <TableCell className="capitalize">{a.proctoring_policy}</TableCell>
                    <TableCell><Chip tone={STATUS_TONE[a.status]} solid={a.status === "ready"}>{STATUS_LABEL[a.status]}</Chip></TableCell>
                    <TableCell className="text-right"><Button size="sm" variant="ghost" asChild><Link to={`/assess/tests/${orgId}/${a.id}`}>Edit</Link></Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
      </div>
    </V1Shell>
  );
}
