import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const api = vi.hoisted(() => ({ collegeApi: vi.fn() }));
const db = vi.hoisted(() => {
  const single = vi.fn().mockResolvedValue({ data: { id: "d-new" }, error: null });
  const select = vi.fn(() => ({ single }));
  const insert = vi.fn((_row: Record<string, unknown>) => ({ select }));
  const eq = vi.fn(() => ({ select }));
  const update = vi.fn(() => ({ eq }));
  return { insert, update, single, from: vi.fn(() => ({ insert, update })) };
});

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" }, signOut: vi.fn() }) }));
vi.mock("@/features/b2b/lib/db", () => ({ b2bDb: { from: db.from, rpc: vi.fn() } }));
vi.mock("../lib/api", async (orig) => ({ ...(await orig<typeof import("../lib/api")>()), collegeApi: api.collegeApi }));
vi.mock("./queries", async (orig) => ({
  ...(await orig<typeof import("./queries")>()),
  useAssessments: () => ({ data: [{ id: "a1", title: "Coding + MCQ", status: "ready" }] }),
  useInterviewModules: () => ({ data: [{ id: "m1", name: "DSA interview", org_id: null }] }),
  useStudentFacets: () => ({ data: { departments: ["CSE", "ECE"], batchYears: [2026, 2027], sections: ["A"] } }),
  useDrives: () => ({ data: [{ id: "11111111-1111-4111-8111-111111111111", name: "CSE 2027 drive" }] }),
}));

import { ImportWizard } from "./ImportPage";
import { DriveForm } from "./DriveFormPage";
import { DriveView } from "./DriveDetailPage";
import { Analytics } from "./AnalyticsPage";
import type { DriveRecord } from "./queries";

const ORG = "6c8f2f3e-6c7a-4a32-9d8b-2b3f9d1c0a11";
const DRIVE = "11111111-1111-4111-8111-111111111111";

