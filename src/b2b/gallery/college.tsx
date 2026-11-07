// Gallery scenes for the college portal (owner: the college area). Fixture data only.
import type { QueryClient } from "@tanstack/react-query";
import DriveDetailPage from "../college/DriveDetailPage";
import StudentsPage from "../college/StudentsPage";
import ImportPage, { ImportWizard } from "../college/ImportPage";
import { CollegeShell } from "../college/CollegeShell";
import DrivesPage from "../college/DrivesPage";
import DriveFormPage from "../college/DriveFormPage";
import AnalyticsPage from "../college/AnalyticsPage";
import SettingsPage from "../college/SettingsPage";
import type { DriveRecord, OrgSummary, StaffRow, StudentRecord } from "../college/queries";
import type { CreditLedgerRow, InviteRow } from "../types";
import { DEMO, Scene, STUDENTS } from "./kit";

/** Seeds what CollegeShell reads: staff access (signed-out gallery: user id undefined) and the org. */
export function seedCollegeShell(qc: QueryClient, isAdmin = true) {
  qc.setQueryData(["b2b-college", "access", DEMO.org, undefined], { role: isAdmin ? "org_admin" : "trainer", isSuper: false, staff: true, isAdmin });
  qc.setQueryData<OrgSummary>(["b2b-college", "org", DEMO.org], {
    id: DEMO.org, name: DEMO.collegeName, type: "college", credits_balance: 1200, seat_limit: 300, status: "active",
  });
}

export const demoDrive: DriveRecord = {
  id: DEMO.drive, org_id: DEMO.org, name: "CSE 2027 placement drive", description: null,
  assessment_id: DEMO.assessment, interview_module_id: DEMO.module, resume_task: false,
  eligibility: { departments: ["CSE"], batch_years: [2027], min_cgpa: 7, max_backlogs: 0 } as DriveRecord["eligibility"],
  window_start: DEMO.opens, window_end: DEMO.closes, proctoring_policy: "strict", results_release: "manual",
  results_released_at: null, status: "scheduled", created_at: DEMO.created,
};

const scores: Record<string, { status: string; coding: number | null; mcq: number | null; interview: number | null; overall: number | null; band: "high" | "medium" | "low" | null; integrity: number | null }> = {
  "21CSE001": { status: "completed", coding: 84, mcq: 80, interview: 82, overall: 79, band: "high", integrity: 96 },
  "21CSE002": { status: "completed", coding: 70, mcq: 78, interview: 72, overall: 71, band: "low", integrity: 58 },
  "21CSE003": { status: "in_progress", coding: 68, mcq: null, interview: null, overall: null, band: null, integrity: null },
  "21CSE004": { status: "assigned", coding: null, mcq: null, interview: null, overall: null, band: null, integrity: null },
  "21CSE005": { status: "assigned", coding: null, mcq: null, interview: null, overall: null, band: null, integrity: null },
};

export const driveResults = {
  total: 5,
  rows: STUDENTS.map((s) => {
    const x = scores[s.roll];
    return {
      student_id: s.id, drive_id: DEMO.drive, drive_name: demoDrive.name, full_name: s.name, roll_no: s.roll, email: s.email,
      department: "CSE", batch_year: 2027, section: "A", cgpa: s.cgpa, active_backlogs: 0, status: x.status,
      coding: x.coding, mcq: x.mcq, interview: x.interview, overall: x.overall, integrity_band: x.band, integrity_score: x.integrity,
    };
  }),
  summary: {
    funnel: { invited: 5, activated: 5, started: 3, completed: 2 },
    byStatus: { assigned: 2, in_progress: 1, completed: 2, absent: 0 },
    byDepartment: [{ department: "CSE", students: 5, avg: 75 }],
    dimensions: [],
  },
};

