import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const api = vi.hoisted(() => ({ proctorApi: vi.fn() }));
vi.mock("../lib/api", async (orig) => ({ ...(await orig<typeof import("../lib/api")>()), proctorApi: api.proctorApi }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { storage: { from: () => ({ uploadToSignedUrl: vi.fn().mockResolvedValue({ error: null }) }) }, auth: { getSession: vi.fn() } },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" }, signOut: vi.fn() }) }));
vi.mock("./detector", async (orig) => ({ ...(await orig<typeof import("./detector")>()), loadLandmarker: () => new Promise(() => {}) }));

import { ProctoredSession, useProctor } from "./index";
import { SystemCheckPanel } from "./SystemCheckPanel";
import { ConsentStep } from "./ConsentStep";
import { consentItems, CONSENT_VERSION } from "./consent";
import ReviewPage from "./ReviewPage";

const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const SID = "11111111-1111-4111-8111-111111111111";
const AID = "22222222-2222-4222-8222-222222222222";

class FakeTrack extends EventTarget {
  readyState = "live";
  label = "Integrated Webcam";
  constructor(public kind: string, public surface = "") { super(); }
  getSettings() { return { displaySurface: this.surface }; }
  stop() { this.readyState = "ended"; }
}
const fakeStream = (tracks: FakeTrack[]) => ({
  getTracks: () => tracks, getVideoTracks: () => tracks.filter((t) => t.kind === "video"), getAudioTracks: () => tracks.filter((t) => t.kind === "audio"),
}) as unknown as MediaStream;

const media = { getUserMedia: vi.fn(), getDisplayMedia: vi.fn() };
let ua = CHROME;
let extended = false;

beforeEach(() => {
  ua = CHROME;
  extended = false;
  api.proctorApi.mockReset();
  media.getUserMedia.mockReset().mockResolvedValue(fakeStream([new FakeTrack("video"), new FakeTrack("audio")]));
  media.getDisplayMedia.mockReset().mockResolvedValue(fakeStream([new FakeTrack("video", "monitor")]));
  Object.defineProperty(navigator, "userAgent", { configurable: true, get: () => ua });
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: media });
  Object.defineProperty(navigator, "connection", { configurable: true, value: { downlink: 10 } });
  Object.defineProperty(navigator, "hardwareConcurrency", { configurable: true, value: 4 });
  Object.defineProperty(navigator, "deviceMemory", { configurable: true, value: 8 });
  Object.defineProperty(window.screen, "isExtended", { configurable: true, get: () => extended });
  HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
});

const status = (label: string) => screen.getByTestId(`check-${label}`).getAttribute("data-status");

