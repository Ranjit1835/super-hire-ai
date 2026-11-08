import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { takeRememberedRedirect } from "@/lib/safe-redirect";

const auth = vi.hoisted(() => ({ signInWithGoogle: vi.fn(async () => {}) }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, signInWithGoogle: auth.signInWithGoogle }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: { getSession: vi.fn() } } }));

import GuestAnalysis from "./GuestAnalysis";

const result = {
  atsScore: 71, recruiterScanScore: 60, keywordStrengthScore: 55, quantificationScore: 40, structureScore: 80,
  interviewProbability: 35, marketCompetitivenessLevel: "Competitive", performanceLevelTag: "Competitive but Optimizable",
  contextStatement: "", resumeType: "STUDENT", criticalIssuesCount: 3, warningsCount: 2, optimizationsCount: 1,
  topIssue: { issue: "No measurable results in your projects", whyItMatters: "Recruiters skip bullets without outcomes." },
  missingKeywords: ["REST APIs", "Docker", "CI/CD"], missingKeywordsCount: 7,
};

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={["/analysis/guest/tok-1"]}>
      <Routes>
        <Route path="/analysis/guest/:token" element={<GuestAnalysis />} />
        <Route path="/auth" element={<p>auth page</p>} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  localStorage.clear();
  auth.signInWithGoogle.mockClear();
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ fileName: "resume.pdf", result }), { status: 200 })));
});

describe("GuestAnalysis", () => {
  it("shows one real issue and a few keywords before sign-in", async () => {
    renderPage();
    expect(await screen.findByText("No measurable results in your projects")).toBeInTheDocument();
    expect(screen.getByText("Docker")).toBeInTheDocument();
    expect(screen.getByText("+4 more")).toBeInTheDocument();
    expect(screen.getByText("See all 6 issues and how to fix them")).toBeInTheDocument();
  });

  it("comes back to this scan after Google sign-in, which is what claims it", async () => {
    renderPage();
    fireEvent.click((await screen.findAllByRole("button", { name: "Continue with Google" }))[0]);
    await waitFor(() => expect(auth.signInWithGoogle).toHaveBeenCalledOnce());
    expect(takeRememberedRedirect()).toBe("/analysis/guest/tok-1");
  });

  it("keeps an email route that carries the scan through /auth", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Use email instead" }));
    expect(await screen.findByText("auth page")).toBeInTheDocument();
  });
});
