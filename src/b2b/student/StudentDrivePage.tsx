// A student's own drive (/learn/v1/drives/:driveId): the steps in order, each with its own state and one next
// action, the window and proctoring note, and results only once the college releases them.
import type { ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { V1Shell, Loading, Empty } from "../layout/V1Shell";
import { Chip, Numeral, StatStrip, type Series, type Tone } from "../ui/broadcast";
import { STATUS_TEXT, useMyDrives, windowState, windowText, type MyDrive } from "./queries";

const STATUS_TONE: Record<MyDrive["status"], Tone> = { assigned: "muted", in_progress: "blue", completed: "gold", absent: "muted" };
const SERIES_TONE: Record<Series, Tone> = { test: "orange", interview: "blue", overall: "gold" };

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

type StepState = "done" | "active" | "waiting";

function Step({ n, state, title, children }: { n: number; state: StepState; title: string; children?: ReactNode }) {
  return (
    <li className="flex gap-4 px-4 py-4 hr-rule-b [&:last-child]:shadow-none">
      <div className={cn("hr-display text-[15px] h-9 w-9 shrink-0 flex items-center justify-center",
        state === "done" ? "bg-[var(--hr-gold)] text-[#07090F]"
          : state === "active" ? "text-[var(--hr-orange)] shadow-[inset_0_0_0_2px_var(--hr-orange)]"
          : "text-[var(--hr-muted)] shadow-[inset_0_0_0_1px_var(--hr-rule)]")}>
        {state === "done" ? <Check className="h-4 w-4" aria-label="Done" /> : n}
      </div>
      <div className="min-w-0 flex-1 space-y-1.5 pt-1.5">
        <p className="hr-display text-[15px]">{title}</p>
        {children}
      </div>
    </li>
  );
}

export function DriveSteps({ d }: { d: MyDrive }) {
  const w = windowState(d);
  const testDone = d.attempt_status !== null && !["not_started", "in_progress"].includes(d.attempt_status);
  const canStart = w === "open" && d.status !== "completed" && d.status !== "absent";
  // No separate interview attempt is exposed to the student; "completed" is the only reliable signal that both
  // the test and the interview (whichever the drive includes) are finished.
  const interviewDone = d.status === "completed";
  const needsTest = d.has_assessment && !testDone;
  const isPrimaryTest = needsTest && canStart;
  const isPrimaryInterview = !needsTest && d.has_interview && !interviewDone && canStart;
  let n = 1;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] items-start">
      <div className="space-y-6 min-w-0">
        <div className="hr-scorebug px-5 py-4">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 className="hr-display text-[22px]">{d.name}</h2>
              <Chip tone={STATUS_TONE[d.status]}>{STATUS_TEXT[d.status]}</Chip>
            </div>
            {d.description && <p className="text-sm text-foreground">{d.description}</p>}
          </div>
        </div>

        {w === "upcoming" && <p role="status" className="text-sm text-[var(--hr-muted)] shadow-[inset_0_0_0_1px_var(--hr-rule)] rounded-[2px] p-3">This drive hasn't opened yet. Come back when the window starts.</p>}
        {w === "closed" && d.status !== "completed" && <p role="status" className="text-sm text-[var(--hr-muted)] shadow-[inset_0_0_0_1px_var(--hr-rule)] rounded-[2px] p-3">The window for this drive has closed.</p>}

        <ol className="bg-[var(--hr-surface)] shadow-[inset_0_0_0_1px_var(--hr-rule)]">
          <Step n={n++} state="waiting" title="Check your system">
            <Button size="sm" variant="outline" asChild><a href="/proctor/check">Run the system check</a></Button>
          </Step>

          {d.has_assessment && (
            <Step n={n++} state={testDone ? "done" : canStart ? "active" : "waiting"} title="Coding and MCQ test">
              {testDone ? <p className="text-sm text-[var(--hr-muted)]">Submitted.</p> : canStart ? (
                <Button size="sm" variant={isPrimaryTest ? "default" : "outline"} asChild>
                  <a href={`/assess/start?context=drive&id=${d.drive_id}`}>{d.attempt_status === "in_progress" ? "Continue the test" : "Start the test"}</a>
                </Button>
              ) : <p className="text-sm text-[var(--hr-muted)]">Available while the drive is open.</p>}
            </Step>
          )}

          {d.has_interview && (
            <Step n={n++} state={interviewDone ? "done" : canStart ? "active" : "waiting"} title="AI interview">
              {interviewDone ? <p className="text-sm text-[var(--hr-muted)]">Completed.</p> : canStart ? (
                <Button size="sm" variant={isPrimaryInterview ? "default" : "outline"} asChild>
                  <Link to={`/learn/v1/drives/${d.drive_id}/interview`}>Go to the interview</Link>
                </Button>
              ) : <p className="text-sm text-[var(--hr-muted)]">Available while the drive is open.</p>}
            </Step>
          )}

          <Step n={n} state={d.status === "completed" ? "done" : "waiting"} title="Done">
            <p className="text-sm text-[var(--hr-muted)]">{d.status === "completed" ? "You've finished this drive." : "Finish every step above."}</p>
          </Step>
        </ol>
      </div>

      <div className="space-y-6 lg:sticky lg:top-20 min-w-0">
        <section className="space-y-3">
          <h2 className="hr-display text-[18px]">Your results</h2>
          {d.results_visible && d.results ? (
            <div className="grid grid-cols-2 gap-3">
              {d.results.coding != null && <ResultTile label="Coding" value={d.results.coding} series="test" />}
              {d.results.mcq != null && <ResultTile label="MCQ" value={d.results.mcq} series="test" />}
              {d.results.interview != null && <ResultTile label="Interview" value={d.results.interview} series="interview" />}
              <ResultTile label="Overall" value={d.results.overall} series="overall" />
            </div>
          ) : (
            <p className="text-sm text-[var(--hr-muted)]">
              {d.results_release === "never" ? "Results of this drive are shared with your placement office only."
                : d.results_visible ? "Your results will show here once your work has been scored."
                : "Results aren't released yet. Your placement office will release them here when they are."}
            </p>
          )}
        </section>

        <div className="bg-[var(--hr-surface)] shadow-[inset_0_0_0_1px_var(--hr-rule)] px-4 py-3.5 space-y-2">
          <h3 className="hr-label">Drive facts</h3>
          <p className="text-sm text-[var(--hr-muted)]">
            <span className="hr-data text-foreground">{windowText(d)}</span>
            {w === "upcoming" ? " · not open yet" : w === "closed" ? " · closed" : ""}
          </p>
          <p className="text-sm text-[var(--hr-muted)]">Camera, microphone, screen sharing and internet speed. Do this before the drive.</p>
          {d.proctoring_policy !== "off" && (
            <p className="text-sm text-[var(--hr-muted)]">This drive uses AI proctoring (camera, screen and browser checks). Anything flagged is reviewed by your placement office.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function ResultTile({ label, value, series }: { label: string; value: number | null; series: Series }) {
  return (
    <div className="bg-[var(--hr-surface)] px-4 py-3 shadow-[inset_0_0_0_1px_var(--hr-rule)] space-y-1.5">
      <p className="hr-label">{label}</p>
      <p className="text-[28px] leading-none"><Numeral value={value} tone={SERIES_TONE[series]} /></p>
      {value != null && <StatStrip value={value} series={series} />}
    </div>
  );
}