function wrap(ui: ReactNode, path = "/x") {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="*" element={ui} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function csvFile(text: string, name = "students.csv") {
  const f = new File([text], name, { type: "text/csv" });
  // jsdom's File may lack .text(); the importer only needs it.
  Object.defineProperty(f, "text", { value: () => Promise.resolve(text) });
  return f;
}

const summary = (over = {}) => ({
  funnel: { invited: 2, activated: 1, started: 1, completed: 1 },
  byStatus: { assigned: 1, in_progress: 0, completed: 1, absent: 0 },
  byDepartment: [{ department: "CSE", students: 2, avg: 80 }],
  dimensions: [{ dimension: "coding", avg: 60 }],
  ...over,
});
const row = (over = {}) => ({
  student_id: "22222222-2222-4222-8222-222222222222", drive_id: DRIVE, drive_name: "CSE 2027 drive", full_name: "Asha", roll_no: "21A01",
  email: "asha@a.in", department: "CSE", batch_year: 2027, section: null, cgpa: 8.2, active_backlogs: 0, status: "completed",
  coding: 60, mcq: 100, interview: null, overall: 80, integrity_band: "low", integrity_score: 55, ...over,
});

beforeEach(() => {
  api.collegeApi.mockReset();
  db.from.mockClear(); db.insert.mockClear(); db.update.mockClear();
});

describe("import wizard", () => {
  it("upload → mapping → preview with duplicates → merge → commit with invites", async () => {
    api.collegeApi.mockImplementation(async (action: string, input: { mode?: string }) => {
      if (action === "importStudents" && input.mode === "preview") {
        return { created: 1, merged: 0, skipped: 2, heldMinors: 0, errors: [],
          duplicates: [{ row: 3, reason: "both", existingStudentId: "33333333-3333-4333-8333-333333333333" }, { row: 4, reason: "in_file", existingStudentId: null }] };
      }
      return { created: 1, merged: 1, skipped: 1, heldMinors: 0, errors: [], duplicates: [],
        invites: [{ studentId: "33333333-3333-4333-8333-333333333333", link: "https://hiresume.in/invite/t1", rollNo: "21A01" }], emailed: 0 };
    });
    wrap(<ImportWizard orgId={ORG} />);
    const csv = "Hall Ticket No,Student Name,Email ID,Branch,Year of Passing,CGPA\n" +
      "21A01,Asha,asha@a.in,CSE,2027,8.2\n21A02,Bala,bala@a.in,CSE,2027,7.1\n21A01,Asha copy,asha2@a.in,CSE,2027,8\n21A09,Bad,not-an-email,CSE,2027,7";
    fireEvent.change(screen.getByLabelText("Student file"), { target: { files: [csvFile(csv)] } });

    // Mapping step: detected columns are pre-selected.
    expect(await screen.findByText(/students.csv/)).toBeInTheDocument();
    expect(screen.getByLabelText("Roll no / Hall ticket no")).toHaveValue("0");
    expect(screen.getByLabelText("Email")).toHaveValue("2");
    expect(screen.getByLabelText("Date of birth")).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: "Check rows" }));

    // Preview: the invalid email never reaches the server; the server finds the duplicates.
    await screen.findByText("Students already in your list");
    const previewCall = api.collegeApi.mock.calls[0];
    expect(previewCall[0]).toBe("importStudents");
    expect(previewCall[1]).toMatchObject({ orgId: ORG, mode: "preview" });
    expect(previewCall[1].rows.map((r: { roll_no: string }) => r.roll_no)).toEqual(["21A01", "21A02", "21A01"]);
    expect(screen.getByText("Already in your list (same roll no and email)")).toBeInTheDocument();
    expect(screen.getByText("Repeats an earlier row in this file")).toBeInTheDocument();
    expect(screen.getByText(/Email: invalid email/i)).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(/Merge \(update with this file/));
    fireEvent.click(screen.getByRole("button", { name: "Import 2 students" }));
    await screen.findByText("Import finished");
    expect(api.collegeApi.mock.calls[1][1]).toMatchObject({ mode: "commit", onDuplicate: "merge", sendInvites: true });
    expect(screen.getByText(/1 activation links created/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download links (CSV)" })).toBeInTheDocument();
  });

  it("asks for a column when a required field isn't detected", async () => {
    wrap(<ImportWizard orgId={ORG} />);
    fireEvent.change(screen.getByLabelText("Student file"), { target: { files: [csvFile("Name,Phone\nAsha,99\n")] } });
    expect(await screen.findByText(/Choose a column for: Roll no \/ Hall ticket no, Email/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check rows" })).toBeDisabled();
  });
});

describe("drive form", () => {
  it("previews eligibility for CSE 2027, CGPA ≥ 7, no backlogs and saves the drive", async () => {
    api.collegeApi.mockResolvedValue({ count: 42, sample: [{ id: "44444444-4444-4444-8444-444444444444", full_name: "Asha", roll_no: "21A01" }] });
    wrap(<DriveForm orgId={ORG} drive={null} />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "CSE 2027 placement test" } });
    fireEvent.change(screen.getByLabelText("Coding / MCQ test"), { target: { value: "a1" } });
    fireEvent.change(screen.getByLabelText("AI interview"), { target: { value: "m1" } });
    fireEvent.click(screen.getByLabelText("CSE"));
    fireEvent.click(screen.getByLabelText("2027"));
    fireEvent.change(screen.getByLabelText("Minimum CGPA"), { target: { value: "7" } });
    fireEvent.change(screen.getByLabelText("Most active backlogs allowed"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Check who is eligible" }));
    await waitFor(() => expect(api.collegeApi).toHaveBeenCalledWith("previewEligibility", {
      orgId: ORG, eligibility: { departments: ["CSE"], batch_years: [2027], min_cgpa: 7, max_backlogs: 0 },
    }));
    expect(await screen.findByText("42")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Results for students"), { target: { value: "immediate" } });
    fireEvent.click(screen.getByRole("button", { name: "Create drive" }));
    await waitFor(() => expect(db.insert).toHaveBeenCalled());
    expect(db.from).toHaveBeenCalledWith("drives");
    expect(db.insert.mock.calls[0][0]).toMatchObject({
      org_id: ORG, name: "CSE 2027 placement test", assessment_id: "a1", interview_module_id: "m1", resume_task: false,
      eligibility: { departments: ["CSE"], batch_years: [2027], min_cgpa: 7, max_backlogs: 0 },
      proctoring_policy: "standard", results_release: "immediate", window_start: null, window_end: null,
    });
  });

  it("refuses a drive with nothing to do", async () => {
    wrap(<DriveForm orgId={ORG} drive={null} />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Empty drive" } });
    fireEvent.click(screen.getByRole("button", { name: "Create drive" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Pick a test, an interview or the resume task/);
    expect(db.insert).not.toHaveBeenCalled();
  });
});

const drive = (over: Partial<DriveRecord> = {}): DriveRecord => ({
  id: DRIVE, org_id: ORG, name: "CSE 2027 drive", description: null, assessment_id: "a1", interview_module_id: null, resume_task: false,
  eligibility: { departments: ["CSE"], min_cgpa: 7 }, window_start: null, window_end: null, proctoring_policy: "standard",
  results_release: "manual", results_released_at: null, status: "scheduled", created_at: "2026-10-20T00:00:00Z", ...over,
});

describe("drive detail", () => {
  it("shows counts by status and releases results only after confirmation", async () => {
    api.collegeApi.mockImplementation(async (action: string) =>
      action === "analytics" ? { total: 2, rows: [row(), row({ student_id: "55555555-5555-4555-8555-555555555555", roll_no: "21A02", full_name: "Bala", status: "assigned", overall: null, integrity_band: null, integrity_score: null })], summary: summary() }
        : { ok: true });
    wrap(<DriveView orgId={ORG} drive={drive()} isAdmin />);
    expect(await screen.findByText("Asha")).toBeInTheDocument();
    expect(api.collegeApi).toHaveBeenCalledWith("analytics", expect.objectContaining({ orgId: ORG, filters: { driveId: DRIVE } }));
    expect(screen.getByText("Completed", { selector: "p" }).nextSibling).toHaveTextContent("1");

    fireEvent.click(screen.getByRole("button", { name: "Release results" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/All 2 assigned students will see their scores/)).toBeInTheDocument();
    expect(api.collegeApi).not.toHaveBeenCalledWith("releaseResults", expect.anything());
    fireEvent.click(within(dialog).getByRole("button", { name: "Release results" }));
    await waitFor(() => expect(api.collegeApi).toHaveBeenCalledWith("releaseResults", { driveId: DRIVE }));
  });

  it("no release button for trainers, released drives or never-release drives", async () => {
    api.collegeApi.mockResolvedValue({ total: 0, rows: [], summary: summary() });
    const { unmount } = wrap(<DriveView orgId={ORG} drive={drive()} isAdmin={false} />);
    await screen.findByText(/No students assigned yet/);
    expect(screen.queryByRole("button", { name: "Release results" })).toBeNull();
    unmount();
    wrap(<DriveView orgId={ORG} drive={drive({ results_release: "never" })} isAdmin />);
    await screen.findByText(/No students assigned yet/);
    expect(screen.queryByRole("button", { name: "Release results" })).toBeNull();
  });
});

describe("analytics", () => {
  it("sends the filters to the API, pages, sorts and exports", async () => {
    api.collegeApi.mockImplementation(async (action: string) =>
      action === "exportTable" ? { columns: ["Roll no"], rows: [["21A01"]] } : { total: 120, rows: [row()], summary: summary() });
    const createObjectURL = vi.fn(() => "blob:x");
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    wrap(<Analytics orgId={ORG} orgName="SVR College" />, `/c/${ORG}/analytics?drive=${DRIVE}`);
    await screen.findByText("Asha");
    expect(api.collegeApi.mock.calls[0]).toEqual(["analytics", { orgId: ORG, filters: { driveId: DRIVE }, page: 1, pageSize: 50, sort: { by: "roll_no", dir: "asc" } }]);

    const filters = screen.getByRole("form", { name: "Filters" });
    fireEvent.click(within(filters).getByLabelText("CSE"));
    fireEvent.click(within(filters).getByLabelText("Low"));
    fireEvent.click(within(filters).getByLabelText("Completed"));
    fireEvent.change(screen.getByLabelText("CGPA from"), { target: { value: "7" } });
    fireEvent.change(screen.getByLabelText("Max backlogs"), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "asha" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));
    await waitFor(() => expect(api.collegeApi).toHaveBeenLastCalledWith("analytics", {
      orgId: ORG, page: 1, pageSize: 50, sort: { by: "roll_no", dir: "asc" },
      filters: { driveId: DRIVE, departments: ["CSE"], cgpa: [7, 10], maxBacklogs: 0, integrityBands: ["low"], status: ["completed"], search: "asha" },
    }));

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(api.collegeApi.mock.lastCall?.[1]).toMatchObject({ page: 2 }));
    fireEvent.click(screen.getByRole("button", { name: "Overall %" }));
    await waitFor(() => expect(api.collegeApi.mock.lastCall?.[1]).toMatchObject({ page: 1, sort: { by: "overall", dir: "asc" } }));

    fireEvent.click(screen.getByRole("button", { name: "CSV" }));
    await waitFor(() => expect(api.collegeApi).toHaveBeenCalledWith("exportTable", expect.objectContaining({ format: "csv", filters: expect.objectContaining({ integrityBands: ["low"] }) })));
    await waitFor(() => expect(createObjectURL).toHaveBeenCalled());
    expect(click).toHaveBeenCalled();
    click.mockRestore();
    expect(screen.getByText("Invited").nextSibling).toHaveTextContent("2");
  });
});
