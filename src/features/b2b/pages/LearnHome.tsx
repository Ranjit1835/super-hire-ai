import { Navigate } from "react-router-dom";
import { B2BShell, CenteredSpinner, EmptyState, StatCard } from "../components/B2BShell";
import { useMyMemberships, useMyQuota } from "../hooks/useB2B";
import { daysLeft, formatDate } from "../lib/format";

/** Student home: remaining interviews per institution. Modules and reports land in later steps. */
export default function LearnHome() {
  const memberships = useMyMemberships();
  const quota = useMyQuota();

  if (memberships.isLoading || quota.isLoading) return <CenteredSpinner />;
  const studentOf = (memberships.data ?? []).filter((m) => m.role === "student");
  if (!studentOf.length) return <Navigate to="/dashboard" replace />;

  const first = studentOf[0].organizations;

  return (
    <B2BShell title={first.name} subtitle="Interview practice" logoUrl={first.logo_url} isDemo={first.is_demo}>
      <div className="space-y-4 max-w-2xl">
        {(quota.data ?? []).map((q) => {
          const left = daysLeft(q.plan_ends_at);
          return (
            <div key={q.org_id} className="grid grid-cols-2 gap-3">
              <StatCard
                label={studentOf.length > 1 ? `Interviews left · ${q.org_name}` : "Interviews left"}
                value={`${q.interviews_remaining} of ${q.interviews_limit}`}
                tone={q.interviews_remaining === 0 ? "warn" : "ok"}
                hint={q.interviews_remaining === 0 ? "You've used all interviews in this plan." : undefined}
              />
              <StatCard
                label="Available until"
                value={q.plan_ends_at ? formatDate(q.plan_ends_at) : "—"}
                hint={left !== null && left > 0 ? `${left} days left` : left !== null ? "Plan has ended" : undefined}
                tone={left !== null && left <= 0 ? "warn" : undefined}
              />
            </div>
          );
        })}
        <EmptyState
          title="Your interview modules will appear here"
          body="Your institution is setting up practice modules (Java, SQL, DSA, HR and company-style rounds)."
        />
      </div>
    </B2BShell>
  );
}
