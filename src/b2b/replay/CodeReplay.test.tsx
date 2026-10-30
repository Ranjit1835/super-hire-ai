import { describe, it, expect, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { CodeReplay } from "./CodeReplay";
import type { ReplayData, ReplayEvent } from "./replay";

vi.mock("@/features/b2b/lib/db", () => ({ b2bDb: { rpc: vi.fn() } }));

const sol = "def solve(nums, target):\n    seen = {}\n    for i, n in enumerate(nums):\n        if target - n in seen:\n            return [seen[target - n], i]\n";
const typed = (s: string, t0: number): ReplayEvent[] => [...s].map((c, i) => ({ t: t0 + i * 400, op: "ins", at: i, text: c }));

const data: ReplayData = {
  attempt_id: "a1", status: "submitted", started_at: null, submitted_at: null,
  questions: [
    { question_id: "q1", title: "Hello", languages: ["python"], starter_code: { python: "" }, final_language: "python",
      final_code: "print(1)", events: typed("print(1)", 1_000), truncated: false },
    { question_id: "q2", title: "Two sum", languages: ["python"], starter_code: { python: "" }, final_language: "python",
      final_code: "# hi\n" + sol, events: [...typed("# hi\n", 0), { t: 120_000, op: "ins", at: 5, text: sol }], truncated: false },
  ],
};

describe("code replay viewer (R2.7)", () => {
  it("opens at the final code, scrubs back through the edits", () => {
    render(<CodeReplay data={data} />);
    const code = screen.getByLabelText("Code at this point");
    expect(code.textContent).toContain("print(1)");
    expect(screen.getByText("Nothing unusual in how this was written.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Replay position"), { target: { value: "5" } });
    expect(screen.getByLabelText("Code at this point").textContent).toContain("print");
    expect(screen.getByLabelText("Code at this point").textContent).not.toContain("print(");
    expect(screen.getByText(/edit 5 of 8/)).toBeInTheDocument();
  });

  it("shows the flag on the question where code appeared at once and jumps to it", () => {
    render(<CodeReplay data={data} />);
    fireEvent.click(screen.getByRole("tab", { name: /Two sum/ }));
    expect(screen.getByText("Code appeared at once")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Watch from here" }));
    expect(screen.getByText(/edit 5 of 6/)).toBeInTheDocument();
    expect(screen.getByLabelText("Code at this point").textContent).not.toContain("def solve");
  });

  it("plays forward to the end", () => {
    vi.useFakeTimers();
    try {
      render(<CodeReplay data={data} />);
      fireEvent.change(screen.getByLabelText("Replay position"), { target: { value: "0" } });
      fireEvent.click(screen.getByRole("button", { name: "Play" }));
      act(() => { vi.advanceTimersByTime(5_000); });
      expect(screen.getByText(/edit 8 of 8/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Replay from start" })).toBeInTheDocument();
    } finally { vi.useRealTimers(); }
  });

  it("is honest when the replay doesn't reach the saved answer", () => {
    render(<CodeReplay data={{ ...data, questions: [{ ...data.questions[0], final_code: "print(2)" }] }} />);
    expect(screen.getByRole("note").textContent).toMatch(/doesn't end exactly at the saved answer/);
  });
});
