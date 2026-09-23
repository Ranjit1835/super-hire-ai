import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, fireEvent } from "@testing-library/react";
import { DIMENSIONS, type EvaluationResult } from "../lib/shared";
import type { AudioMetrics } from "../lib/shared";

const api = vi.hoisted(() => ({ evaluate: vi.fn(), get: vi.fn() }));
vi.mock("../lib/api", async (orig) => ({ ...(await orig<typeof import("../lib/api")>()), evaluateApi: api }));

import { EvaluationReport } from "./EvaluationReport";
import { ReportPanel } from "./ReportPanel";

const result: EvaluationResult = {
  dimensions: Object.fromEntries(DIMENSIONS.map((d) => [d, { score: 7, evidence: ["returns only matching rows"], reason: `${d} reason` }])) as EvaluationResult["dimensions"],
  per_topic: {
    Joins: { score: 8, evidence: ["an inner join returns only matching rows"], reason: "Clear on joins." },
    Transactions: { score: "insufficient_data", evidence: [], reason: "Not assessed in this interview." },
  },
  primary_gap: "Transactions and ACID are unclear.",
  readiness_level: "developing",
  recommended_focus: ["Practise explaining ACID with a bank example"],
  overall_score: 6.8,
  passed: true,
  model_readiness_level: "ready",
  dropped_evidence: 0,
};
result.dimensions.resume_project_knowledge = { score: "insufficient_data", evidence: [], reason: "No project discussed." };

const metrics: AudioMetrics = {
  voice_answers: 6, text_answers: 0, words_total: 420, words_per_minute: 128,
  filler_counts: { um: 0, uh: 0, like: 3, basically: 5, actually: 2, "you know": 0 }, fillers_total: 10, fillers_per_100_words: 2.4,
  filler_reliability: "low", avg_pause_before_answer_ms: 3200, max_pause_before_answer_ms: 9100, max_pause_within_answer_ms: 4100,
  avg_answer_words: 70, avg_answer_words_by_difficulty: { beginner: 55, intermediate: 80, advanced: null },
  notes: ["Speech recognition usually drops 'um' and 'uh', so filler counts are a lower bound."],
};

describe("EvaluationReport", () => {
  it("shows readiness, gap, focus, every dimension with evidence, topics and speaking metrics", () => {
    render(<EvaluationReport result={result} metrics={metrics} passMark={6} moduleName="SQL" />);
    expect(screen.getByText("Developing")).toBeInTheDocument();
    expect(screen.getByText("6.8")).toBeInTheDocument();
    expect(screen.getByText(/Transactions and ACID are unclear/)).toBeInTheDocument();
    expect(screen.getByText("Practise explaining ACID with a bank example")).toBeInTheDocument();
    for (const label of ["Technical knowledge", "Communication", "English language", "Projects & resume"]) expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getAllByText("Not enough to judge")).toHaveLength(2); // projects + transactions
    fireEvent.click(screen.getByText("Joins"));
    expect(screen.getByText(/an inner join returns only matching rows/)).toBeInTheDocument();
    expect(screen.getByText("128 words/min")).toBeInTheDocument();
    expect(screen.getByText(/avg 3.2 s · longest 9.1 s/)).toBeInTheDocument();
    expect(screen.getByText(/like ×3, basically ×5, actually ×2/)).toBeInTheDocument();
    expect(screen.getByText(/lower bound/)).toBeInTheDocument();
  });
});

describe("ReportPanel", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); });
  afterEach(() => vi.useRealTimers());

  const row = { id: "e1", interview_id: "iv1", evaluator_version: "v", status: "completed", result, audio_metrics: metrics, overall_score: 6.8, readiness_level: "developing", primary_gap: "", completed_at: "" };

  it("shows the report immediately when evaluation completes in the request", async () => {
    api.evaluate.mockResolvedValue({ status: "completed", evaluation: row });
    render(<ReportPanel interviewId="iv1" passMark={6} />);
    expect(screen.getByText("Scoring your answers…")).toBeInTheDocument();
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText("Developing")).toBeInTheDocument();
  });

  it("polls while the evaluation is pending (e.g. already running in the background)", async () => {
    api.evaluate.mockResolvedValue({ status: "pending", evaluation: null });
    api.get.mockResolvedValueOnce({ status: "pending", evaluation: null }).mockResolvedValueOnce({ status: "completed", evaluation: row });
    render(<ReportPanel interviewId="iv1" passMark={6} />);
    await act(async () => { await Promise.resolve(); });
    await act(async () => { vi.advanceTimersByTime(4000); await Promise.resolve(); });
    expect(screen.getByText("Scoring your answers…")).toBeInTheDocument();
    await act(async () => { vi.advanceTimersByTime(4000); await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByText("Developing")).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledTimes(2);
  });

  it("keeps polling if the evaluate request itself times out, and explains failures", async () => {
    api.evaluate.mockRejectedValue(new Error("timeout"));
    api.get.mockResolvedValue({ status: "failed", evaluation: null });
    render(<ReportPanel interviewId="iv1" passMark={6} />);
    await act(async () => { await Promise.resolve(); });
    await act(async () => { vi.advanceTimersByTime(4000); await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByText(/couldn't score this interview right now/)).toBeInTheDocument();
  });
});
