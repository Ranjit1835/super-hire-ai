import { Link, Navigate } from "react-router-dom";
import { Mic, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { B2BShell, CenteredSpinner, EmptyState, StatCard } from "../components/B2BShell";
import { ModuleMeta } from "../components/ModuleMeta";
import { useMyMemberships, useMyQuota, useStudentModules } from "../hooks/useB2B";
import { useMyInterviews } from "../hooks/useLiveInterview";
import { daysLeft, formatDate } from "../lib/format";
import { READINESS_LABEL, READINESS_STYLE } from "../lib/report-style";
import { COMPANY_PACK_DISCLAIMER, MODULE_TYPE_LABEL } from "../lib/shared";

/** Student home: remaining interviews + the modules their institution enabled. */
export default function LearnHome() {
  const memberships = useMyMemberships();
  const quota = useMyQuota();
  const studentOf = (memberships.data ?? []).filter((m) => m.role === "student");
  const first = studentOf[0];
  const modules = useStudentModules(first?.org_id);
  const interviews = useMyInterviews(first?.org_id);

  if (memberships.isLoading || quota.isLoading) return <CenteredSpinner />;
  if (!first) return <Navigate to="/dashboard" replace />;

  const org = first.organizations;
  const q = (quota.data ?? []).find((x) => x.org_id === first.org_id);
  const left = daysLeft(q?.plan_ends_at);
  const hasPacks = (modules.data ?? []).some((m) => m.type === "company_pack");
  const liveIv = interviews.data?.find((i) => i.status === "in_progress");
  const doneByModule = new Map<string, number>();
  for (const i of interviews.data ?? []) if (i.status === "completed") doneByModule.set(i.module_id, (doneByModule.get(i.module_id) ?? 0) + 1);
  const noneLeft = !!q && q.interviews_remaining <= 0;

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

        {liveIv && (
          <Link
            to={`/learn/interview/${liveIv.module_id}`}
            className="flex items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 hover:bg-emerald-500/15"
          >
            <RotateCcw className="h-5 w-5 text-emerald-300" />
            <span className="text-sm flex-1">Continue your <strong>{liveIv.module_name}</strong> interview (question {Number(liveIv.turn_count) + 1})</span>
          </Link>
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
                  <div className="mt-auto pt-2 flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">
                      {doneByModule.get(m.id) ? `Completed ${doneByModule.get(m.id)}×` : "Not attempted yet"}
                    </span>
                    {liveIv?.module_id === m.id ? (
                      <Button size="sm" asChild><Link to={`/learn/interview/${m.id}`}><RotateCcw className="h-4 w-4 mr-1" /> Resume</Link></Button>
                    ) : (
                      <Button size="sm" asChild={!noneLeft && !liveIv} disabled={noneLeft || !!liveIv}>
                        {!noneLeft && !liveIv ? <Link to={`/learn/interview/${m.id}`}><Mic className="h-4 w-4 mr-1" /> Start interview</Link> : <span><Mic className="h-4 w-4 mr-1 inline" /> Start interview</span>}
                      </Button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
          {hasPacks && <p className="text-xs text-muted-foreground mt-3">Company-style modules: {COMPANY_PACK_DISCLAIMER}</p>}
        </section>

        {(interviews.data ?? []).some((i) => i.status !== "in_progress") && (
          <section>
            <h2 className="font-semibold mb-1">Your interviews</h2>
            {(() => {
              const scored = (interviews.data ?? []).filter((i) => i.overall_score !== null).reverse(); // oldest first
              if (scored.length < 2) return <div className="mb-3" />;
              const first = Number(scored[0].overall_score), last = Number(scored.at(-1)!.overall_score);
              const d = Math.round((last - first) * 10) / 10;
              return (
                <p className="text-sm text-muted-foreground mb-3">
                  Your progress: first <strong className="text-foreground">{first}</strong> → latest <strong className="text-foreground">{last}</strong>{" "}
                  <span className={d > 0 ? "text-emerald-300" : d < 0 ? "text-red-300" : ""}>({d > 0 ? "+" : ""}{d})</span>
                </p>
              );
            })()}
            <ul className="rounded-lg border border-border/60 divide-y divide-border/60">
              {(interviews.data ?? []).filter((i) => i.status !== "in_progress").map((i) => (
                <li key={i.id}>
                  <Link to={`/learn/report/${i.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-white/5">
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm truncate">{i.module_name}</span>
                      <span className="block text-xs text-muted-foreground">{formatDate(i.started_at)} · {Number(i.turn_count)} answers</span>
                    </span>
                    {i.readiness_level ? (
                      <>
                        <span className="text-sm tabular-nums">{i.overall_score ?? "—"}/10</span>
                        <Badge variant="outline" className={READINESS_STYLE[i.readiness_level]}>{READINESS_LABEL[i.readiness_level]}</Badge>
                      </>
                    ) : (
                      <span className="text-xs text-muted-foreground">Report pending</span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </B2BShell>
  );
}
