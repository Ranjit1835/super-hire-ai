import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CenteredSpinner, EmptyState, StatCard } from "../components/B2BShell";
import { useOrgStudents, useOrgUsageSummary } from "../hooks/useB2B";
import { daysLeft, formatDate, friendlyDbError } from "../lib/format";
import { useOrgContext } from "../components/OrgContext";

/** /org/:orgId — plan usage + student roster. */
export default function OrgOverview() {
  const { org, canManage } = useOrgContext();
  const summary = useOrgUsageSummary(org.id);
  const students = useOrgStudents(org.id);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return students.data ?? [];
    return (students.data ?? []).filter((s) =>
      [s.full_name, s.email, s.roll_no].some((v) => v?.toLowerCase().includes(q)),
    );
  }, [students.data, search]);

  if (summary.isLoading) return <CenteredSpinner />;
  if (summary.error || !summary.data) {
    return <EmptyState title="Couldn't load usage" body={friendlyDbError(summary.error)} />;
  }

  const s = summary.data;
  const perStudent = s.plan.interviews_per_student;
  const allocated = s.students * perStudent;
  const usedPct = allocated ? Math.round((s.interviews_used / allocated) * 100) : 0;
  const left = daysLeft(s.plan_ends_at);

  return (
    <>
      <p className="text-sm text-muted-foreground mb-4">
        {s.plan.name} plan · {formatDate(s.plan_starts_at)} – {formatDate(s.plan_ends_at)}
      </p>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <StatCard
          label="Students enrolled"
          value={s.plan.max_students ? `${s.students} / ${s.plan.max_students}` : s.students}
          tone={s.plan.max_students && s.students >= s.plan.max_students ? "warn" : undefined}
        />
        <StatCard
          label="Interviews used"
          value={`${s.interviews_used} / ${allocated}`}
          hint={<Progress value={usedPct} className="h-1.5 mt-2" aria-label={`${usedPct}% of interviews used`} />}
        />
        <StatCard label="Interviews per student" value={perStudent} hint={`${s.students_exhausted} students have used all`} />
        <StatCard
          label="Plan time left"
          value={left === null ? "No end date" : left > 0 ? `${left} days` : "Ended"}
          tone={left !== null && left <= 7 ? "warn" : undefined}
        />
      </div>

      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 className="font-semibold">Students</h2>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, email or roll no"
          className="max-w-xs"
          aria-label="Search students"
        />
      </div>

      {students.isLoading ? (
        <CenteredSpinner />
      ) : !students.data?.length ? (
        <EmptyState
          title="No students yet"
          body="Students appear here once they accept their invite. Upload your roster to send invites."
        >
          {canManage && (
            <Button asChild><Link to={`/org/${org.id}/import`}>Add students</Link></Button>
          )}
        </EmptyState>
      ) : (
        <div className="rounded-lg border border-border/60 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Roll no</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead className="text-right">Interviews used</TableHead>
                <TableHead className="text-right">Remaining</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((st) => {
                const remaining = Math.max(perStudent - st.interviews_used, 0);
                return (
                  <TableRow key={st.id}>
                    <TableCell className="tabular-nums">{st.roll_no ?? "—"}</TableCell>
                    <TableCell>
                      <Link to={`/org/${org.id}/students/${st.user_id}`} className="hover:underline">{st.full_name ?? "—"}</Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{st.email ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{st.interviews_used}</TableCell>
                    <TableCell className={`text-right tabular-nums ${remaining === 0 ? "text-amber-300" : ""}`}>{remaining}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}
