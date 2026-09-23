import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const org = { id: "org-a", name: "SVR Engineering College", slug: "svr", type: "college", logo_url: null, is_demo: false };
const moduleRow = {
  id: "mod-sql", org_id: "org-a", name: "SQL", type: "skill", is_active: true, template_id: null, version: 1, created_at: "", updated_at: "",
  spec: { name: "SQL", type: "skill", topics: ["Joins", "Indexes"], pass_threshold: 6, max_turns: 3, max_minutes: 10 },
};

vi.mock("../hooks/useB2B", () => ({
  useMyMemberships: () => ({ data: [{ org_id: "org-a", role: "student", organizations: org }], isLoading: false }),
  useStudentModules: () => ({ data: [moduleRow], isLoading: false }),
  useMyQuota: () => ({ data: [{ org_id: "org-a", interviews_remaining: 5, interviews_limit: 6 }], isLoading: false }),
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "s1" }, signOut: vi.fn() }) }));

const voice = vi.hoisted(() => ({
  support: { stt: true, tts: true },
  hook: {
    phase: "idle", transcript: "", supported: true,
    speak: vi.fn(async () => {}), listen: vi.fn(), finishAnswer: vi.fn(), cancel: vi.fn(),
  },
}));
vi.mock("../hooks/useVoiceAnswer", async (orig) => ({
  ...(await orig<typeof import("../hooks/useVoiceAnswer")>()),
  useVoiceAnswer: () => voice.hook,
  voiceSupport: () => voice.support,
}));

const api = vi.hoisted(() => ({ current: vi.fn(), start: vi.fn(), resume: vi.fn(), answer: vi.fn(), end: vi.fn() }));
vi.mock("../lib/api", async (orig) => ({ ...(await orig<typeof import("../lib/api")>()), interviewApi: api }));

import InterviewRoom from "./InterviewRoom";
import { ApiError } from "../lib/api";

const iv = (over: Record<string, unknown> = {}) => ({
  id: "iv-1", module_id: "mod-sql", module_name: "SQL", status: "in_progress", end_reason: null,
  started_at: new Date().toISOString(), deadline_at: new Date(Date.now() + 600_000).toISOString(), server_now: new Date().toISOString(),
  turn_count: 0, max_turns: 3, topics_total: 2, topics_covered: 0, current_topic: "Joins", ...over,
});
const payload = (question: string | null, over: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) =>
  ({ interview: iv(over), question, closing: null, transcript: [], ...extra });

function renderRoom() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/learn/interview/mod-sql"]}>
        <Routes>
          <Route path="/learn/interview/:moduleId" element={<InterviewRoom />} />
          <Route path="/learn" element={<p>learn home</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  voice.support = { stt: true, tts: true };
  api.current.mockResolvedValue({ interview: null });
});

