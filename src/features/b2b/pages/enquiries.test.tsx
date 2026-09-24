import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HelmetProvider } from "react-helmet-async";

const hooks = vi.hoisted(() => ({ useIsSuperAdmin: vi.fn() }));
vi.mock("../hooks/useB2B", () => hooks);
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "sa" }, signOut: vi.fn() }) }));

const db = vi.hoisted(() => {
  const rows: unknown[] = [];
  const rpc = vi.fn();
  const update = vi.fn((_row: unknown) => ({ eq: async () => ({ error: null }) }));
  return {
    rows, rpc, update,
    from: vi.fn(() => ({
      select: () => ({ order: () => ({ limit: async () => ({ data: rows, error: null }) }) }),
      update,
    })),
  };
});
vi.mock("@/features/b2b/lib/db", () => ({ b2bDb: { rpc: db.rpc, from: db.from } }));
vi.mock("../lib/db", () => ({ b2bDb: { rpc: db.rpc, from: db.from } }));
const csv = vi.hoisted(() => ({ downloadCsv: vi.fn() }));
vi.mock("../lib/csv-export", async (orig) => ({ ...(await orig<typeof import("../lib/csv-export")>()), downloadCsv: csv.downloadCsv }));

import SuperAdminEnquiries from "./SuperAdminEnquiries";
import CollegePlacement from "@/pages/CollegePlacement";

const row = (over: Record<string, unknown>) => ({
  id: "e1", created_at: "2026-09-24T10:00:00Z", updated_at: "2026-09-24T10:00:00Z", name: "Anita Rao", role: "TPO",
  institution: "Example College of Engineering", email: "tpo@example.ac.in", phone: "+91 98765 43210", students: "400",
  message: "Pilot for final years", source: "/college-placement", status: "new", notes: null, ...over,
});

const wrap = (ui: React.ReactNode) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<HelmetProvider><QueryClientProvider client={qc}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider></HelmetProvider>);
};

beforeEach(() => {
  vi.clearAllMocks();
  db.rows.length = 0;
  hooks.useIsSuperAdmin.mockReturnValue({ data: true, isLoading: false });
});

describe("SuperAdminEnquiries", () => {
  it("lists open enquiries, filters by status and search, and exports CSV", async () => {
    db.rows.push(
      row({}),
      row({ id: "e2", institution: "Skill Academy", email: "hello@skill.example", status: "contacted", phone: null }),
      row({ id: "e3", institution: "Old Lead College", email: "x@old.example", status: "lost" }),
    );
    wrap(<SuperAdminEnquiries />);
    expect(await screen.findByText("Example College of Engineering")).toBeInTheDocument();
    expect(screen.getByText("Skill Academy")).toBeInTheDocument();
    expect(screen.queryByText("Old Lead College")).toBeNull(); // "Open" hides won/lost/spam
    expect(screen.getByRole("link", { name: /tpo@example\.ac\.in/ }).getAttribute("href")).toMatch(/^mailto:tpo@example\.ac\.in/);
    expect(screen.getByRole("link", { name: /98765/ }).getAttribute("href")).toBe("tel:+919876543210");

    fireEvent.click(screen.getByRole("tab", { name: /Lost/ }));
    expect(screen.getByText("Old Lead College")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /All/ }));
    fireEvent.change(screen.getByLabelText("Search enquiries"), { target: { value: "skill" } });
    expect(screen.getAllByTestId("enquiry")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: /CSV/ }));
    expect(csv.downloadCsv).toHaveBeenCalledWith(expect.stringMatching(/^hiresume-enquiries-/), expect.stringContaining("Skill Academy"));
  });

  it("updates status and saves notes", async () => {
    db.rows.push(row({}));
    wrap(<SuperAdminEnquiries />);
    const card = (await screen.findAllByTestId("enquiry"))[0];
    fireEvent.change(within(card).getByLabelText(/Status for/), { target: { value: "demo_scheduled" } });
    await waitFor(() => expect(db.update).toHaveBeenCalledWith({ status: "demo_scheduled" }));
    fireEvent.change(within(card).getByLabelText("Notes"), { target: { value: "  Demo Friday 3pm  " } });
    fireEvent.click(within(card).getByRole("button", { name: "Save notes" }));
    await waitFor(() => expect(db.update).toHaveBeenCalledWith({ notes: "Demo Friday 3pm" }));
  });

  it("sends non-admins away", () => {
    hooks.useIsSuperAdmin.mockReturnValue({ data: false, isLoading: false });
    wrap(<SuperAdminEnquiries />);
    expect(screen.queryByText("Enquiries")).toBeNull();
  });
});

describe("College placement enquiry form", () => {
  const fill = () => {
    fireEvent.change(screen.getByPlaceholderText("Your name"), { target: { value: "Anita Rao" } });
    fireEvent.change(screen.getByPlaceholderText("Placement Officer / TPO"), { target: { value: "TPO" } });
    fireEvent.change(screen.getByPlaceholderText("Your college or institute"), { target: { value: "Example College" } });
    fireEvent.change(screen.getByPlaceholderText("tpo@college.ac.in"), { target: { value: "tpo@example.ac.in" } });
  };

  it("saves the enquiry and confirms it honestly", async () => {
    db.rpc.mockResolvedValue({ data: { ok: true }, error: null });
    wrap(<CollegePlacement />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Send enquiry" }));
    expect(await screen.findByText(/we've received your enquiry/i)).toBeInTheDocument();
    expect(db.rpc).toHaveBeenCalledWith("submit_institution_enquiry", expect.objectContaining({
      _name: "Anita Rao", _institution: "Example College", _email: "tpo@example.ac.in", _website: "", _source: "/college-placement",
    }));
  });

  it("explains validation problems and offers email if the server can't be reached", async () => {
    db.rpc.mockResolvedValueOnce({ data: { ok: false, reason: "INVALID_EMAIL" }, error: null });
    wrap(<CollegePlacement />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Send enquiry" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("valid email");

    db.rpc.mockResolvedValueOnce({ data: null, error: { message: "Failed to fetch" } });
    fireEvent.click(screen.getByRole("button", { name: "Send enquiry" }));
    const link = await screen.findByRole("link", { name: /Email it to us instead/ });
    expect(link.getAttribute("href")).toMatch(/^mailto:support@hiresume\.in\?subject=Institution%20enquiry/);
    expect(screen.queryByText(/we've received/i)).toBeNull();
  });
});
