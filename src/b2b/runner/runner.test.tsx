import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ChangeEvent } from "react";
import { AutosaveQueue, type SaveItem } from "./autosave";
import { formatRemaining, remainingMs, useCountdown } from "./clock";
import { attachPasteGuard, createTypingMonitor, LARGE_INSERT_CHARS } from "./pasteGuard";
import type { AttemptState } from "../../../supabase/functions/_shared/contracts/assess";

const api = vi.hoisted(() => ({ assessApi: vi.fn() }));
const proctor = vi.hoisted(() => ({ report: vi.fn(), paused: false }));
vi.mock("../lib/api", async (orig) => ({ ...(await orig<typeof import("../lib/api")>()), assessApi: api.assessApi }));
vi.mock("../proctor", () => ({
  useProctor: () => ({ report: proctor.report, sessionId: null, paused: proctor.paused }),
  ProctoredSession: ({ children }: { children: unknown }) => children,
}));
// Monaco doesn't run in jsdom: a textarea stand-in with the same props.
vi.mock("./CodeEditor", () => ({
  default: ({ value, onChange, onSignal }: { value: string; onChange: (c: string, e: unknown[]) => void; onSignal: (t: string, m: Record<string, unknown>) => void }) => (
    <div>
      <textarea aria-label="Code" defaultValue={value}
        onChange={(e: ChangeEvent<HTMLTextAreaElement>) => onChange(e.target.value, [{ t: 1, op: "ins", at: 0, text: e.target.value }])} />
      <button type="button" onClick={() => onSignal("paste_attempt", { length: 40 })}>fake paste</button>
    </div>
  ),
}));

import { Runner, SaveIndicator, initialAnswers } from "./Runner";
import StartPage from "./StartPage";
import { ApiError } from "../lib/api";

const ATT = "11111111-1111-4111-8111-111111111111";
const SESS = "22222222-2222-4222-8222-222222222222";
const QC = "33333333-3333-4333-8333-333333333333";
const QM = "44444444-4444-4444-8444-444444444444";

describe("autosave queue", () => {
  const item = (seq: number, code = `v${seq}`, edits?: SaveItem["edits"]): SaveItem => ({ questionId: "q1", seq, code, edits });

  it("coalesces per question, never lets an older save replace a newer one, and merges edit batches", async () => {
    const sent: SaveItem[] = [];
    const q = new AutosaveQueue({ send: async (i) => { sent.push(i); } });
    q.put(item(2, "two", [{ t: 1, op: "ins" }]));
    q.put(item(1, "one"));
    q.put(item(3, "three", [{ t: 2, op: "ins" }]));
    await q.flush();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ seq: 3, code: "three" });
    expect(sent[0].edits).toHaveLength(2);
    expect(q.current).toBe("saved");
  });

  it("drops a save for a question already left (LOCKED) and carries on with the rest", async () => {
    const sent: string[] = [];
    const onFatal = vi.fn();
    const q = new AutosaveQueue({ onFatal, send: async (i) => { if (i.questionId === "old") throw new ApiError(409, "LOCKED", "closed"); sent.push(i.questionId); } });
    q.put({ questionId: "old", seq: 1, mcq_choice: ["a"] });
    q.put({ questionId: "now", seq: 1, mcq_choice: ["b"] });
    await q.flush();
    expect(sent).toEqual(["now"]);
    expect(q.size).toBe(0);
    expect(onFatal).not.toHaveBeenCalled();
  });

  it("keeps saves while offline and retries with backoff", async () => {
    const timers: { fn: () => void; ms: number }[] = [];
    let fail = 2;
    const statuses: string[] = [];
    const send = vi.fn(async () => { if (fail-- > 0) throw new ApiError(0, "NETWORK", "offline"); });
    const q = new AutosaveQueue({ send, onStatus: (s) => statuses.push(s), setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; } });
    q.put(item(1));
    await q.flush();
    expect(q.size).toBe(1);
    expect(statuses.at(-1)).toBe("offline");
    expect(timers.map((t) => t.ms)).toEqual([1000]);
    timers[0].fn(); await q.flush();
    expect(timers.map((t) => t.ms)).toEqual([1000, 2000]);
    timers[1].fn(); await q.flush();
    expect(q.size).toBe(0);
    expect(send).toHaveBeenCalledTimes(3);
    expect(statuses.at(-1)).toBe("saved");
  });

  it("stops and reports a refusal (test ended / another tab)", async () => {
    const onFatal = vi.fn();
    const q = new AutosaveQueue({ send: async () => { throw new ApiError(409, "OTHER_SESSION", "x"); }, onFatal });
    q.put(item(1));
    await q.flush();
    expect(onFatal).toHaveBeenCalledWith("OTHER_SESSION");
    q.put(item(2));
    expect(q.size).toBe(0);
  });

  it("survives a refresh through storage", async () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); } };
    const q1 = new AutosaveQueue({ send: async () => { throw new ApiError(0, "NETWORK", "x"); }, storage, storageKey: "k", setTimer: () => 0 });
    q1.put(item(4, "unsent"));
    await q1.flush();
    const sent: SaveItem[] = [];
    const q2 = new AutosaveQueue({ send: async (i) => { sent.push(i); }, storage, storageKey: "k" });
    expect(q2.size).toBe(1);
    await q2.flush();
    expect(sent[0]).toMatchObject({ seq: 4, code: "unsent" });
    expect(store.has("k")).toBe(false);
  });

  it("unsent local answers win over the server copy on restore", () => {
    const qs = [{ id: QC, type: "coding" as const, title: "t", statement: "s", difficulty: "easy" as const, points: 1, languages: ["python" as const, "java" as const],
                  starter_code: { python: "#", java: "//" }, saved: { language: "python", code: "server", mcq_choice: null, seq: 3 } }];
    expect(initialAnswers(qs, []).answers[QC].codeByLang.python).toBe("server");
    const r = initialAnswers(qs, [{ questionId: QC, seq: 5, language: "java", code: "local" }]);
    expect(r.answers[QC]).toMatchObject({ language: "java", codeByLang: { java: "local", python: "server" } });
    expect(r.seqs[QC]).toBe(5);
    expect(initialAnswers(qs, [{ questionId: QC, seq: 2, code: "stale" }]).answers[QC].codeByLang.python).toBe("server");
  });
});

