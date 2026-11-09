// Gallery scenes for the runner area (owner: the runner clone). Fixture data only; see ./kit.tsx and ./college.tsx.
// Nothing here animates — same rule as the real runner: no entrance motion, no numeral drive-in, no 3D.
import { useState, type ComponentType } from "react";
import { useB2BTheme } from "../layout/V1Shell";
import { Runner, RunPanel, FinishConfirmDialog } from "../runner/Runner";
import { CodeEditor } from "../runner/CodeEditor";
import StartPage from "../runner/StartPage";
import type { AttemptState, JudgeResult } from "../../../supabase/functions/_shared/contracts/assess";
import { Button } from "@/components/ui/button";
import { Play } from "lucide-react";
import { Scene } from "./kit";

const ATT = "a1111111-1111-4111-8111-111111111111";
const SESS = "a2222222-2222-4222-8222-222222222222";
const QM = "a3333333-3333-4333-8333-333333333333";
const QC = "a4444444-4444-4444-8444-444444444444";
const QM2 = "a5555555-5555-4555-8555-555555555555";

function baseState(over: Partial<AttemptState> = {}): AttemptState {
  const now = new Date("2026-10-24T09:00:00Z");
  return {
    attemptId: ATT, status: "in_progress", sessionId: SESS, paused: false,
    title: "CSE 2027 placement drive: Coding / MCQ test", watermark: "21CSE002 · Bala Kumar",
    server_now: now.toISOString(), deadline_at: new Date(now.getTime() + 42 * 60_000).toISOString(),
    proctoring: { policy: "standard", sessionId: null }, result: null,
    questions: [
      { id: QM, type: "mcq", title: "Train speed", statement: "A train covers 120 km in 2 hours. What is its average speed?",
        difficulty: "easy", points: 1, section: "Aptitude",
        options: [{ id: "a", text: "40 km/h" }, { id: "b", text: "60 km/h" }, { id: "c", text: "80 km/h" }],
        multi_select: false, saved: { language: null, code: null, mcq_choice: ["b"], seq: 1 } },
      { id: QC, type: "coding", title: "Two sum", statement: "Given an array of integers and a target, return the indices of the two numbers that add up to the target.",
        difficulty: "medium", points: 10, section: "Coding", languages: ["python", "java"],
        starter_code: { python: "def two_sum(nums, target):\n    pass\n", java: "// start" },
        constraints: "2 ≤ nums.length ≤ 10^4\nEach input has exactly one solution.",
        samples: [{ input: "[2,7,11,15]\n9", output: "[0, 1]" }], saved: null },
      { id: QM2, type: "mcq", title: "Time complexity", statement: "A single loop over n elements, with constant work each iteration, runs in:",
        difficulty: "easy", points: 1, section: "Aptitude",
        options: [{ id: "a", text: "O(1)" }, { id: "b", text: "O(n)" }, { id: "c", text: "O(n^2)" }],
        multi_select: false, saved: null },
    ],
    ...over,
  } as AttemptState;
}

const noop = () => {};

/** Scene 1: the incomplete-link state (a real, deterministic state of this page — no network needed). */
function Start() {
  return <Scene path="/assess/start" route="/assess/start" element={<StartPage />} seed={() => {}} />;
}

/** Scene 2: an MCQ question, one option already picked, the nav showing answered and unanswered questions.
 * (Runner itself never applies the B2B theme class — RunnerPage does that in the real app — so the scene does it.) */
function Mcq() {
  useB2BTheme();
  return <Runner state={baseState()} onEnded={noop} onConflict={noop} heartbeatMs={600_000} autosaveMs={600_000} />;
}

/** Scene 3: the coding question with the editor and a passed sample run — composed from the real editor and
 * run panel (not the live Runner, since a real sample run needs the judge backend this gallery has none of). */
function Coding() {
  useB2BTheme();
  const [code, setCode] = useState("def two_sum(nums, target):\n    seen = {}\n    for i, n in enumerate(nums):\n        if target - n in seen:\n            return [seen[target - n], i]\n        seen[n] = i\n    return []\n");
  const result: JudgeResult = {
    submissionId: "demo", status: "done", compile_output: null, passed: 2, total: 2,
    tests: [
      { sample: true, passed: true, time_ms: 4, status: "passed", stdout: "[0, 1]", expected: "[0, 1]" },
      { sample: true, passed: true, time_ms: 5, status: "passed", stdout: "[1, 2]", expected: "[1, 2]" },
    ],
  };
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="grid lg:grid-cols-2 gap-px bg-[var(--hr-rule)] max-w-6xl mx-auto">
        <section className="bg-background px-4 py-4">
          <p className="hr-label mb-2">Coding · Medium · 10 points</p>
          <h2 className="hr-display text-xl mb-3">2. Two sum</h2>
          <p className="text-sm leading-relaxed text-[var(--hr-floodlight)]">
            Given an array of integers and a target, return the indices of the two numbers that add up to the target.
          </p>
          <p className="hr-label mt-4 mb-1">Constraints</p>
          <p className="text-sm text-[var(--hr-muted)] whitespace-pre-wrap">2 ≤ nums.length ≤ 10^4{"\n"}Each input has exactly one solution.</p>
          <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
            <div><p className="hr-label mb-1">Sample input 1</p><pre className="hr-data bg-[var(--hr-surface)] shadow-[inset_0_0_0_1px_var(--hr-rule)] p-2">{"[2,7,11,15]\n9"}</pre></div>
            <div><p className="hr-label mb-1">Expected output</p><pre className="hr-data bg-[var(--hr-surface)] shadow-[inset_0_0_0_1px_var(--hr-rule)] p-2">{"[0, 1]"}</pre></div>
          </div>
        </section>
        <section className="bg-background px-4 py-4 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <span className="hr-label">Language</span>
            <select className="shadow-[inset_0_0_0_1px_var(--hr-rule)] bg-[var(--hr-surface)] px-2 py-1 text-sm hr-data" value="python" onChange={noop}>
              <option value="python">Python 3</option>
            </select>
          </div>
          <div className="h-[320px]"><CodeEditor language="python" value={code} onChange={(c) => setCode(c)} onSignal={noop} /></div>
          <Button variant="outline" size="sm" disabled><Play className="h-4 w-4 mr-1" />Run samples</Button>
          <RunPanel result={result} />
        </section>
      </div>
    </div>
  );
}

/** Scene 4: under five minutes left — the timer turns amber, never flashing. */
function LastMinutes() {
  useB2BTheme();
  const now = new Date("2026-10-24T09:00:00Z");
  const state = baseState({ server_now: now.toISOString(), deadline_at: new Date(now.getTime() + 4 * 60_000 + 12_000).toISOString() });
  return <Runner state={state} onEnded={noop} onConflict={noop} heartbeatMs={600_000} autosaveMs={600_000} />;
}

/** Scene 5: the finish confirmation, with the real answered count. */
function SubmitConfirm() {
  useB2BTheme();
  return (
    <div className="min-h-screen bg-background text-foreground p-4">
      <p className="hr-label">Finish test</p>
      <FinishConfirmDialog open answeredCount={2} total={3} onOpenChange={noop} onConfirm={noop} />
    </div>
  );
}

export const scenes: Record<string, ComponentType> = {
  start: Start,
  mcq: Mcq,
  coding: Coding,
  "last-minutes": LastMinutes,
  "submit-confirm": SubmitConfirm,
};
