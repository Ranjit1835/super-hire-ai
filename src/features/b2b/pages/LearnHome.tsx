import { Navigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { B2BShell, CenteredSpinner, EmptyState, StatCard } from "../components/B2BShell";
import { ModuleMeta } from "../components/ModuleMeta";
import { useMyMemberships, useMyQuota, useStudentModules } from "../hooks/useB2B";
import { daysLeft, formatDate } from "../lib/format";
import { COMPANY_PACK_DISCLAIMER, MODULE_TYPE_LABEL } from "../lib/shared";

/** Student home: remaining interviews + the modules their institution enabled. */
export default function LearnHome() {
  const memberships = useMyMemberships();
  const quota = useMyQuota();
  const studentOf = (memberships.data ?? []).filter((m) => m.role === "student");
  const first = studentOf[0];
  const modules = useStudentModules(first?.org_id);

  if (memberships.isLoading || quota.isLoading) return <CenteredSpinner />;
  if (!first) return <Navigate to="/dashboard" replace />;

  const org = first.organizations;
  const q = (quota.data ?? []).find((x) => x.org_id === first.org_id);
  const left = daysLeft(q?.plan_ends_at);
  const hasPacks = (modules.data ?? []).some((m) => m.type === "company_pack");

  return (
    <B2BShell title={org.name} subtitle="Interview practice" logoUrl={org.logo_url} isDemo={org.is_demo}>
      <div className="space-y-6 max-w-4xl">
        {q && (
          <div className="grid grid-cols-2 gap-3 max-w-xl">
            <StatCard
              label="Interviews left"
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
        )}

        <section>
          <h2 className="font-semibold mb-3">Practice modules</h2>
          {modules.isLoading ? (
            <CenteredSpinner />
          ) : !modules.data?.length ? (
            <EmptyState title="No modules yet" body={`${org.name} hasn't enabled any interview modules yet. Check back soon.`} />
          ) : (
            <div className="grid sm:grid-cols-2 gap-3">
              {modules.data.map((m) => (
                <article key={m.id} className="rounded-lg border border-border/60 bg-card/40 p-4 flex flex-col gap-2">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-medium leading-snug">{m.name}</h3>
                    <Badge variant="outline" className="shrink-0 text-[10px]">{MODULE_TYPE_LABEL[m.type]}</Badge>
                  </div>
                  {m.spec.description && <p className="text-sm text-muted-foreground">{m.spec.description}</p>}
                  <ModuleMeta m={m} />
                  <details className="text-xs text-muted-foreground">
                    <summary className="cursor-pointer">What you'll be asked about</summary>
                    <ul className="list-disc pl-4 mt-1 space-y-0.5">{m.spec.topics.map((t) => <li key={t}>{t}</li>)}</ul>
                  </details>
                  <p className="text-xs text-muted-foreground mt-auto pt-1">Voice interviews open here shortly.</p>
                </article>
              ))}
            </div>
          )}
          {hasPacks && <p className="text-xs text-muted-foreground mt-3">Company-style modules: {COMPANY_PACK_DISCLAIMER}</p>}
        </section>
      </div>
    </B2BShell>
  );
}
