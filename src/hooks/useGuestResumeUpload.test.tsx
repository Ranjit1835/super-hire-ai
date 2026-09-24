import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";

const nav = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock("react-router-dom", async (orig) => ({ ...(await orig<typeof import("react-router-dom")>()), useNavigate: () => nav.navigate }));
const auth = vi.hoisted(() => ({ user: null as null | { id: string } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: auth.user }) }));
const pdf = vi.hoisted(() => ({ extractTextFromPdf: vi.fn(async () => "Resume text with skills"), hashContent: vi.fn(async () => "hash") }));
vi.mock("@/lib/pdf-parser", () => pdf);

import { useGuestResumeUpload, describeAnalysisError } from "./useGuestResumeUpload";
import { UploadFailurePanel } from "@/components/UploadFailurePanel";

const wrapper = ({ children }: { children: ReactNode }) => <MemoryRouter>{children}</MemoryRouter>;
const pdfFile = (name = "resume.pdf", body = "%PDF-1.4") => new File([body], name, { type: "application/pdf" });
const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  auth.user = null;
  vi.stubGlobal("fetch", fetchMock);
});

describe("describeAnalysisError", () => {
  it("explains provider limits, unreadable PDFs and network failures in plain words", () => {
    expect(describeAnalysisError("Rate limit exceeded. Please try again later.", 500).kind).toBe("busy");
    expect(describeAnalysisError("", 503).kind).toBe("busy");
    expect(describeAnalysisError("Could not extract text from this PDF").kind).toBe("unreadable");
    expect(describeAnalysisError("Failed to fetch").kind).toBe("network");
    expect(describeAnalysisError("x".repeat(300)).message).not.toContain("xxxx");
  });
});

describe("useGuestResumeUpload", () => {
  it("keeps the file after a busy error and retries with it", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again later." }), { status: 500 }));
    const { result } = renderHook(() => useGuestResumeUpload(), { wrapper });
    const file = pdfFile();
    await act(() => result.current.upload(file));
    expect(result.current.failure).toMatchObject({ kind: "busy", file });
    expect(nav.navigate).not.toHaveBeenCalled();

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ guestToken: "tok" }), { status: 200 }));
    await act(async () => { result.current.retry(); await new Promise((r) => setTimeout(r, 0)); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.failure).toBeNull();
    expect(nav.navigate).toHaveBeenCalledWith("/analysis/guest/tok");
  });

  it("rejects non-PDFs and scanned PDFs without offering a pointless retry", async () => {
    const { result } = renderHook(() => useGuestResumeUpload(), { wrapper });
    await act(() => result.current.upload(new File(["x"], "cv.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" })));
    expect(result.current.failure).toMatchObject({ kind: "invalid", file: null });
    expect(result.current.failure?.message).toMatch(/Save As → PDF/);

    pdf.extractTextFromPdf.mockResolvedValueOnce("   ");
    await act(() => result.current.upload(pdfFile()));
    expect(result.current.failure).toMatchObject({ kind: "unreadable", file: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("hands signed-in users to the dashboard instead of calling the API", async () => {
    auth.user = { id: "u1" };
    const { result } = renderHook(() => useGuestResumeUpload(), { wrapper });
    await act(() => result.current.upload(pdfFile()));
    expect(nav.navigate).toHaveBeenCalledWith("/dashboard?autoAnalyze=true");
    expect(JSON.parse(sessionStorage.getItem("pendingResume")!)).toMatchObject({ fileName: "resume.pdf", contentHash: "hash" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("UploadFailurePanel", () => {
  it("offers retry only when the same file can be retried", () => {
    const onRetry = vi.fn(), onPick = vi.fn();
    const { rerender } = render(<UploadFailurePanel failure={{ kind: "busy", title: "Our AI is busy right now", message: "m", file: pdfFile("cv.pdf") }} onRetry={onRetry} onPickAnother={onPick} />);
    fireEvent.click(screen.getByRole("button", { name: /Try again/ }));
    expect(onRetry).toHaveBeenCalled();
    expect(screen.getByText(/cv\.pdf/)).toBeInTheDocument();
    rerender(<UploadFailurePanel failure={{ kind: "invalid", title: "Please upload a PDF", message: "m", file: null }} onRetry={onRetry} onPickAnother={onPick} />);
    expect(screen.queryByRole("button", { name: /Try again/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Choose a PDF/ }));
    expect(onPick).toHaveBeenCalled();
  });
});
