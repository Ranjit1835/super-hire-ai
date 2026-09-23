import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DIMENSIONS } from "../lib/shared";
import { OrgContext } from "../components/OrgContext";

const dash = vi.hoisted(() => ({ useDashboardData: vi.fn(), useStudentDetail: vi.fn(), useInterviewTranscript: vi.fn() }));
vi.mock("../hooks/useDashboard", () => dash);
const xlsx = vi.hoisted(() => ({ buildBatchWorkbook: vi.fn(async (_input: unknown) => new ArrayBuffer(8)), downloadBlob: vi.fn() }));
vi.mock("../lib/export-xlsx", () => xlsx);
const pdf = vi.hoisted(() => ({ buildStudentPdf: vi.fn(async (_input: unknown) => new Uint8Array([37])), fetchLogo: vi.fn(async () => null), pdfSafe: (s: string) => s }));
vi.mock("../lib/export-pdf", () => pdf);

import OrgDashboard from "./OrgDashboard";
import StudentDetail from "./StudentDetail";

const org = {
  id: "org-a", name: "SVR Engineering College", slug: "svr", type: "college" as const, logo_url: "https://x/logo.png", is_demo: false,
  plan_id: "pilot", plan_starts_at: "", plan_ends_at: null, created_at: "",
};
const dims = (v: number, over: Record<string, number | null> = {}) => ({ ...Object.fromEntries(DIMENSIONS.map((d) => [d, v])), ...over });
const roster = [
  { user_id: "u1", full_name: "Anil Kumar", roll_no: "A01", email: "a@x.in", batch_id: "b1", batch_name: "CSE A", department: "CSE" },
  { user_id: "u2", full_name: "Divya Reddy", roll_no: "A02", email: "d@x.in", batch_id: "b1", batch_name: "CSE A", department: "CSE" },
  { user_id: "u3", full_name: "Kiran Rao", roll_no: "B01", email: "k@x.in", batch_id: "b2", batch_name: "ECE B", department: "ECE" },
];
const ev = (id: string, user: string, overall: number, readiness: string, d: Record<string, number | null>, day: number, module = "sql") => ({
  interview_id: id, user_id: user, module_id: module, module_name: module === "sql" ? "SQL" : "Java", module_type: "skill", pass_threshold: 6,
  started_at: `2026-09-${String(day).padStart(2, "0")}T10:00:00Z`, completed_at: "", overall_score: overall, readiness_level: readiness,
  primary_gap: `gap ${user}`, dimensions: d, per_topic: { Joins: overall - 1, Indexes: overall },
});
const evals = [
  ev("i1", "u1", 4, "not_ready", dims(4, { technical_knowledge: 2 }), 1),
  ev("i2", "u1", 6.5, "developing", dims(6.5, { communication: 3, language: 4, confidence: 4 }), 12),
  ev("i3", "u2", 8.2, "ready", dims(8), 3),
];
const ok = <T,>(data: T) => ({ data, isLoading: false, error: null });

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <OrgContext.Provider value={{ org, role: "org_admin", canManage: true }}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/org/:orgId/dashboard" element={<OrgDashboard />} />
            <Route path="/org/:orgId/students/:userId" element={<StudentDetail />} />
          </Routes>
        </MemoryRouter>
      </OrgContext.Provider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  dash.useDashboardData.mockReturnValue(ok({ roster, batches: [{ id: "b1", org_id: "org-a", name: "CSE A", department: "CSE" }, { id: "b2", org_id: "org-a", name: "ECE B", department: "ECE" }], evals }));
  dash.useInterviewTranscript.mockReturnValue(ok([{ turn_index: 1, role: "interviewer", content: "What is a join?", topic: "Joins", difficulty: "beginner" }, { turn_index: 1, role: "student", content: "It combines tables", topic: null, difficulty: null }]));
});

