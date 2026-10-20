import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Loading, Empty, Stat } from "../layout/V1Shell";
import { collegeApi, ApiError } from "../lib/api";
import { CollegeShell } from "./CollegeShell";
import { describeEligibility } from "./lib/filters";
import { BAND_LABEL, STATUS_LABEL } from "../../../supabase/functions/_shared/college-table";
import { DRIVE_STATUS, RELEASE_TEXT } from "./DrivesPage";
import { fmtDateTime, friendly, useDrive, type DriveRecord } from "./queries";

const PAGE = 50;

export default function DriveDetailPage() {
  const { driveId = "" } = useParams();
  return <CollegeShell>{({ orgId, isAdmin }) => <DriveDetail orgId={orgId} driveId={driveId} isAdmin={isAdmin} />}</CollegeShell>;
}

function DriveDetail({ orgId, driveId, isAdmin }: { orgId: string; driveId: string; isAdmin: boolean }) {
  const drive = useDrive(driveId);
  if (drive.isLoading) return <Loading />;
  if (!drive.data) return <Empty title="Drive not found" body={drive.error ? friendly(drive.error) : undefined} />;
  return <DriveView orgId={orgId} drive={drive.data} isAdmin={isAdmin} />;
}

export function DriveView({ orgId, drive, isAdmin }: { orgId: string; drive: DriveRecord; isAdmin: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [page, setPage] = useState(1);
  const [confirmRelease, setConfirmRelease] = useState(false);
  const [busy, setBusy] = useState(false);
  const results = useQuery({
    queryKey: ["b2b-college", "drive-results", drive.id, page],
    queryFn: () => collegeApi("analytics", { orgId, filters: { driveId: drive.id }, page, pageSize: PAGE, sort: { by: "roll_no", dir: "asc" } }),
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: ["b2b-college"] });

  const assign = async () => {
    setBusy(true);
    try {
      const r = await collegeApi("assignDrive", { driveId: drive.id });
      toast({ title: `${r.assigned} students assigned`, description: `${r.alreadyAssigned} were already assigned · ${r.ineligible} not eligible` });
      refresh();
    } catch (e) {
      toast({ title: "Couldn't assign", description: e instanceof ApiError ? e.message : friendly(e), variant: "destructive" });
    } finally { setBusy(false); }
  };

  const release = async () => {
    setBusy(true);
    try {
      await collegeApi("releaseResults", { driveId: drive.id });
      toast({ title: "Results released", description: "Students can now see their scores for this drive." });
      refresh();
    } catch (e) {
      toast({ title: "Couldn't release results", description: e instanceof ApiError ? e.message : friendly(e), variant: "destructive" });
    } finally { setBusy(false); setConfirmRelease(false); }
  };

  const counts = results.data?.summary.byStatus;
  const total = results.data?.total ?? 0;
  const canRelease = isAdmin && drive.results_release === "manual" && !drive.results_released_at;
  const parts = [drive.assessment_id && "Coding / MCQ test", drive.interview_module_id && "AI interview", drive.resume_task && "Resume task"].filter(Boolean);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">{drive.name}</h2>
            <Badge variant="outline">{DRIVE_STATUS[drive.status] ?? drive.status}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">{parts.join(" + ") || "Nothing to do yet"} · {describeEligibility(drive.eligibility)}</p>
          <p className="text-sm text-muted-foreground">{fmtDateTime(drive.window_start)} – {fmtDateTime(drive.window_end)} · Results: {drive.results_released_at ? `released ${fmtDateTime(drive.results_released_at)}` : RELEASE_TEXT[drive.results_release]}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" asChild><Link to={`/c/${orgId}/drives/${drive.id}/edit`}>Edit</Link></Button>
          <Button variant="outline" asChild><Link to={`/c/${orgId}/analytics?drive=${drive.id}`}>Analytics</Link></Button>
          <Button onClick={() => void assign()} disabled={busy || drive.status === "closed"}>Assign eligible students</Button>
          {canRelease && <Button variant="secondary" onClick={() => setConfirmRelease(true)} disabled={busy}>Release results</Button>}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Not started" value={counts?.assigned ?? "—"} />
        <Stat label="In progress" value={counts?.in_progress ?? "—"} />
        <Stat label="Completed" value={counts?.completed ?? "—"} />
        <Stat label="Absent" value={counts?.absent ?? "—"} hint="Didn't start before the window closed" />
      </div>

      {results.isLoading ? <Loading /> : results.error ? <Empty title="Couldn't load students" body={friendly(results.error)} /> :
        total === 0 ? <Empty title="No students assigned yet" body="Use “Assign eligible students” to add everyone who matches the rules." /> : (
          <>
            <Table>
              <TableHeader><TableRow>
                <TableHead>Roll no</TableHead><TableHead>Name</TableHead><TableHead>Branch</TableHead><TableHead>Status</TableHead>
                <TableHead className="text-right">Overall %</TableHead><TableHead>Integrity</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {results.data!.rows.map((r) => (
                  <TableRow key={r.student_id}>
                    <TableCell className="font-mono text-xs">{r.roll_no}</TableCell><TableCell>{r.full_name}</TableCell>
                    <TableCell>{r.department ?? "—"}</TableCell><TableCell>{STATUS_LABEL[r.status] ?? r.status}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.overall ?? "—"}</TableCell>
                    <TableCell>{r.integrity_band ? `${BAND_LABEL[r.integrity_band]} (${r.integrity_score})` : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="flex justify-end items-center gap-2 text-sm">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
              <span>Page {page} of {Math.max(1, Math.ceil(total / PAGE))}</span>
              <Button size="sm" variant="outline" disabled={page * PAGE >= total} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          </>
        )}

      <AlertDialog open={confirmRelease} onOpenChange={setConfirmRelease}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Release results for {drive.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              All {total} assigned students will see their scores on their dashboard, including students who finish later.
              This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void release()}>Release results</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