describe("system check", () => {
  it("blocks non-Chromium browsers and phones with a clear message", () => {
    ua = "Mozilla/5.0 (Windows NT 10.0; rv:131.0) Gecko/20100101 Firefox/131.0";
    const { unmount } = render(<SystemCheckPanel kind="assessment" onPassed={vi.fn()} />);
    expect(screen.getByTestId("unsupported")).toHaveTextContent(/Chrome or Microsoft Edge/);
    unmount();
    ua = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36";
    render(<SystemCheckPanel kind="assessment" onPassed={vi.fn()} />);
    expect(screen.getByTestId("unsupported")).toHaveTextContent(/laptop or desktop/);
  });

  it("camera permission denied: explains how to fix, can't continue", async () => {
    media.getUserMedia.mockRejectedValue(Object.assign(new Error("no"), { name: "NotAllowedError" }));
    render(<SystemCheckPanel kind="assessment" onPassed={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Allow camera/ }));
    await waitFor(() => expect(status("Camera")).toBe("fail"));
    expect(screen.getByText(/Permission was blocked/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  });

  it("an extra display fails the check", async () => {
    extended = true;
    render(<SystemCheckPanel kind="assessment" onPassed={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Allow camera/ }));
    await waitFor(() => expect(status("Camera")).toBe("ok"));
    expect(status("Displays")).toBe("fail");
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  });

  it("all good: passes with browser, devices, bandwidth and tier", async () => {
    const onPassed = vi.fn();
    render(<SystemCheckPanel kind="assessment" onPassed={onPassed} />);
    fireEvent.click(screen.getByRole("button", { name: /Allow camera/ }));
    await waitFor(() => expect(status("Microphone")).toBe("ok"));
    await waitFor(() => expect(status("Connection")).toBe("ok"));
    fireEvent.click(screen.getByRole("button", { name: "I heard it" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(onPassed).toHaveBeenCalledWith(expect.objectContaining({
      browser: expect.objectContaining({ browser: "Chrome", version: 130 }), camera: true, mic: true, speakers: true,
      bandwidthKbps: 10000, displays: 1, tier: "full",
    }));
  });
});

describe("consent", () => {
  const ctx = { orgName: "SVR College", retentionDays: 90, contactEmail: "tpo@svr.in", kind: "assessment" as const, hasAttempt: true };

  it("itemised per purpose with what, why, who sees it, retention and contact", () => {
    const items = consentItems(ctx);
    expect(items.map((i) => i.purpose)).toEqual(["assessment", "proctoring_screen", "proctoring_camera", "proctoring_audio"]);
    for (const i of items) expect(i.text).toMatch(/What:[\s\S]*Why:[\s\S]*Who sees it: authorised staff at SVR College[\s\S]*90 days[\s\S]*tpo@svr.in/);
    expect(consentItems({ ...ctx, kind: "interview", hasAttempt: false }).map((i) => i.purpose)).toEqual(["proctoring_screen", "proctoring_camera"]);
    expect(items.map((i) => i.text).join(" ")).not.toMatch(/100%|cheat-proof|guarantee/i);
  });

  it("each item must be accepted separately; the exact text and version are returned", () => {
    const onAccept = vi.fn();
    render(<ConsentStep ctx={ctx} onAccept={onAccept} />);
    const btn = screen.getByRole("button", { name: /I agree, continue/ });
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes).toHaveLength(4);
    boxes.slice(0, 3).forEach((b) => fireEvent.click(b));
    expect(btn).toBeDisabled();
    fireEvent.click(boxes[3]);
    fireEvent.click(btn);
    const accepted = onAccept.mock.calls[0][0];
    expect(accepted).toHaveLength(4);
    expect(accepted[1]).toEqual({ purpose: "proctoring_screen", version: CONSENT_VERSION, text: consentItems(ctx)[1].text });
  });
});

function Child() {
  const p = useProctor();
  return <p data-testid="child">test runner · session {p.sessionId ?? "none"} · paused {String(p.paused)}</p>;
}

function routeApi(over: Record<string, unknown> = {}) {
  api.proctorApi.mockImplementation(async (action: string) => {
    const r: Record<string, unknown> = {
      preflight: { policy: "standard", orgName: "SVR College", retentionDays: 90, contactEmail: null, strictMaxViolations: 3, snapshotIntervalS: 30 },
      start: { sessionId: SID, policy: "standard", snapshotIntervalS: 30, uploadPrefix: "x", strictMaxViolations: 3, status: "active", resumed: false,
               checks: { faces: true, headPose: true, vad: true } },
      events: { accepted: 1, violations: 0, action: "none" },
      end: { integrityScore: 100, band: "high" },
      ...over,
    };
    if (r[action] instanceof Error) throw r[action];
    return r[action];
  });
}

describe("ProctoredSession", () => {
  it("system check → consent → entire-screen share → children; ends the session on unmount", async () => {
    routeApi();
    const onReady = vi.fn();
    const { unmount } = render(<ProctoredSession attemptId={AID} policy="standard" kind="assessment" onReady={onReady}><Child /></ProctoredSession>);
    await screen.findByRole("button", { name: /Allow camera/ });
    expect(screen.queryByTestId("child")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Allow camera/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    for (const b of screen.getAllByRole("checkbox")) fireEvent.click(b);
    fireEvent.click(screen.getByRole("button", { name: /I agree, continue/ }));

    // A window share is rejected.
    media.getDisplayMedia.mockResolvedValueOnce(fakeStream([new FakeTrack("video", "window")]));
    fireEvent.click(screen.getByRole("button", { name: "Share entire screen" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/single window/);
    fireEvent.click(screen.getByRole("button", { name: "Share entire screen" }));
    await screen.findByTestId("share-ok");
    fireEvent.click(screen.getByRole("button", { name: /start/i }));

    expect(await screen.findByTestId("child")).toHaveTextContent(`session ${SID} · paused false`);
    expect(onReady).toHaveBeenCalledWith(SID);
    const startCall = api.proctorApi.mock.calls.find((c) => c[0] === "start")![1];
    expect(startCall).toMatchObject({ attemptId: AID, kind: "assessment",
      systemCheck: expect.objectContaining({ screen: "monitor", displays: 1, chromium: true, tier: "full" }) });
    expect(startCall.consents.map((c: { purpose: string }) => c.purpose)).toEqual(["assessment", "proctoring_screen", "proctoring_camera", "proctoring_audio"]);

    unmount();
    await waitFor(() => expect(api.proctorApi).toHaveBeenCalledWith("end", { sessionId: SID }));
  });

  it("policy off: renders children straight away, no session", async () => {
    routeApi({ preflight: { policy: "off", orgName: "X", retentionDays: 90, contactEmail: null, strictMaxViolations: 3, snapshotIntervalS: 30 } });
    const onReady = vi.fn();
    render(<ProctoredSession attemptId={AID} policy="off" kind="assessment" onReady={onReady}><Child /></ProctoredSession>);
    expect(await screen.findByTestId("child")).toHaveTextContent("session none");
    expect(onReady).toHaveBeenCalledWith(null);
    expect(api.proctorApi).not.toHaveBeenCalledWith("start", expect.anything());
  });

  it("interviews: no audio consent item", async () => {
    routeApi();
    render(<ProctoredSession interviewId={AID} policy="maximum" kind="interview"><Child /></ProctoredSession>);
    fireEvent.click(await screen.findByRole("button", { name: /Allow camera/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
    expect(screen.queryByText(/speech detection/)).toBeNull();
  });

  it("preflight error shows a retry", async () => {
    routeApi({ preflight: new Error("This test or interview has already ended.") });
    render(<ProctoredSession attemptId={AID} policy="standard" kind="assessment"><Child /></ProctoredSession>);
    expect(await screen.findByRole("alert")).toHaveTextContent(/already ended/);
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});

describe("review page", () => {
  const timeline = () => ({
    session: { id: SID, policy: "strict", integrity_score: 79, integrity_band: "medium", provisional: false, status: "ended", violations: 1,
               context_type: "drive", subject_name: "Asha", system_check: null, started_at: "2026-10-21T10:00:00Z", ended_at: "2026-10-21T11:00:00Z",
               score_detail: { version: "integrity-v1", score: 79, band: "medium", total_deduction: 21, formula: "100 − Σ capped",
                               by_type: [{ type: "looking_away", label: "Looking away from the screen", count: 30, points: 40, cap: 15, capped: 15 }] } },
    events: [
      { id: 1, type: "tab_hidden", severity: "medium", confidence: 1, started_at: "2026-10-21T10:05:30Z", ended_at: null,
        evidenceUrl: "https://x.supabase.co/storage/v1/object/sign/b2b-evidence/a.jpg?token=t", review_status: "pending", review_note: null, meta: {} },
      { id: 2, type: "snapshot", severity: "info", confidence: 1, started_at: "2026-10-21T10:06:00Z", ended_at: null,
        evidenceUrl: "https://x.supabase.co/s.jpg", review_status: "pending", review_note: null, meta: { kind: "screen" } },
    ],
    reviews: [],
  });
  const renderReview = () => render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[`/proctor/review/${SID}`]}>
        <Routes><Route path="/proctor/review/:sessionId" element={<ReviewPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

  it("shows the AI score with its explanation, separate from the human decision, and a timeline with evidence", async () => {
    api.proctorApi.mockResolvedValue(timeline());
    renderReview();
    expect(await screen.findByTestId("ai-score")).toHaveTextContent("79");
    expect(screen.getByText("Medium integrity")).toBeInTheDocument();
    expect(screen.getByText("Looking away from the screen")).toBeInTheDocument();
    expect(screen.getByText(/No decision recorded yet/)).toBeInTheDocument();
    expect(screen.getAllByTestId("timeline-event")).toHaveLength(1); // periodic snapshots hidden by default
    const row = screen.getByTestId("timeline-event");
    expect(within(row).getByText("05:30")).toBeInTheDocument();
    expect(within(row).getByRole("img")).toHaveAttribute("src", expect.stringContaining("token=t"));
    fireEvent.click(screen.getByRole("switch"));
    expect(screen.getAllByTestId("timeline-event")).toHaveLength(2);
  });

  it("confirm / dismiss a flag with a note, and record the final decision", async () => {
    api.proctorApi.mockImplementation(async (action: string) => (action === "timeline" ? timeline() : { ok: true }));
    renderReview();
    const row = await screen.findByTestId("timeline-event");
    fireEvent.change(within(row).getByRole("textbox"), { target: { value: "Exam portal notification" } });
    fireEvent.click(within(row).getByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(api.proctorApi).toHaveBeenCalledWith("reviewEvent", { eventId: 1, status: "dismissed", note: "Exam portal notification" }));

    const save = screen.getByRole("button", { name: "Record decision" });
    expect(save).toBeDisabled();
    fireEvent.click(screen.getByRole("radio", { name: "Minor concern" }));
    fireEvent.change(screen.getByLabelText("Decision note"), { target: { value: "One tab switch, explained" } });
    await act(async () => { fireEvent.click(save); });
    await waitFor(() => expect(api.proctorApi).toHaveBeenCalledWith("decide", { sessionId: SID, decision: "minor_concern", note: "One tab switch, explained" }));
  });

  it("no access → not found", async () => {
    api.proctorApi.mockRejectedValue(new Error("Not found."));
    renderReview();
    expect(await screen.findByText("Session not found")).toBeInTheDocument();
  });
});
