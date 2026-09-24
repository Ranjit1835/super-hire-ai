import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { OrgContext } from "../components/OrgContext";

// ── shared mocks ─────────────────────────────────────────────────────────────
const voice = vi.hoisted(() => ({
  hook: { phase: "idle", transcript: "", supported: true, speak: vi.fn(async () => {}), listen: vi.fn(), finishAnswer: vi.fn(), cancel: vi.fn() },
}));
vi.mock("../hooks/useVoiceAnswer", async (orig) => ({
  ...(await orig<typeof import("../hooks/useVoiceAnswer")>()),
  useVoiceAnswer: () => voice.hook,
  voiceSupport: () => ({ stt: false, tts: true }), // typed answers keep the test simple
}));
const api = vi.hoisted(() => ({
  publicTestApi: { info: vi.fn(), start: vi.fn() },
  interviewApi: { current: vi.fn(), start: vi.fn(), resume: vi.fn(), answer: vi.fn(), end: vi.fn() },
  evaluateApi: { evaluate: vi.fn(async () => ({ status: "pending", evaluation: null })), get: vi.fn(async () => ({ status: "pending", evaluation: null })) },
  ensureVisitorSession: vi.fn(async () => {}),
}));
vi.mock("../lib/api", async (orig) => ({ ...(await orig<typeof import("../lib/api")>()), ...api }));
const session = vi.hoisted(() => ({ value: null as null | object }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: { getSession: async () => ({ data: { session: session.value } }) } } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "admin" }, signOut: vi.fn() }) }));

const dbm = vi.hoisted(() => ({ rpc: vi.fn(), update: vi.fn(), leads: [] as unknown[] }));
vi.mock("../lib/db", () => ({
  b2bDb: {
    rpc: dbm.rpc,
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          order: () => ({ limit: async () => ({ data: table === "org_leads" ? dbm.leads : [], error: null }) }),
          maybeSingle: async () => ({ data: null, error: null }),
        }),
      }),
      update: (row: unknown) => { dbm.update(table, row); return { eq: async () => ({ error: null }) }; },
    }),
  },
}));
const hooks = vi.hoisted(() => ({ useOrgModules: vi.fn() }));
vi.mock("../hooks/useB2B", () => hooks);

import PublicTest from "./PublicTest";
import OrgLeads from "./OrgLeads";

const info = {
  org: { name: "Java Academy", slug: "java-academy", type: "coaching_institute", logo_url: null, is_demo: false, cta_label: "Book a free demo class", cta_url: "https://wa.me/919876543210" },
  available: true,
  modules: [{ id: "m1", name: "Java Readiness", type: "skill", description: "Core Java", minutes: 10, questions: 6 }],
};
const payload = (over: Record<string, unknown> = {}, question: string | null = "What is a class?") => ({
  interview: {
    id: "iv1", module_id: "m1", module_name: "Java Readiness", status: "in_progress", end_reason: null,
    started_at: new Date().toISOString(), deadline_at: new Date(Date.now() + 600_000).toISOString(), server_now: new Date().toISOString(),
    turn_count: 0, max_turns: 6, topics_total: 2, topics_covered: 0, current_topic: "OOP", ...over,
  },
  question, closing: null, transcript: [],
});

function renderPublic() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={["/test/java-academy"]}>
    <Routes><Route path="/test/:slug" element={<PublicTest />} /></Routes></MemoryRouter></QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  session.value = null;
  api.publicTestApi.info.mockResolvedValue(info);
  api.interviewApi.current.mockResolvedValue({ interview: null });
});

