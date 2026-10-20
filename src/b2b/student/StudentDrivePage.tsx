import type { ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { CheckCircle2, Circle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { V1Shell, Loading, Empty, Stat } from "../layout/V1Shell";
import { STATUS_TEXT, useMyDrives, windowState, windowText, type MyDrive } from "./queries";

export default function StudentDrivePage() {
  const { driveId } = useParams();
  const drives = useMyDrives();
  const d = drives.data?.find((x) => x.drive_id === driveId);
  return (
    <V1Shell title={d?.name ?? "Drive"} subtitle={d?.org_name} tabs={[{ to: "/learn/v1", label: "My placements", end: true }]}>
      {drives.isLoading ? <Loading /> : !d ? (
        <Empty title="Drive not found" body="It may not be assigned to you, or it was removed.">
          <Button asChild><Link to="/learn/v1">Back</Link></Button>
        </Empty>
      ) : <DriveSteps d={d} />}
    </V1Shell>
  );
}

function Step({ done, title, children }: { done: boolean; title: string; children?: ReactNode }) {
  return (
    <li className="flex gap-3">
      {done
        ? <CheckCircle2 className="h-5 w-5 text-primary shrink-0" aria-label="Done" />
        : <Circle className="h-5 w-5 text-muted-foreground shrink-0" aria-label="To do" />}
      <div className="space-y-1"><p className="font-medium">{title}</p>{children}</div>
    </li>
  );
}

export function DriveSteps({ d }: { d: MyDrive }) {
  const w = windowState(d);
  const testDone = d.attempt_status !== null && !["not_started", "in_progress"].includes(d.attempt_status);
  const canStart = w === "open" && d.status !== "completed" && d.status !== "absent";
  let n = 1;
  return (
    <div className="space-y-6 max-w-2xl">
      <div className="text-sm text-muted-foreground space-y-1">
        <p>{windowText(d)} · {STATUS_TEXT[d.status]}</p>
        {d.description && <p className="text-foreground">{d.description}</p>}
        {d.proctoring_policy !== "off" && (
          <p>This drive uses AI proctoring (camera, screen and browser checks). Anything flagged is reviewed by your placement office.</p>
        )}
      </div>
      {w === "upcoming" && <p role="status" className="rounded-md border p-3 text-sm">This drive hasn't opened yet. Come back when the window starts.</p>}
      {w === "closed" && d.status !== "completed" && <p role="status" className="rounded-md border p-3 text-sm">The window for this drive has closed.</p>}
      <ol className="space-y-4">
        <Step done={false} title={`${n++}. Check your system`}>
          <p className="text-sm text-muted-foreground">Camera, microphone, screen sharing and internet speed. Do this before the drive.</p>
          <Button size="sm" variant="outline" asChild><a href="/proctor/check">Run the system check</a></Button>
        </Step>
        {d.has_assessment && (
          <Step done={testDone} title={`${n++}. Coding and MCQ test`}>
            {testDone ? <p className="text-sm text-muted-foreground">Submitted.</p> : canStart ? (
              <Button size="sm" asChild>
                <a href={`/assess/start?context=drive&id=${d.drive_id}`}>{d.attempt_status === "in_progress" ? "Continue the test" : "Start the test"}</a>
              </Button>
            ) : <p className="text-sm text-muted-foreground">Available while the drive is open.</p>}
          </Step>
        )}
        {d.has_interview && (
          <Step done={false} title={`${n++}. AI interview`}>
            {canStart
              ? <Button size="sm" variant="outline" asChild><Link to={`/learn/v1/drives/${d.drive_id}/interview`}>Go to the interview</Link></Button>
              : <p className="text-sm text-muted-foreground">Available while the drive is open.</p>}
          </Step>
        )}
        <Step done={d.status === "completed"} title="Done">
          <p className="text-sm text-muted-foreground">{d.status === "completed" ? "You've finished this drive." : "Finish every step above."}</p>
        </Step>
      </ol>
      <section className="space-y-2">
        <h2 className="font-semibold">Your results</h2>
        {d.results_visible && d.results ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {d.results.coding != null && <Stat label="Coding" value={`${d.results.coding}%`} />}
            {d.results.mcq != null && <Stat label="MCQ" value={`${d.results.mcq}%`} />}
            {d.results.interview != null && <Stat label="Interview" value={`${d.results.interview}%`} />}
            <Stat label="Overall" value={d.results.overall != null ? `${d.results.overall}%` : "—"} />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {d.results_release === "never" ? "Results of this drive are shared with your placement office only."
              : d.results_visible ? "Your results will show here once your work has been scored."
              : "Results will show here when your placement office releases them."}
          </p>
        )}
      </section>
    </div>
  );
}