describe("server clock", () => {
  it("uses the server's clock, not the device's", () => {
    // Device clock is 10 minutes fast: the server said 09:00:00 when the device read 09:10:00.
    const received = Date.parse("2026-10-21T09:10:00Z");
    const t = { deadlineAt: "2026-10-21T09:30:00Z", serverNow: "2026-10-21T09:00:00Z", receivedAt: received };
    expect(remainingMs(t, received)).toBe(30 * 60_000);
    expect(remainingMs(t, received + 60_000)).toBe(29 * 60_000);
    expect(remainingMs(t, received + 3_600_000)).toBe(0);
    expect(remainingMs({ ...t, deadlineAt: null }, received)).toBeNull();
    expect(formatRemaining(29 * 60_000 + 5_000)).toBe("29:05");
    expect(formatRemaining(3_725_000)).toBe("1:02:05");
  });

  it("fires onExpire once at zero, but not while paused", () => {
    vi.useFakeTimers();
    try {
      let now = 0;
      const onExpire = vi.fn();
      const t = { deadlineAt: new Date(3000).toISOString(), serverNow: new Date(0).toISOString(), receivedAt: 0 };
      const { result, rerender } = renderHook(({ paused }) => useCountdown(t, { paused, onExpire, now: () => now }), { initialProps: { paused: true } });
      expect(result.current).toBe(3000);
      now = 5000; act(() => { vi.advanceTimersByTime(1000); });
      expect(result.current).toBe(0);
      expect(onExpire).not.toHaveBeenCalled();
      rerender({ paused: false });
      act(() => { vi.advanceTimersByTime(3000); });
      expect(onExpire).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });
});

describe("paste guard", () => {
  function setup(selection = "") {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const onBlocked = vi.fn();
    const onAllowed = vi.fn();
    const detach = attachPasteGuard(el, { getSelectionText: () => selection, onBlocked, onAllowed });
    const paste = (text: string) => {
      const ev = new Event("paste", { bubbles: true, cancelable: true }) as ClipboardEvent;
      Object.defineProperty(ev, "clipboardData", { value: { getData: () => text } });
      el.dispatchEvent(ev);
      return ev.defaultPrevented;
    };
    return { el, onBlocked, onAllowed, paste, detach };
  }

  it("blocks pastes from outside the test and reports them", () => {
    const g = setup();
    expect(g.paste("copied from the web")).toBe(true);
    expect(g.onBlocked).toHaveBeenCalledWith({ length: 19 });
  });

  it("allows pasting what was copied inside the editor", () => {
    const g = setup("my own line");
    fireEvent.copy(g.el);
    expect(g.paste("my own line")).toBe(false);
    expect(g.onAllowed).toHaveBeenCalled();
    expect(g.paste("something else")).toBe(true);
    g.detach();
    expect(g.paste("after detach")).toBe(false);
  });

  it("blocks dropping text in", () => {
    const g = setup();
    fireEvent.drop(g.el, { dataTransfer: { getData: () => "abc" } });
    expect(g.onBlocked).toHaveBeenCalledWith({ length: 3 });
  });

  it("reports large insertions and typing bursts (not allowed internal pastes)", () => {
    const report = vi.fn();
    let t = 0;
    const m = createTypingMonitor(report, () => t);
    m.allowNextInsert();
    m.onInsert(LARGE_INSERT_CHARS + 50);
    expect(report).not.toHaveBeenCalled();
    m.onInsert(LARGE_INSERT_CHARS);
    expect(report).toHaveBeenCalledWith("large_paste", { chars: LARGE_INSERT_CHARS });
    report.mockClear();
    for (let i = 0; i < 300; i++) { t += 20; m.onInsert(1); }   // 300 chars in 6 s
    expect(report).toHaveBeenCalledTimes(1);
    expect(report.mock.calls[0][0]).toBe("typing_burst");
  });
});

function state(over: Partial<AttemptState> = {}): AttemptState {
  const now = new Date();
  return {
    attemptId: ATT, status: "in_progress", sessionId: SESS, paused: false, title: "Placement test", watermark: "a01@college.in",
    server_now: now.toISOString(), deadline_at: new Date(now.getTime() + 30 * 60_000).toISOString(),
    proctoring: { policy: "standard", sessionId: null }, result: null,
    questions: [
      { id: QM, type: "mcq", title: "Train speed", statement: "A train covers 120 km in 2 hours.", difficulty: "easy", points: 1, section: "Aptitude",
        options: [{ id: "b", text: "40 km/h" }, { id: "a", text: "60 km/h" }], multi_select: false, saved: null },
      { id: QC, type: "coding", title: "Sum two", statement: "Print the sum.", difficulty: "easy", points: 10, section: "Coding",
        languages: ["python", "java"], starter_code: { python: "# start", java: "// start" }, samples: [{ input: "1 2", output: "3" }], saved: null },
    ],
    ...over,
  };
}

describe("runner", () => {
  beforeEach(() => {
    localStorage.clear();
    api.assessApi.mockReset();
    proctor.report.mockReset();
    proctor.paused = false;
    api.assessApi.mockImplementation(async (action: string) => {
      if (action === "autosave") return { ok: true, seq: 1, deadline_at: new Date(Date.now() + 60_000).toISOString(), server_now: new Date().toISOString() };
      if (action === "heartbeat") return { ok: true, status: "in_progress", deadline_at: new Date(Date.now() + 60_000).toISOString(), server_now: new Date().toISOString(), paused: false };
      if (action === "finish") return { ok: true };
      if (action === "run") return { submissionId: SESS, status: "done", compile_output: null, passed: 1, total: 1, tests: [{ sample: true, passed: true, time_ms: 4, status: "passed", stdout: "3", expected: "3" }] };
      if (action === "submitQuestion") return { submissionId: SESS, status: "queued" };
      throw new Error(`unexpected ${action}`);
    });
  });
  afterEach(() => { vi.useRealTimers(); });

  const renderRunner = (st = state(), props: Partial<Parameters<typeof Runner>[0]> = {}) => {
    const onEnded = vi.fn();
    const onConflict = vi.fn();
    render(<Runner state={st} onEnded={onEnded} onConflict={onConflict} autosaveMs={40} heartbeatMs={60_000} {...props} />);
    return { onEnded, onConflict };
  };

  it("one question at a time: no question list, confirm before moving on, the next question replaces it (R2.4)", async () => {
    const all = state().questions;
    const linear = (i: number) => state({ questions: [all[i]], navigation: { mode: "linear", index: i, total: 2 } });
    api.assessApi.mockImplementation(async (action: string, input: { fromIndex?: number }) => {
      if (action === "autosave") return { ok: true, seq: 1, deadline_at: new Date(Date.now() + 60_000).toISOString(), server_now: new Date().toISOString() };
      if (action === "advance") return linear((input.fromIndex ?? 0) + 1);
      throw new Error(`unexpected ${action}`);
    });
    renderRunner(linear(0));
    expect(screen.queryByRole("navigation", { name: "Questions" })).toBeNull();
    expect(screen.getByText(/Question 1 of 2 · one at a time/)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("radio")[1]);
    fireEvent.click(screen.getByRole("button", { name: "Next question" }));
    expect(await screen.findByText(/You can't come back to this question/)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Next question" }).at(-1)!);
    expect(await screen.findByRole("heading", { name: /2\. Sum two/ })).toBeInTheDocument();
    // the answer was saved before moving on, and the move names the question being left
    const calls = api.assessApi.mock.calls.map(([a]) => a);
    expect(calls.indexOf("autosave")).toBeLessThan(calls.indexOf("advance"));
    expect(api.assessApi).toHaveBeenCalledWith("advance", { attemptId: ATT, sessionId: SESS, fromIndex: 0 });
    expect(screen.getByText(/Question 2 of 2/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Next question" })).toBeNull();          // last question
    expect(await screen.findByLabelText("Code")).toHaveValue("# start");
  });

  it("shows the question, options in the shuffled order, timer and watermark", () => {
    renderRunner();
    expect(screen.getByRole("heading", { name: /Train speed/ })).toBeInTheDocument();
    expect(screen.getAllByRole("radio").map((r) => r.parentElement?.textContent)).toEqual(["40 km/h", "60 km/h"]);
    expect(screen.getByRole("timer").textContent).toMatch(/^(29:5\d|30:00)$/);
    expect(screen.getByTestId("watermark").textContent).toContain("a01@college.in");
  });

  it("autosaves an MCQ choice within a few seconds", async () => {
    renderRunner();
    fireEvent.click(screen.getAllByRole("radio")[1]);
    await waitFor(() => expect(api.assessApi).toHaveBeenCalledWith("autosave", expect.objectContaining({ questionId: QM, seq: 1, mcq_choice: ["a"], sessionId: SESS })));
    await waitFor(() => expect(screen.getByRole("status", { name: "Connection" }).textContent).toContain("All answers saved"));
  });

  it("autosaves code with edit events, runs samples, and blocks outside paste", async () => {
    renderRunner();
    fireEvent.click(screen.getByRole("button", { name: /Question 2/ }));
    const code = await screen.findByLabelText("Code");
    expect((code as HTMLTextAreaElement).value).toBe("# start");
    fireEvent.change(code, { target: { value: "print(3)" } });
    await waitFor(() => expect(api.assessApi).toHaveBeenCalledWith("autosave", expect.objectContaining({
      questionId: QC, language: "python", code: "print(3)", edits: [expect.objectContaining({ op: "ins" })] })));

    fireEvent.click(screen.getByRole("button", { name: /Run samples/ }));
    expect(await screen.findByText("1 of 1 sample tests passed")).toBeInTheDocument();
    expect(api.assessApi).toHaveBeenCalledWith("run", expect.objectContaining({ code: "print(3)", customInput: undefined }), expect.anything());

    fireEvent.click(screen.getByRole("button", { name: "fake paste" }));
    expect(proctor.report).toHaveBeenCalledWith(expect.objectContaining({ type: "paste_attempt", severity: "medium" }));
    expect(screen.getByText(/Pasting from outside the test is turned off/)).toBeInTheDocument();
  });

  it("switching language loads that language's starter code", async () => {
    renderRunner();
    fireEvent.click(screen.getByRole("button", { name: /Question 2/ }));
    await screen.findByLabelText("Code");
    fireEvent.change(screen.getByLabelText("Language"), { target: { value: "java" } });
    expect(((await screen.findByLabelText("Code")) as HTMLTextAreaElement).value).toBe("// start");
  });

  it("finishes after confirmation", async () => {
    const { onEnded } = renderRunner();
    fireEvent.click(screen.getByRole("button", { name: "Finish test" }));
    expect(screen.getByText(/answered 0 of 2/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    await waitFor(() => expect(onEnded).toHaveBeenCalled());
    expect(api.assessApi).toHaveBeenCalledWith("finish", { attemptId: ATT, sessionId: SESS, reason: "submitted" });
  });

  it("auto-submits when the server deadline has passed", async () => {
    const now = new Date();
    const { onEnded } = renderRunner(state({ server_now: now.toISOString(), deadline_at: now.toISOString() }));
    await waitFor(() => expect(api.assessApi).toHaveBeenCalledWith("finish", expect.objectContaining({ reason: "submitted" })));
    await waitFor(() => expect(onEnded).toHaveBeenCalled());
  });

  it("hands over to the conflict screen when another tab takes the session", async () => {
    api.assessApi.mockImplementation(async (action: string) => {
      if (action === "heartbeat") return { ok: false, reason: "OTHER_SESSION", status: "in_progress", deadline_at: null, server_now: new Date().toISOString(), paused: false };
      return { ok: true };
    });
    const { onConflict } = renderRunner(state(), { heartbeatMs: 30 });
    await waitFor(() => expect(onConflict).toHaveBeenCalled());
  });

  it("hides the test while paused", () => {
    proctor.paused = true;
    renderRunner();
    expect(screen.getByRole("alertdialog", { name: "Test paused" })).toBeInTheDocument();
  });
});

describe("start page", () => {
  beforeEach(() => { api.assessApi.mockReset(); sessionStorage.clear(); });

  const at = (url: string) => render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/assess/start" element={<StartPage />} />
        <Route path="/assess/a/:attemptId" element={<p>runner</p>} />
      </Routes>
    </MemoryRouter>,
  );

  it("starts a practice attempt, remembers the tab session, and opens the runner", async () => {
    api.assessApi.mockResolvedValue(state());
    at(`/assess/start?context=practice&id=${QM}`);
    expect(await screen.findByText("runner")).toBeInTheDocument();
    expect(api.assessApi).toHaveBeenCalledWith("start", { context: "practice", contextId: null, assessmentId: QM, sessionId: undefined });
    expect(sessionStorage.getItem(`hr-assess-session-${ATT}`)).toBe(SESS);
  });

  it("explains refusals in plain English", async () => {
    api.assessApi.mockRejectedValue(new ApiError(403, "WINDOW_CLOSED", "The time window for this test has closed."));
    at(`/assess/start?context=drive&id=${QM}`);
    expect(await screen.findByText("The time window for this test has closed.")).toBeInTheDocument();
    expect(api.assessApi).toHaveBeenCalledWith("start", { context: "drive", contextId: QM, sessionId: undefined });
  });

  it("rejects incomplete links", () => {
    at("/assess/start?context=drive");
    expect(screen.getByText(/isn't complete/)).toBeInTheDocument();
  });
});

describe("save indicator", () => {
  it("says how long ago answers were saved, in minutes past a minute, outside the live region's announcement", () => {
    const { rerender } = render(<SaveIndicator status="saved" online savedAt={1_000} now={1_500} />);
    expect(screen.getByRole("status")).toHaveTextContent("All answers saved · just now");
    rerender(<SaveIndicator status="saved" online savedAt={1_000} now={46_000} />);
    expect(screen.getByRole("status")).toHaveTextContent("45s ago");
    rerender(<SaveIndicator status="saved" online savedAt={1_000} now={1_000 + 5 * 60_000} />);
    expect(screen.getByRole("status")).toHaveTextContent("5 min ago");
    expect(screen.getByText(/5 min ago/)).toHaveAttribute("aria-hidden", "true");
  });

  it("offline wins over saved", () => {
    render(<SaveIndicator status="saved" online={false} savedAt={1_000} now={2_000} />);
    expect(screen.getByRole("status")).toHaveTextContent("Offline, answers kept on this device");
  });
});
