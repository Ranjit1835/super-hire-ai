import { Link } from "react-router-dom";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loading, Empty } from "../layout/V1Shell";
import { Chip, type Tone } from "../ui/broadcast";
import { CollegeShell } from "./CollegeShell";
import { describeEligibility } from "./lib/filters";
import { fmtDateTime, friendly, useDrives } from "./queries";

export const DRIVE_STATUS: Record<string, string> = { draft: "Draft", scheduled: "Scheduled", live: "Live", closed: "Closed" };

/** What a drive is right now. Nothing flips "scheduled" to "live" (students can start any scheduled drive inside
 *  its window), so an assigned drive's label follows the window: Scheduled → Open → Closed. */
export function driveStatusLabel(d: { status: string; window_start: string | null; window_end: string | null }, now = Date.now()): string {
  if (d.status === "scheduled" || d.status === "live") {
    if (d.window_end && Date.parse(d.window_end) <= now) return "Closed";
    if (!d.window_start || Date.parse(d.window_start) <= now) return "Open";
  }
  return DRIVE_STATUS[d.status] ?? d.status;
}
export const RELEASE_TEXT: Record<string, string> = {
  immediate: "Shown to students straight away", manual: "Shown when you release them", never: "Never shown to students",
};

export default function DrivesPage() {
  return <CollegeShell>{({ orgId }) => <Drives orgId={orgId} />}</CollegeShell>;
}

const STATUS_TONE: Record<string, Tone> = { Open: "blue", Scheduled: "plain", Closed: "muted", Draft: "muted" };

function Drives({ orgId }: { orgId: string }) {
  const drives = useDrives(orgId);
  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="hr-display text-[22px]">Drives</h2>
        <Button asChild><Link to={`/c/${orgId}/drives/new`}><Plus className="h-4 w-4 mr-1" />New drive</Link></Button>
      </div>
      {drives.isLoading ? <Loading /> : drives.error ? <Empty title="Couldn't load drives" body={friendly(drives.error)} /> :
        !drives.data?.length ? (
          <Empty stage={[{ label: "Import", state: "current" }, { label: "Build", state: "todo" }, { label: "Create drive", state: "todo" }]}
                 title="No drives yet" body="A drive is a coding/MCQ test, an AI interview, a resume task, or any mix, for the students you pick.">
            <Button asChild><Link to={`/c/${orgId}/drives/new`}>Create a drive</Link></Button>
          </Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="hr-label">Drive</TableHead><TableHead className="hr-label">Who</TableHead>
                <TableHead className="hr-label">Window</TableHead><TableHead className="hr-label">Results</TableHead>
                <TableHead className="hr-label">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {drives.data.map((d) => {
                const label = driveStatusLabel(d);
                return (
                  <TableRow key={d.id} className="hr-rule-b">
                    <TableCell><Link className="hr-display text-[15px] hover:text-[var(--hr-orange)]" to={`/c/${orgId}/drives/${d.id}`}>{d.name}</Link></TableCell>
                    <TableCell className="text-sm text-[var(--hr-muted)]">{describeEligibility(d.eligibility)}</TableCell>
                    <TableCell className="hr-data text-xs whitespace-nowrap">{fmtDateTime(d.window_start)} – {fmtDateTime(d.window_end)}</TableCell>
                    <TableCell className="text-sm text-[var(--hr-muted)]">{d.results_released_at ? "Released" : RELEASE_TEXT[d.results_release]}</TableCell>
                    <TableCell><Chip tone={STATUS_TONE[label] ?? "plain"} solid={label === "Open"}>{label}</Chip></TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
    </div>
  );
}
