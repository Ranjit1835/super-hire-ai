// Gallery scenes for the student area (owner: the student clone). Fixture data only; see ./kit.tsx and ./college.tsx.
import type { ComponentType } from "react";
import type { QueryClient } from "@tanstack/react-query";
import StudentHome from "../student/StudentHome";
import StudentDrivePage from "../student/StudentDrivePage";
import type { MyDrive, MyPractice } from "../student/queries";
import { DEMO, Scene } from "./kit";

const DRIVE_OPEN = DEMO.drive;
const DRIVE_UPCOMING = "dddddddd-dddd-4ddd-8ddd-dddddddddd11";
const DRIVE_DONE = "dddddddd-dddd-4ddd-8ddd-dddddddddd12";

/** Mid-way: the test is submitted, the window is open, the interview is still ahead. */
const baseDrive: MyDrive = {
  drive_id: DRIVE_OPEN, org_id: DEMO.org, org_name: DEMO.collegeName, name: "CSE 2027 placement drive",
  description: "Coding/MCQ test and a short AI interview. Finish both before the window closes.",
  window_start: DEMO.opens, window_end: DEMO.closes, proctoring_policy: "strict", results_release: "manual",
  has_assessment: true, has_interview: true, resume_task: false,
  status: "in_progress", attempt_status: "submitted", results_visible: false, results: null,
};

/** Results released: every series scored and shown. */
const doneDrive: MyDrive = {
  ...baseDrive, drive_id: DRIVE_DONE, name: "CSE 2027 pre-placement drive", status: "completed",
  window_start: "2026-09-01T09:00:00Z", window_end: "2026-09-10T18:00:00Z",
  results_release: "immediate", results_visible: true,
  results: { coding: 84, mcq: 80, assessment: 82, interview: 82, overall: 79 },
};

const demoDrives: MyDrive[] = [
  baseDrive,
  { ...baseDrive, drive_id: DRIVE_UPCOMING, name: "ECE 2026 internship drive", status: "assigned", attempt_status: "not_started",
    window_start: "2026-11-10T09:00:00Z", window_end: "2026-11-20T18:00:00Z" },
  doneDrive,
];

const demoPractice: MyPractice[] = [{
  org_id: DEMO.org, org_name: DEMO.collegeName, credits_balance: 48,
  assessments: [
    { id: DEMO.assessment, title: "DSA practice set", duration_min: 45 },
    { id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeef", title: "Aptitude practice set", duration_min: 30 },
  ],
}];

function seedStudent(qc: QueryClient, drives: MyDrive[], practice: MyPractice[]) {
  qc.setQueryData(["b2b-student", "drives", undefined], drives);
  qc.setQueryData(["b2b-student", "practice", undefined], practice);
}

function Home() {
  return (
    <Scene path="/learn/v1" route="/learn/v1" element={<StudentHome />}
      seed={(qc) => seedStudent(qc, demoDrives, demoPractice)} />
  );
}

/** No drives yet, but practice is still available: only the drives section is empty (3D stage). */
function HomeEmpty() {
  return (
    <Scene path="/learn/v1" route="/learn/v1" element={<StudentHome />}
      seed={(qc) => seedStudent(qc, [], demoPractice)} />
  );
}

function Drive() {
  return (
    <Scene path={`/learn/v1/drives/${DRIVE_OPEN}`} route="/learn/v1/drives/:driveId" element={<StudentDrivePage />}
      seed={(qc) => seedStudent(qc, demoDrives, demoPractice)} />
  );
}

function DriveResults() {
  return (
    <Scene path={`/learn/v1/drives/${DRIVE_DONE}`} route="/learn/v1/drives/:driveId" element={<StudentDrivePage />}
      seed={(qc) => seedStudent(qc, demoDrives, demoPractice)} />
  );
}

export const scenes: Record<string, ComponentType> = {
  home: Home, "home-empty": HomeEmpty,
  drive: Drive, "drive-results": DriveResults,
};