function Drive() {
  return (
    <Scene path={`/c/${DEMO.org}/drives/${DEMO.drive}`} route="/c/:orgId/drives/:driveId" element={<DriveDetailPage />}
      seed={(qc) => {
        seedCollegeShell(qc);
        qc.setQueryData(["b2b-college", "drive", DEMO.drive], demoDrive);
        qc.setQueryData(["b2b-college", "drive-results", DEMO.drive, 1], driveResults);
      }} />
  );
}

function DriveEmpty() {
  return (
    <Scene path={`/c/${DEMO.org}/drives/${DEMO.drive}`} route="/c/:orgId/drives/:driveId" element={<DriveDetailPage />}
      seed={(qc) => {
        seedCollegeShell(qc);
        qc.setQueryData(["b2b-college", "drive", DEMO.drive], demoDrive);
        qc.setQueryData(["b2b-college", "drive-results", DEMO.drive, 1], { ...driveResults, total: 0, rows: [], summary: { ...driveResults.summary, byStatus: { assigned: 0, in_progress: 0, completed: 0, absent: 0 } } });
      }} />
  );
}

/** Five demo students in varied states, for the roster and its scorebug. */
const demoStudents: StudentRecord[] = STUDENTS.map((s, i) => ({
  id: s.id, org_id: DEMO.org, roll_no: s.roll, full_name: s.name, email: s.email, phone: null,
  department: "CSE", batch_year: 2027, section: "A", cgpa: s.cgpa, active_backlogs: i === 2 ? 1 : 0,
  tenth_pct: 88, twelfth_pct: 84, dob: "2006-04-12",
  status: (["active", "invited", "imported", "held_minor", "deactivated"] as const)[i],
  user_id: i === 0 ? "u-demo-1" : null, created_at: DEMO.created,
}));
const demoStudentCounts = { imported: 1, invited: 1, active: 1, deactivated: 1, held_minor: 1 };

function seedStudents(qc: QueryClient, rows: StudentRecord[]) {
  seedCollegeShell(qc);
  const q = { search: "", department: "", batchYear: "", status: "", page: 1 };
  qc.setQueryData(["b2b-college", "students", DEMO.org, q], { rows, total: rows.length });
  qc.setQueryData(["b2b-college", "facets", DEMO.org], { departments: ["CSE", "ECE"], batchYears: [2026, 2027], sections: ["A", "B"] });
  qc.setQueryData(["b2b-college", "student-status-counts", DEMO.org],
    rows.length ? demoStudentCounts : { imported: 0, invited: 0, active: 0, deactivated: 0, held_minor: 0 });
  // Drives done / assigned and last activity per student (migration 0019).
  qc.setQueryData(["b2b-college", "student-activity", DEMO.org], Object.fromEntries(rows.map((r, i) =>
    [r.id, { assigned: i < 3 ? 2 : 0, completed: i === 0 ? 2 : i === 1 ? 1 : 0, last_active_at: i < 2 ? "2026-10-24T09:30:00Z" : null }])));
}

function Students() {
  return (
    <Scene path={`/c/${DEMO.org}/students`} route="/c/:orgId/students" element={<StudentsPage />}
      seed={(qc) => seedStudents(qc, demoStudents)} />
  );
}

function StudentsEmpty() {
  return (
    <Scene path={`/c/${DEMO.org}/students`} route="/c/:orgId/students" element={<StudentsPage />}
      seed={(qc) => seedStudents(qc, [])} />
  );
}

function Import() {
  return (
    <Scene path={`/c/${DEMO.org}/students/import`} route="/c/:orgId/students/import" element={<ImportPage />}
      seed={(qc) => seedCollegeShell(qc)} />
  );
}

