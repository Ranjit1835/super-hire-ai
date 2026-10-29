// A student's home (/learn/v1): the drives assigned to them and the practice tests their college has published.
// Calm, not a broadcast table: one student, their own work, nothing ranked against anyone else.
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { V1Shell, Loading, Empty } from "../layout/V1Shell";
import { Chip, type Tone } from "../ui/broadcast";
import { STATUS_TEXT, useMyDrives, useMyPractice, windowState, windowText, type MyDrive } from "./queries";

/** Default credits per practice run when the server doesn't say (R1.8 makes it a per-college setting). */
const DEFAULT_PRACTICE_COST = 0.25;
const costText = (c: number) => (c === 0 ? "is free" : c === 0.25 ? "uses ¼ credit" : `uses ${c} credit${c === 1 ? "" : "s"}`);

const STATUS_TONE: Record<MyDrive["status"], Tone> = { assigned: "muted", in_progress: "blue", completed: "gold", absent: "muted" };

export default function StudentHome() {
  const drives = useMyDrives();
  const practice = useMyPractice();
  const orgName = practice.data?.[0]?.org_name ?? drives.data?.[0]?.org_name;
  return (
    <V1Shell title="My placements" subtitle={orgName}>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px] items-start">
        <section className="space-y-3 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <h2 className="hr-display text-[22px]">Drives</h2>
            <Button variant="outline" size="sm" asChild><a href="/proctor/check">Check my system</a></Button>
          </div>
          {drives.isLoading ? <Loading /> : drives.error ? (
            <Empty title="Couldn't load your drives" body={(drives.error as Error).message} />
          ) : !drives.data?.length ? (
            <Empty stage title="No drives yet" body="When your placement office assigns you a drive, it shows up here with its dates." />
          ) : (
            <ul className="bg-[var(--hr-surface)] shadow-[inset_0_0_0_1px_var(--hr-rule)]">
              {drives.data.map((d) => {
                const w = windowState(d);
                const action =
                  w === "open" && d.status === "assigned" ? { label: "Start", variant: "default" as const }
                  : w === "open" && d.status === "in_progress" ? { label: "Continue", variant: "default" as const }
                  : d.status === "completed" ? { label: d.results_visible ? "View results" : "Completed", variant: "outline" as const }
                  : { label: "Details", variant: "outline" as const };
                return (
                  <li key={d.drive_id} className="flex flex-col sm:flex-row sm:items-center gap-2.5 sm:gap-4 px-4 py-3.5 hr-rule-b [&:last-child]:shadow-none">
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link to={`/learn/v1/drives/${d.drive_id}`} className="hr-display text-[16px] hover:text-[var(--hr-orange)]">{d.name}</Link>
                        <Chip tone={STATUS_TONE[d.status]}>{STATUS_TEXT[d.status]}</Chip>
                      </div>
                      <p className="hr-data text-xs text-[var(--hr-muted)]">
                        {windowText(d)}{w === "upcoming" ? " · not open yet" : w === "closed" ? " · closed" : ""}
                      </p>
                    </div>
                    <Button size="sm" variant={action.variant} asChild className="shrink-0"><Link to={`/learn/v1/drives/${d.drive_id}`}>{action.label}</Link></Button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="space-y-3 min-w-0">
          <h2 className="hr-display text-[22px]">Practice</h2>
          {practice.isLoading ? <Loading /> : !practice.data?.length ? (
            <Empty title="Practice isn't available" body="Your account isn't linked to an active college yet." />
          ) : practice.data.map((p) => (
            <div key={p.org_id} className="space-y-4">
              <p className="text-sm text-[var(--hr-muted)]">
                <span className="hr-data text-foreground">{Number(p.credits_balance)}</span> practice credits left for your college, shared by all students. You get one practice run per test; it {costText(Number(p.practice_cost ?? DEFAULT_PRACTICE_COST))} and your score shows right after.
              </p>
              {p.assessments.length === 0 ? (
                <p className="text-sm text-[var(--hr-muted)]">Your college hasn't published practice tests yet.</p>
              ) : (
                <ul className="bg-[var(--hr-surface)] shadow-[inset_0_0_0_1px_var(--hr-rule)]">
                  {p.assessments.map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-3 px-4 py-3.5 hr-rule-b [&:last-child]:shadow-none">
                      <div className="min-w-0">
                        <p className="hr-display text-[15px] truncate">{a.title}</p>
                        <p className="hr-data text-xs text-[var(--hr-muted)]">{a.duration_min} min</p>
                      </div>
                      {/* One practice run per test (migration 0020): resume an open one; a finished one can't restart. */}
                      {a.state === "done" ? <Chip tone="gold" className="shrink-0">Practice done</Chip>
                        : a.state === "in_progress"
                          ? <Button size="sm" asChild className="shrink-0"><a href={`/assess/start?context=practice&id=${a.id}`}>Continue practice</a></Button>
                        : Number(p.credits_balance) >= Number(p.practice_cost ?? DEFAULT_PRACTICE_COST)
                          ? <Button size="sm" variant="outline" asChild className="shrink-0"><a href={`/assess/start?context=practice&id=${a.id}`}>Start practice</a></Button>
                        : <Button size="sm" variant="outline" disabled className="shrink-0">No credits left</Button>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </section>
      </div>
    </V1Shell>
  );
}
