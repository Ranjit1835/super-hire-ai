import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Similarity, matchedLines, type SimilarityOverview, type SimilarityPair } from "./SimilarityPage";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/features/b2b/lib/db", () => ({ b2bDb: { rpc } }));
vi.mock("./queries", async (orig) => ({
  ...(await orig<typeof import("./queries")>()),
  useDrive: () => ({ isLoading: false, data: { id: "d1", name: "CSE 2027 drive" } }),
}));
const toast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));

const asha = { student_id: "s1", name: "Asha", roll_no: "R1" };
const ravi = { student_id: "s2", name: "Ravi", roll_no: "R2" };
const overview: SimilarityOverview = {
  runs: [{ id: "r1", question: "Two sum", language: "python", status: "done", submissions: 40, created_at: "2026-10-29T10:00:00Z", finished_at: "2026-10-29T10:05:00Z" }],
  pairs: [{ id: 7, question: "Two sum", language: "python", similarity: 0.92, longest: 31, a: asha, b: ravi }],
  mcq: [{ shared_wrong: 4, wrong_a: 5, wrong_b: 6, a: asha, b: ravi }],
};
const pair: SimilarityPair = {
  id: 7, similarity: 0.92, longest: 31, language: "python", question: "Two sum",
  fragments: [{ a: [1, 0, 2, 10], b: [2, 0, 3, 10] }],
  a: { name: "Asha", roll_no: "R1", code: "def solve():\n  seen = {}\n  return seen\n" },
  b: { name: "Ravi", roll_no: "R2", code: "# mine\ndef solve():\n  lookup = {}\n  return lookup\n" },
};

function renderPage(isAdmin = true) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter><Similarity orgId="o1" driveId="d1" isAdmin={isAdmin} /></MemoryRouter></QueryClientProvider>);
}

beforeEach(() => {
  rpc.mockReset();
  toast.mockReset();
  rpc.mockImplementation(async (fn: string) => {
    if (fn === "b2b_drive_similarity") return { data: overview, error: null };
    if (fn === "b2b_similarity_pair") return { data: pair, error: null };
    if (fn === "b2b_request_similarity") return { data: 2, error: null };
    return { data: null, error: null };
  });
});

describe("similarity page (R2.8)", () => {
  it("lists checks, coding pairs and MCQ patterns", async () => {
    renderPage();
    expect(await screen.findByText("92%")).toBeInTheDocument();
    expect(screen.getByText("Done")).toBeInTheDocument();
    expect(screen.getByText("4 identical wrong answers")).toBeInTheDocument();
    expect(screen.getByText(/look\s+at the matched code before deciding anything/)).toBeInTheDocument();
  });

  it("compares a pair side by side with the matched lines highlighted", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Compare Asha and Ravi" }));
    const a = await screen.findByLabelText("Asha's answer");
    const b = screen.getByLabelText("Ravi's answer");
    expect(a.querySelectorAll("[data-matched]")).toHaveLength(2);
    expect(within(b).getByText("lookup = {}").closest("[data-matched]")).not.toBeNull();
    expect(within(b).getByText("# mine").closest("[data-matched]")).toBeNull();
    expect(rpc).toHaveBeenCalledWith("b2b_similarity_pair", { _pair_id: 7 });
  });

  it("TPOs can start a check now; viewers can't", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Check now" }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "2 checks queued" })));
    expect(rpc).toHaveBeenCalledWith("b2b_request_similarity", { _drive_id: "d1" });
  });

  it("hides the button from read-only staff", async () => {
    renderPage(false);
    await screen.findByText("92%");
    expect(screen.queryByRole("button", { name: "Check now" })).toBeNull();
  });

  it("matchedLines covers each region's rows", () => {
    expect([...matchedLines([{ a: [1, 0, 3, 4], b: [0, 0, 0, 2] }, { a: [5, 0, 5, 1], b: [2, 0, 2, 2] }], "a")]).toEqual([1, 2, 3, 5]);
  });
});