/** A mid-wizard capture: columns mapped, rows checked, one duplicate and one error waiting on a decision. */
function ImportMidWizard() {
  const header = ["Hall Ticket No", "Student Name", "Email ID", "Branch", "Year of Passing", "CGPA"];
  const table = [header,
    ["21CSE006", "Farah Khan", "s6@demo.test", "CSE", "2027", "8.0"],
    ["21CSE002", "Bala Kumar", "s2@demo.test", "CSE", "2027", "7.9"],
    ["21CSE007", "Girish Rao", "not-an-email", "CSE", "2027", "6.5"]];
  const built = {
    rows: [
      { row: 2, roll_no: "21CSE006", full_name: "Farah Khan", email: "s6@demo.test", department: "CSE", batch_year: 2027, cgpa: 8 },
      { row: 3, roll_no: "21CSE002", full_name: "Bala Kumar", email: "s2@demo.test", department: "CSE", batch_year: 2027, cgpa: 7.9 },
    ],
    errors: [{ row: 4, message: "Email: invalid email" }],
  };
  const preview = {
    created: 1, merged: 0, skipped: 1, heldMinors: 0,
    duplicates: [{ row: 3, reason: "both" as const, existingStudentId: STUDENTS[1].id }],
    errors: [], // the invalid-email row never reaches the server; it's caught client-side in `built.errors`
  };
  return (
    <Scene path={`/c/${DEMO.org}/students/import`} route="/c/:orgId/students/import"
      element={<CollegeShell>{({ orgId }) => (
        <ImportWizard orgId={orgId} initial={{ step: "preview", fileName: "students.csv", table, built, preview }} />
      )}</CollegeShell>}
      seed={(qc) => seedCollegeShell(qc)} />
  );
}

const demoDrives: DriveRecord[] = [
  demoDrive,
  { ...demoDrive, id: "dddddddd-dddd-4ddd-8ddd-dddddddddd02", name: "ECE 2026 internship drive", status: "closed",
    window_start: "2026-09-01T09:00:00Z", window_end: "2026-09-15T18:00:00Z", results_released_at: "2026-09-16T10:00:00Z",
    eligibility: { departments: ["ECE"], batch_years: [2026] } as DriveRecord["eligibility"] },
  { ...demoDrive, id: "dddddddd-dddd-4ddd-8ddd-dddddddddd03", name: "CSE 2028 pre-placement talk", status: "draft",
    window_start: null, window_end: null, results_release: "never", eligibility: {} as DriveRecord["eligibility"] },
];

function Drives() {
  return (
    <Scene path={`/c/${DEMO.org}/drives`} route="/c/:orgId/drives" element={<DrivesPage />}
      seed={(qc) => { seedCollegeShell(qc); qc.setQueryData(["b2b-college", "drives", DEMO.org], demoDrives); }} />
  );
}

function DrivesEmpty() {
  return (
    <Scene path={`/c/${DEMO.org}/drives`} route="/c/:orgId/drives" element={<DrivesPage />}
      seed={(qc) => { seedCollegeShell(qc); qc.setQueryData(["b2b-college", "drives", DEMO.org], []); }} />
  );
}

function DriveForm() {
  return (
    <Scene path={`/c/${DEMO.org}/drives/new`} route="/c/:orgId/drives/new" element={<DriveFormPage />}
      seed={(qc) => {
        seedCollegeShell(qc);
        qc.setQueryData(["b2b-college", "assessments", DEMO.org], [{ id: DEMO.assessment, title: "CSE coding + MCQ", status: "ready" }]);
        qc.setQueryData(["b2b-college", "modules", DEMO.org], [{ id: DEMO.module, name: "DSA interview", org_id: null }]);
        qc.setQueryData(["b2b-college", "facets", DEMO.org], { departments: ["CSE", "ECE"], batchYears: [2026, 2027], sections: ["A", "B"] });
      }} />
  );
}