describe("OrgDashboard", () => {
  it("summarises readiness, improvement and weakest topics", () => {
    renderAt("/org/org-a/dashboard");
    expect(screen.getByText("Readiness · 3 students")).toBeInTheDocument();
    expect(screen.getByText("First → latest").parentElement).toHaveTextContent("+2.5"); // Anil 4 → 6.5
    expect(screen.getByText(/4 → 6.5 · 1 up, 0 down/)).toBeInTheDocument();
    expect(screen.getByText("Weakest topics")).toBeInTheDocument();
  });

  it("renders a heatmap row per student with focus areas, sorted weakest first", () => {
    renderAt("/org/org-a/dashboard");
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows.map((r) => within(r).getAllByRole("link")[0].textContent)).toEqual(["Anil Kumar", "Divya Reddy", "Kiran Rao"]);
    expect(within(rows[0]).getByText("Needs communication")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Ready")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Not attempted")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Sort by Overall/ }));
    expect(within(screen.getAllByRole("row")[1]).getAllByRole("link")[0].textContent).toBe("Divya Reddy");
  });

  it("quick views and filters narrow the student list", () => {
    renderAt("/org/org-a/dashboard");
    const views = within(screen.getByRole("group", { name: "Quick views" }));
    fireEvent.click(views.getByRole("button", { name: /^Needs communication/ }));
    expect(screen.getAllByRole("row")).toHaveLength(2);
    fireEvent.click(views.getByRole("button", { name: /^All students/ }));
    fireEvent.change(screen.getByLabelText("Search students"), { target: { value: "B01" } });
    expect(within(screen.getAllByRole("row")[1]).getAllByRole("link")[0].textContent).toBe("Kiran Rao");
  });

  it("exports the filtered rows to Excel", async () => {
    renderAt("/org/org-a/dashboard");
    fireEvent.click(within(screen.getByRole("group", { name: "Quick views" })).getByRole("button", { name: /^Ready/ }));
    fireEvent.click(screen.getByRole("button", { name: /Export Excel/ }));
    await waitFor(() => expect(xlsx.downloadBlob).toHaveBeenCalled());
    const arg = xlsx.buildBatchWorkbook.mock.calls[0][0] as { rows: Array<{ student: { user_id: string } }>; scopeLabel: string; orgName: string };
    expect(arg.rows.map((r) => r.student.user_id)).toEqual(["u2"]);
    expect(arg.scopeLabel).toBe("All modules · Ready");
    expect((xlsx.downloadBlob.mock.calls[0] as unknown[])[0]).toMatch(/^svr-readiness-\d{4}-\d{2}-\d{2}\.xlsx$/);
  });

  it("explains the plan limit instead of failing", () => {
    dash.useDashboardData.mockReturnValue({ data: undefined, isLoading: false, error: { message: "PLAN_FEATURE: the batch dashboard is not included" } });
    renderAt("/org/org-a/dashboard");
    expect(screen.getByText(/part of the Pilot and Pro plans/)).toBeInTheDocument();
  });
});

describe("StudentDetail", () => {
  const result = {
    dimensions: Object.fromEntries(DIMENSIONS.map((d) => [d, { score: 6.5, evidence: ["it combines tables"], reason: "ok" }])),
    per_topic: { Joins: { score: 6, evidence: ["it combines tables"], reason: "ok" } },
    primary_gap: "Needs depth on indexes", readiness_level: "developing", recommended_focus: ["Indexes"],
    overall_score: 6.5, passed: true, model_readiness_level: "developing", dropped_evidence: 0,
  };
  beforeEach(() => {
    dash.useStudentDetail.mockReturnValue(ok({
      student: roster[0],
      interviews: [
        { id: "i1", module_id: "sql", status: "completed", started_at: "2026-09-01T10:00:00Z", completed_at: null, end_reason: "max_turns", module_spec: { name: "SQL", pass_threshold: 6, topics: [] } },
        { id: "i2", module_id: "sql", status: "completed", started_at: "2026-09-12T10:00:00Z", completed_at: null, end_reason: "max_turns", module_spec: { name: "SQL", pass_threshold: 6, topics: [] } },
      ],
      evaluations: new Map([
        ["i1", { id: "e1", interview_id: "i1", result: { ...result, overall_score: 4, primary_gap: "Old gap" }, audio_metrics: null, overall_score: 4, readiness_level: "not_ready" }],
        ["i2", { id: "e2", interview_id: "i2", result, audio_metrics: null, overall_score: 6.5, readiness_level: "developing" }],
      ]),
    }));
  });

  it("shows all interviews, defaults to the latest report with evidence and transcript, and switches interviews", () => {
    renderAt("/org/org-a/students/u1");
    expect(screen.getByText("Anil Kumar")).toBeInTheDocument();
    expect(screen.getByText(/Needs depth on indexes/)).toBeInTheDocument();
    expect(screen.getByText(/quotes from the student's answers/)).toBeInTheDocument();
    expect(screen.getByText("What is a join?")).toBeInTheDocument();
    fireEvent.click(screen.getByText("4/10"));
    expect(screen.getByText(/Old gap/)).toBeInTheDocument();
  });

  it("builds a PDF with the institution logo and the full history", async () => {
    renderAt("/org/org-a/students/u1");
    fireEvent.click(screen.getByRole("button", { name: /PDF report/ }));
    await waitFor(() => expect(pdf.buildStudentPdf).toHaveBeenCalled());
    expect(pdf.fetchLogo).toHaveBeenCalledWith("https://x/logo.png");
    const arg = pdf.buildStudentPdf.mock.calls[0][0] as { orgName: string; interviews: unknown[]; latest: { module_name: string } };
    expect(arg.orgName).toBe("SVR Engineering College");
    expect(arg.interviews).toHaveLength(2);
    expect(arg.latest.module_name).toBe("SQL");
    await waitFor(() => expect(xlsx.downloadBlob).toHaveBeenCalledWith("svr-A01-report.pdf", expect.anything(), "application/pdf"));
  });
});
