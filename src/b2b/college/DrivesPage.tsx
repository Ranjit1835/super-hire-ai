import { Link } from "react-router-dom";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loading, Empty } from "../layout/V1Shell";
import { CollegeShell } from "./CollegeShell";
import { describeEligibility } from "./lib/filters";
import { fmtDateTime, friendly, useDrives } from "./queries";

export const DRIVE_STATUS: Record<string, string> = { draft: "Draft", scheduled: "Scheduled", live: "Live", closed: "Closed" };
export const RELEASE_TEXT: Record<string, string> = {
  immediate: "Shown to students straight away", manual: "Shown when you release them", never: "Never shown to students",
};

export default function DrivesPage() {
  return <CollegeShell>{({ orgId }) => <Drives orgId={orgId} />}</CollegeShell>;
}

function Drives({ orgId }: { orgId: string }) {
  const drives = useDrives(orgId);
  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold">Drives</h2>
        <Button asChild><Link to={`/c/${orgId}/drives/new`}><Plus className="h-4 w-4 mr-1" />New drive</Link></Button>
      </div>
      {drives.isLoading ? <Loading /> : drives.error ? <Empty title="Couldn't load drives" body={friendly(drives.error)} /> :
        !drives.data?.length ? (
          <Empty title="No drives yet" body="A drive is a coding/MCQ test, an AI interview, a resume task, or any mix, for the students you pick.">
            <Button asChild><Link to={`/c/${orgId}/drives/new`}>Create a drive</Link></Button>
          </Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow><TableHead>Drive</TableHead><TableHead>Who</TableHead><TableHead>Window</TableHead><TableHead>Results</TableHead><TableHead>Status</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {drives.data.map((d) => (
                <TableRow key={d.id}>
                  <TableCell><Link className="font-medium underline-offset-2 hover:underline" to={`/c/${orgId}/drives/${d.id}`}>{d.name}</Link></TableCell>
                  <TableCell className="text-sm">{describeEligibility(d.eligibility)}</TableCell>
                  <TableCell className="text-sm whitespace-nowrap">{fmtDateTime(d.window_start)} – {fmtDateTime(d.window_end)}</TableCell>
                  <TableCell className="text-sm">{d.results_released_at ? "Released" : RELEASE_TEXT[d.results_release]}</TableCell>
                  <TableCell><Badge variant="outline">{DRIVE_STATUS[d.status] ?? d.status}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
    </div>
  );
}