describe("PublicTest", () => {
  const fill = () => {
    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Ravi Kumar" } });
    fireEvent.change(screen.getByLabelText("Mobile number"), { target: { value: "98765 43210" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "Ravi@Gmail.com" } });
  };

  it("shows the institute's branding and requires consent and valid details", async () => {
    renderPublic();
    expect(await screen.findByText("Java Academy")).toBeInTheDocument();
    expect(screen.getByText("Java Readiness")).toBeInTheDocument();
    const start = screen.getByRole("button", { name: /Start my free test/ });
    expect(start).toBeDisabled(); // no consent yet
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.change(screen.getByLabelText("Mobile number"), { target: { value: "12345" } });
    fireEvent.click(start);
    expect(await screen.findByText("Enter a 10-digit Indian mobile number")).toBeInTheDocument();
    expect(screen.getByText("Please enter your name")).toBeInTheDocument();
    expect(api.publicTestApi.start).not.toHaveBeenCalled();
  });

  it("starts an anonymous session, creates the lead, runs the test, and ends with the report and enquiry button", async () => {
    api.publicTestApi.start.mockResolvedValue({ interviewId: "iv1" });
    api.interviewApi.resume.mockResolvedValue(payload());
    api.interviewApi.answer.mockResolvedValue({ ...payload({ status: "completed", end_reason: "max_turns", turn_count: 1 }, null), closing: "Thank you." });
    renderPublic();
    await screen.findByText("Java Academy");
    fill();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /Start my free test/ }));

    await waitFor(() => expect(api.publicTestApi.start).toHaveBeenCalled());
    expect(api.ensureVisitorSession).toHaveBeenCalled();
    expect(api.publicTestApi.start.mock.calls[0][0]).toMatchObject({
      slug: "java-academy", moduleId: "m1",
      lead: { full_name: "Ravi Kumar", phone: "+919876543210", email: "ravi@gmail.com", target_course: "" },
    });
    fireEvent.change(await screen.findByLabelText(/Your answer/), { target: { value: "A class is a blueprint" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit answer" }));
    expect(await screen.findByText("Your readiness report")).toBeInTheDocument();
    const cta = screen.getByRole("link", { name: /Book a free demo class/ });
    expect(cta.getAttribute("href")).toBe("https://wa.me/919876543210");
    expect(api.evaluateApi.evaluate).toHaveBeenCalledWith("iv1");
  });

  it("explains limits from the server without losing the form", async () => {
    const { ApiError } = await import("../lib/api");
    api.publicTestApi.start.mockRejectedValue(new ApiError(429, "ALREADY_TAKEN", "You've already taken this test recently."));
    renderPublic();
    await screen.findByText("Java Academy");
    fill();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /Start my free test/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("already taken");
    expect((screen.getByLabelText("Your name") as HTMLInputElement).value).toBe("Ravi Kumar");
  });

  it("when fully booked, shows the enquiry button instead of the form", async () => {
    api.publicTestApi.info.mockResolvedValue({ ...info, available: false });
    renderPublic();
    expect(await screen.findByText(/fully booked/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Your name")).toBeNull();
    expect(screen.getByRole("link", { name: /Book a free demo class/ })).toBeInTheDocument();
  });

  it("offers to continue a test in progress after a reload", async () => {
    session.value = { access_token: "anon" };
    api.interviewApi.current.mockResolvedValue(payload({ turn_count: 2 }));
    api.interviewApi.resume.mockResolvedValue(payload({ turn_count: 2 }, "Question three?"));
    renderPublic();
    fireEvent.click(await screen.findByRole("button", { name: /Continue/ }));
    expect(await screen.findByText("Question three?")).toBeInTheDocument();
  });

  it("unknown or closed links explain themselves", async () => {
    api.publicTestApi.info.mockResolvedValue(null);
    renderPublic();
    expect(await screen.findByText("This test isn't available")).toBeInTheDocument();
  });
});

describe("OrgLeads", () => {
  const org = { id: "o1", name: "Java Academy", slug: "java-academy", type: "coaching_institute" as const, logo_url: null, is_demo: false, plan_id: "pilot", plan_starts_at: "", plan_ends_at: null, created_at: "" };
  const renderLeads = (canManage = true) => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(<QueryClientProvider client={qc}><OrgContext.Provider value={{ org, role: canManage ? "org_admin" : "trainer", canManage }}>
      <MemoryRouter><OrgLeads /></MemoryRouter></OrgContext.Provider></QueryClientProvider>);
  };
  beforeEach(() => {
    dbm.rpc.mockImplementation(async (fn: string) => fn === "org_public_test_usage"
      ? { data: { enabled: true, monthly_cap: 100, used_this_month: 12, cta_label: null, cta_url: null, slug: "java-academy" }, error: null }
      : { data: null, error: null });
    dbm.leads = [
      { id: "l1", full_name: "Ravi Kumar", phone: "+919876543210", email: "ravi@gmail.com", target_course: "Java Full Stack", module_id: "m1", interview_id: "iv1", status: "new", overall_score: "5.5", readiness_level: "developing", primary_gap: "Collections", created_at: "2026-09-20T10:00:00Z" },
      { id: "l2", full_name: "Sita Rao", phone: "+919000000001", email: "sita@gmail.com", target_course: null, module_id: "m1", interview_id: null, status: "enrolled", overall_score: null, readiness_level: null, primary_gap: null, created_at: "2026-09-21T10:00:00Z" },
    ];
    hooks.useOrgModules.mockReturnValue({ data: { own: [{ id: "m1", name: "Java Readiness", is_active: true, public_test: true }], library: [] } });
  });

  it("shows the public link, usage against the cap, and leads with results", async () => {
    renderLeads();
    expect(await screen.findByText(/\/test\/java-academy$/)).toBeInTheDocument();
    expect(screen.getByText("Tests this month").parentElement).toHaveTextContent("12 / 100");
    const ravi = screen.getByText("Ravi Kumar").closest("tr")!;
    expect(within(ravi).getByText("Developing")).toBeInTheDocument();
    expect(within(screen.getByText("Sita Rao").closest("tr")!).getByText("Pending / incomplete")).toBeInTheDocument();
  });

  it("filters, updates status and saves settings through the admin RPC", async () => {
    renderLeads();
    await screen.findByText("Ravi Kumar");
    fireEvent.change(screen.getByLabelText("Search leads"), { target: { value: "sita" } });
    expect(screen.queryByText("Ravi Kumar")).toBeNull();
    fireEvent.change(screen.getByLabelText("Search leads"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Button text"), { target: { value: "Book a demo" } });
    fireEvent.change(screen.getByLabelText(/Button link/), { target: { value: "https://wa.me/919876543210" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(dbm.rpc).toHaveBeenCalledWith("org_update_public_test_settings", {
      _org_id: "o1", _enabled: true, _cta_label: "Book a demo", _cta_url: "https://wa.me/919876543210",
    }));
    fireEvent.click(screen.getByRole("switch", { name: "Offer Java Readiness" }));
    await waitFor(() => expect(dbm.update).toHaveBeenCalledWith("interview_modules", { public_test: false }));
  });

  it("trainers can view but not manage", async () => {
    renderLeads(false);
    await screen.findByText("Ravi Kumar");
    expect(screen.queryByLabelText("Button text")).toBeNull();
    expect(screen.queryByRole("combobox", { name: /Status for/ })).toBeNull();
  });
});
