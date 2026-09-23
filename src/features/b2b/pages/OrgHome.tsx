import { useMemo, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { B2BShell, CenteredSpinner, EmptyState, StatCard } from "../components/B2BShell";
import { useIsSuperAdmin, useMyMemberships, useOrgStudents, useOrgUsageSummary } from "../hooks/useB2B";
import { b2bDb } from "../lib/db";
import { daysLeft, formatDate, friendlyDbError } from "../lib/format";
import type { Organization } from "../types";

/** /org → first org the user staffs; /org/:orgId → that org (staff or super-admin). */
export default function OrgHome() {
  const { orgId: routeOrgId } = useParams();
  const memberships = useMyMemberships();
  const isSuper = useIsSuperAdmin();

  const staffOrgId = memberships.data?.find((m) => m.role !== "student")?.org_id;
  const orgId = routeOrgId ?? staffOrgId;

  if (memberships.isLoading || isSuper.isLoading) return <CenteredSpinner />;
  if (!orgId) {
    if (memberships.data?.some((m) => m.role === "student")) return <Navigate to="/learn" replace />;
    if (isSuper.data) return <Navigate to="/admin/orgs" replace />;
    return <Navigate to="/dashboard" replace />;
  }
  return <OrgOverview orgId={orgId} />;
}

function OrgOverview({ orgId }: { orgId: string }) {
  const org = useQuery({
    queryKey: ["b2b", "org", orgId],
    queryFn: async () => {
      const { data, error } = await b2bDb.from("organizations").select("*").eq("id", orgId).maybeSingle();
      if (error) throw error;
      return data as Organization | null;
    },
  });
  const summary = useOrgUsageSummary(orgId);
  const students = useOrgStudents(orgId);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return students.data ?? [];
    return (students.data ?? []).filter((s) =>
      [s.full_name, s.email, s.roll_no].some((v) => v?.toLowerCase().includes(q)),
    );
  }, [students.data, search]);

  if (org.isLoading || summary.isLoading) return <CenteredSpinner />;
  if (!org.data || summary.error) {
    return (
      <B2BShell title="Institution">
        <EmptyState title="You don't have access to this institution" body={summary.error ? friendlyDbError(summary.error) : undefined} />
      </B2BShell>
    );
  }

  const s = summary.data!;
  const perStudent = s.plan.interviews_per_student;
  const allocated = s.students * perStudent;
  const usedPct = allocated ? Math.round((s.interviews_used / allocated) * 100) : 0;
  const left = daysLeft(s.plan_ends_at);

  return (
    <B2BShell
      title={org.data.name}
      subtitle={`${s.plan.name} plan · ${formatDate(s.plan_starts_at)} – ${formatDate(s.plan_ends_at)}`}
      logoUrl={org.data.logo_url}
      isDemo={org.data.is_demo}
    >
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
        <EmptyState title="No students yet" body="Students appear here once they accept their invite (bulk CSV onboarding comes next)." />
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
                    <TableCell>{st.full_name ?? "—"}</TableCell>
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
    </B2BShell>
  );
}
