import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { V1Shell, Loading, Empty, Stat } from "../layout/V1Shell";
import { STATUS_TEXT, useMyDrives, useMyPractice, windowState, windowText } from "./queries";

/** A practice coding test costs ¼ credit from the college's shared pool (AUDIT.md 9.7). */
const PRACTICE_TEST_COST = 0.25;

export default function StudentHome() {
  const drives = useMyDrives();
  const practice = useMyPractice();
  const orgName = practice.data?.[0]?.org_name ?? drives.data?.[0]?.org_name;
  return (
    <V1Shell title="My placements" subtitle={orgName}>
      <div className="space-y-8">
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Drives</h2>
            <Button variant="outline" size="sm" asChild><a href="/proctor/check">Check my system</a></Button>
          </div>
          {drives.isLoading ? <Loading /> : drives.error ? <Empty title="Couldn't load your drives" body={(drives.error as Error).message} /> :
            !drives.data?.length ? (
              <Empty title="No drives yet" body="When your placement office assigns you a drive, it shows up here with its dates." />
            ) : (
              <ul className="grid sm:grid-cols-2 gap-3">
                {drives.data.map((d) => {
                  const w = windowState(d);
                  return (
                    <li key={d.drive_id} className="rounded-lg border p-4 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <Link to={`/learn/v1/drives/${d.drive_id}`} className="font-medium hover:underline">{d.name}</Link>
                        <Badge variant={d.status === "completed" ? "default" : "outline"}>{STATUS_TEXT[d.status]}</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {windowText(d)}{w === "upcoming" ? " · not open yet" : w === "closed" ? " · closed" : ""}
                      </p>
                      {d.results_visible && d.results?.overall != null && <p className="text-sm">Your overall score: <b>{d.results.overall}%</b></p>}
                      <Button size="sm" asChild><Link to={`/learn/v1/drives/${d.drive_id}`}>Open</Link></Button>
                    </li>
                  );
                })}
              </ul>
            )}
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Practice</h2>
          {practice.isLoading ? <Loading /> : !practice.data?.length ? (
            <Empty title="Practice isn't available" body="Your account isn't linked to an active college yet." />
          ) : practice.data.map((p) => (
            <div key={p.org_id} className="space-y-3">
              <div className="grid sm:grid-cols-3 gap-3">
                <Stat label="Practice credits left for your college" value={Number(p.credits_balance).toLocaleString("en-IN")}
                      hint="Shared by all students. A practice test uses ¼ credit; your score shows right after." />
              </div>
              {p.assessments.length === 0 ? (
                <p className="text-sm text-muted-foreground">Your college hasn't published practice tests yet.</p>
              ) : (
                <ul className="grid sm:grid-cols-2 gap-3">
                  {p.assessments.map((a) => (
                    <li key={a.id} className="rounded-lg border p-4 flex items-center justify-between gap-2">
                      <div><p className="font-medium">{a.title}</p><p className="text-xs text-muted-foreground">{a.duration_min} minutes</p></div>
                      {Number(p.credits_balance) >= PRACTICE_TEST_COST
                        ? <Button size="sm" asChild><a href={`/assess/start?context=practice&id=${a.id}`}>Start practice</a></Button>
                        : <Button size="sm" disabled>No credits left</Button>}
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