describe("InterviewRoom", () => {
  it("voice: speaks the question, listens, submits, and finishes", async () => {
    api.start.mockResolvedValue(payload("Explain an inner join."));
    voice.hook.listen
      .mockResolvedValueOnce({ text: "It returns matching rows", meta: { input_mode: "voice", ended_by: "silence" } })
      .mockResolvedValueOnce({ text: "Indexes speed up lookups", meta: { input_mode: "voice", ended_by: "button" } });
    api.answer
      .mockResolvedValueOnce(payload("What is an index?", { turn_count: 1, current_topic: "Indexes" }))
      .mockResolvedValueOnce(payload(null, { turn_count: 2, status: "completed", end_reason: "topics_covered", topics_covered: 2 }, { closing: "Thank you." }));

    renderRoom();
    expect(await screen.findByText("Uses 1 of your 5 remaining interviews.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Start interview/ }));

    await waitFor(() => expect(api.answer).toHaveBeenCalledTimes(2));
    expect(api.start).toHaveBeenCalledWith("mod-sql", expect.objectContaining({ input_mode: "voice", stt_lang: "en-IN" }));
    expect(voice.hook.speak).toHaveBeenNthCalledWith(1, "Explain an inner join.");
    expect(voice.hook.speak).toHaveBeenNthCalledWith(2, "What is an index?");
    expect(voice.hook.speak).toHaveBeenLastCalledWith("Thank you.");
    const [first, second] = api.answer.mock.calls.map((c) => c[0]);
    expect(first).toMatchObject({ interviewId: "iv-1", turnCount: 0, answer: "It returns matching rows" });
    expect(second).toMatchObject({ turnCount: 1, answer: "Indexes speed up lookups" });
    expect(first.clientTurnId).not.toBe(second.clientTurnId);
    expect(await screen.findByText("Interview complete")).toBeInTheDocument();
    expect(screen.getByText(/2 questions across 2 of 2 topics/)).toBeInTheDocument();
  });

  it("text mode (no speech support): typed answers are submitted", async () => {
    voice.support = { stt: false, tts: true };
    api.start.mockResolvedValue(payload("Explain an inner join."));
    api.answer.mockResolvedValue(payload("Next one?", { turn_count: 1 }));
    renderRoom();
    expect(await screen.findByText(/This browser can't do speech recognition/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Start interview/ }));
    const box = await screen.findByLabelText(/Your answer/);
    expect(voice.hook.speak).not.toHaveBeenCalled();
    fireEvent.change(box, { target: { value: "Rows that match in both tables" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit answer" }));
    await waitFor(() => expect(api.answer).toHaveBeenCalledWith(expect.objectContaining({
      answer: "Rows that match in both tables", meta: { input_mode: "text", ended_by: "typed" },
    })));
    expect(await screen.findByText("Next one?")).toBeInTheDocument();
  });

  it("connection drop: keeps the answer and retries with the same clientTurnId", async () => {
    voice.support = { stt: false, tts: true };
    api.start.mockResolvedValue(payload("Q1?"));
    api.answer
      .mockRejectedValueOnce(new ApiError(0, "NETWORK", "offline"))
      .mockResolvedValueOnce(payload("Q2?", { turn_count: 1 }));
    renderRoom();
    fireEvent.click(await screen.findByRole("button", { name: /Start interview/ }));
    fireEvent.change(await screen.findByLabelText(/Your answer/), { target: { value: "my answer" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit answer" }));
    expect(await screen.findByText(/Connection lost/)).toBeInTheDocument();
    expect(JSON.parse(sessionStorage.getItem("hiresume_b2b_pending_iv-1")!)).toMatchObject({ answer: "my answer", turnCount: 0 });
    fireEvent.click(screen.getByRole("button", { name: /Try again/ }));
    expect(await screen.findByText("Q2?")).toBeInTheDocument();
    expect(api.answer.mock.calls[1][0].clientTurnId).toBe(api.answer.mock.calls[0][0].clientTurnId);
    expect(sessionStorage.getItem("hiresume_b2b_pending_iv-1")).toBeNull();
  });

  it("after a reload, offers resume and re-sends an answer that was in flight", async () => {
    voice.support = { stt: false, tts: true };
    api.current.mockResolvedValue(payload("Q2?", { turn_count: 1 }));
    api.resume.mockResolvedValue(payload("Q2?", { turn_count: 1 }));
    sessionStorage.setItem("hiresume_b2b_pending_iv-1", JSON.stringify({ clientTurnId: "ct-1", turnCount: 1, answer: "saved answer", meta: {} }));
    api.answer.mockResolvedValue(payload("Q3?", { turn_count: 2 }));
    renderRoom();
    fireEvent.click(await screen.findByRole("button", { name: /Resume interview \(question 2 of 3\)/ }));
    await waitFor(() => expect(api.answer).toHaveBeenCalledWith(expect.objectContaining({ clientTurnId: "ct-1", answer: "saved answer", turnCount: 1 })));
    expect(await screen.findByText("Q3?")).toBeInTheDocument();
  });

  it("resyncs on a turn conflict (e.g. answered in another tab)", async () => {
    voice.support = { stt: false, tts: true };
    api.start.mockResolvedValue(payload("Q1?"));
    const conflict = new ApiError(409, "TURN_CONFLICT", "Out of sync");
    conflict.data = payload("Q2 from other tab?", { turn_count: 1 });
    api.answer.mockRejectedValueOnce(conflict);
    renderRoom();
    fireEvent.click(await screen.findByRole("button", { name: /Start interview/ }));
    fireEvent.change(await screen.findByLabelText(/Your answer/), { target: { value: "x y" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit answer" }));
    expect(await screen.findByText("Q2 from other tab?")).toBeInTheDocument();
  });

  it("blocks starting while a different module's interview is live", async () => {
    api.current.mockResolvedValue(payload("Q?", { module_id: "mod-java", module_name: "Java" }));
    renderRoom();
    expect(await screen.findByText("You have another interview in progress")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to that interview" }).getAttribute("href")).toBe("/learn/interview/mod-java");
  });

  it("shows a clear message when starting fails and keeps the student on the pre-flight screen", async () => {
    api.start.mockRejectedValue(new ApiError(503, "AI_BUSY", "The interviewer is busy right now. Your interview credit was not used — please try again in a minute."));
    renderRoom();
    fireEvent.click(await screen.findByRole("button", { name: /Start interview/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/credit was not used/);
    expect(screen.getByRole("button", { name: /Start interview/ })).toBeInTheDocument();
  });

  it("falls back to typing when the microphone is blocked", async () => {
    const { MicError } = await import("../hooks/useVoiceAnswer");
    api.start.mockResolvedValue(payload("Q1?"));
    voice.hook.listen.mockRejectedValueOnce(new MicError("blocked", "Microphone access is blocked."));
    renderRoom();
    fireEvent.click(await screen.findByRole("button", { name: /Start interview/ }));
    expect(await screen.findByText("Microphone access is blocked.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Type instead/ }));
    expect(await screen.findByLabelText(/Your answer/)).toBeInTheDocument();
  });
});
