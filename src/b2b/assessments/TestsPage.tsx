// /assess/tests/:orgId — the org's tests (assessments). Staff build them from the question bank.
import { Link, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Empty, Loading, V1Shell } from "../layout/V1Shell";
import { assessTabs } from "../bank/BankPage";
import { friendly, useAssessments, useCanEdit } from "../bank/queries";
import { describeRule, type PoolRule } from "../bank/forms";

const STATUS_LABEL = { draft: "Draft", ready: "Ready", archived: "Archived" } as const;

export default function TestsPage() {
  const { orgId = "" } = useParams();
  const canEdit = useCanEdit(orgId);
  const list = useAssessments(orgId);

  if (canEdit.isLoading) return <V1Shell title="Tests"><Loading /></V1Shell>;
  if (canEdit.data !== true) {
    return <V1Shell title="Tests"><Empty title="You don't have access to these tests" body="Only staff of this organisation can build tests." /></V1Shell>;
  }

  return (
    <V1Shell title="Tests" subtitle="Coding and MCQ tests built from your question bank" tabs={assessTabs(orgId)}
             actions={<Button size="sm" asChild><Link to={`/assess/tests/${orgId}/new`}>New test</Link></Button>}>
      {list.isLoading ? <Loading /> : list.error ? <p role="alert" className="text-sm text-destructive">{friendly(list.error)}</p>
        : (list.data ?? []).length === 0 ? (
          <Empty title="No tests yet" body="A test is a set of sections; each section picks questions from the bank by rule or by hand.">
            <Button asChild><Link to={`/assess/tests/${orgId}/new`}>Build your first test</Link></Button>
          </Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow><TableHead>Title</TableHead><TableHead>Sections</TableHead><TableHead>Duration</TableHead>
                <TableHead>Proctoring</TableHead><TableHead>Status</TableHead><TableHead /></TableRow>
            </TableHeader>
            <TableBody>
              {(list.data ?? []).map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-medium">{a.title}{a.practice_enabled && <Badge variant="outline" className="ml-2">Practice</Badge>}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {a.sections.map((s) => `${s.title}: ${[
                      ...(s.pick ?? []).map((p) => describeRule({ difficulty: (p.difficulty ?? "") as PoolRule["difficulty"], topics: (p.topics ?? []).join(","), count: p.count })),
                      ...(s.question_ids?.length ? [`${s.question_ids.length} chosen`] : []),
                    ].join(" + ")}`).join(" · ")}
                  </TableCell>
                  <TableCell>{a.duration_min} min</TableCell>
                  <TableCell className="capitalize">{a.proctoring_policy}</TableCell>
                  <TableCell><Badge variant={a.status === "ready" ? "default" : "outline"}>{STATUS_LABEL[a.status]}</Badge></TableCell>
                  <TableCell className="text-right"><Button size="sm" variant="ghost" asChild><Link to={`/assess/tests/${orgId}/${a.id}`}>Edit</Link></Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
    </V1Shell>
  );
}