function Analytics() {
  const summary = {
    funnel: { invited: 180, activated: 164, started: 140, completed: 96 },
    byStatus: { assigned: 44, in_progress: 44, completed: 96, absent: 16 },
    byDepartment: [{ department: "CSE", students: 120, avg: 78 }, { department: "ECE", students: 80, avg: 68 }],
    dimensions: [
      { dimension: "coding", avg: 74 }, { dimension: "problem_solving", avg: 69 }, { dimension: "technical_knowledge", avg: 71 },
      { dimension: "communication", avg: 66 }, { dimension: "clarity_confidence", avg: 63 }, { dimension: "resume_quality", avg: 80 },
    ],
  };
  const rows = STUDENTS.slice(0, 3).map((s, i) => ({
    student_id: s.id, drive_id: DEMO.drive, drive_name: demoDrive.name, full_name: s.name, roll_no: s.roll, email: s.email,
    department: "CSE", batch_year: 2027, section: "A", cgpa: s.cgpa, active_backlogs: 0, status: "completed",
    coding: 84 - i * 6, mcq: 80 - i * 4, interview: 82 - i * 5, overall: 79 - i * 5,
    integrity_band: i === 1 ? "low" : "high", integrity_score: i === 1 ? 58 : 94,
  }));
  return (
    <Scene path={`/c/${DEMO.org}/analytics`} route="/c/:orgId/analytics" element={<AnalyticsPage />}
      seed={(qc) => {
        seedCollegeShell(qc);
        qc.setQueryData(["b2b-college", "drives", DEMO.org], demoDrives);
        qc.setQueryData(["b2b-college", "facets", DEMO.org], { departments: ["CSE", "ECE"], batchYears: [2026, 2027], sections: ["A", "B"] });
        qc.setQueryData(["b2b-college", "analytics", DEMO.org, {}, 1, { by: "roll_no", dir: "asc" }], { total: 96, rows, summary });
      }} />
  );
}

const demoLedger: CreditLedgerRow[] = [
  { id: 1, org_id: DEMO.org, delta: 1000, balance_after: 1000, reason: "grant", feature: null, note: "Starter plan", created_at: "2026-08-01T05:00:00Z" },
  { id: 2, org_id: DEMO.org, delta: -4, balance_after: 996, reason: "consume", feature: "practice_interview", note: null, created_at: "2026-09-10T11:00:00Z" },
  { id: 3, org_id: DEMO.org, delta: 200, balance_after: 1196, reason: "top_up", feature: null, note: null, created_at: "2026-10-01T06:00:00Z" },
  { id: 4, org_id: DEMO.org, delta: -4, balance_after: 1192, reason: "consume", feature: "practice_coding", note: null, created_at: "2026-10-05T09:00:00Z" },
];
const demoStaff: { members: StaffRow[]; invites: InviteRow[] } = {
  members: [
    { id: "staff-1", user_id: "u-demo-1", role: "org_admin", full_name: "Priya Sharma", email: "priya@walkthrough.edu", created_at: "2026-08-01T05:00:00Z" },
    { id: "staff-2", user_id: "u-demo-2", role: "trainer", full_name: "Arjun Verma", email: "arjun@walkthrough.edu", created_at: "2026-08-10T05:00:00Z" },
  ],
  invites: [
    { id: "inv-1", org_id: DEMO.org, email: "new.trainer@walkthrough.edu", full_name: "New Trainer", role: "trainer", status: "pending",
      expires_at: "2026-11-01T00:00:00Z", email_sent_at: null, email_error: null, created_at: "2026-10-20T05:00:00Z" },
  ],
};

function Settings() {
  return (
    <Scene path={`/c/${DEMO.org}/settings`} route="/c/:orgId/settings" element={<SettingsPage />}
      seed={(qc) => {
        seedCollegeShell(qc);
        qc.setQueryData(["b2b-college", "ledger", DEMO.org], demoLedger);
        qc.setQueryData(["b2b-college", "staff", DEMO.org], demoStaff);
      }} />
  );
}

export const scenes = {
  drive: Drive, "drive-empty": DriveEmpty,
  students: Students, "students-empty": StudentsEmpty,
  import: Import, "import-mid": ImportMidWizard,
  drives: Drives, "drives-empty": DrivesEmpty,
  "drive-form": DriveForm,
  analytics: Analytics,
  settings: Settings,
};
