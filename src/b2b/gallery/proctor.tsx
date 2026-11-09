// Gallery scenes for the proctor area (owner: the proctor clone). Fixture data only; see ./kit.tsx and ./college.tsx.
import type { ComponentType } from "react";
import type { QueryClient } from "@tanstack/react-query";
import CheckPage, { CheckResultsPreview, Frame as CheckFrame } from "../proctor/CheckPage";
import ReviewPage, { reviewKey } from "../proctor/ReviewPage";
import { ConsentStep } from "../proctor/ConsentStep";
import { ScreenShareStep } from "../proctor/ScreenShareStep";
import { useB2BTheme } from "../layout/V1Shell";
import { Scene } from "./kit";

const SID = "99999999-9999-4999-8999-999999999999";

/** A fixture snapshot: a dark webcam frame with a muted head-and-shoulders silhouette, no network call. */
function snapshotUri(caption: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180">
    <rect width="320" height="180" fill="#0E121B" />
    <rect x="0.5" y="0.5" width="319" height="179" fill="none" stroke="#2A3142" />
    <circle cx="160" cy="70" r="30" fill="#2A3142" />
    <path d="M100 160 Q160 100 220 160 Z" fill="#2A3142" />
    <text x="12" y="166" font-family="monospace" font-size="13" fill="#5B6478">${caption}</text>
  </svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** Scene 1: the stand-alone check page, intro — the only moment the 3D stage is allowed here. */
function Check() {
  return <Scene path="/proctor/check" route="/proctor/check" element={<CheckPage />} seed={() => {}} />;
}

/** Scene 2: the same check, done — six rows passed, one (Speakers) needs attention. No 3D once checking starts. */
function CheckResults() {
  return <CheckResultsPreview />;
}

/** Scene 3: itemised consent for a proctored coding test, nothing accepted yet. */
function Consent() {
  useB2BTheme();
  return (
    <div className="min-h-screen bg-background text-foreground flex items-start justify-center p-4 sm:p-8">
      <div className="w-full max-w-2xl bg-[var(--hr-surface)] shadow-[inset_0_0_0_1px_var(--hr-rule)] p-5 sm:p-6">
        <ConsentStep
          ctx={{ orgName: "Walkthrough College", retentionDays: 90, contactEmail: "tpo@walkthrough.edu", kind: "assessment", hasAttempt: true }}
          onAccept={() => {}} onDecline={() => {}}
        />
      </div>
    </div>
  );
}

/** The real ScreenShareStep, in the state right after a window (not entire-screen) share was rejected. */
function ScreenShareRejected() {
  useB2BTheme();
  return (
    <CheckFrame>
      <div className="max-w-md hr-rise">
        <ScreenShareStep onStart={() => {}} error="You shared a single window. Please share your Entire screen instead." />
      </div>
    </CheckFrame>
  );
}

const session = {
  id: SID, policy: "strict", integrity_score: 71, integrity_band: "medium" as const, provisional: false, status: "ended",
  violations: 2, context_type: "drive", subject_name: "Bala Kumar", system_check: null,
  started_at: "2026-10-21T10:00:00Z", ended_at: "2026-10-21T11:02:00Z",
  score_detail: {
    version: "integrity-v1", score: 71, band: "medium" as const, total_deduction: 29, formula: "100 − Σ capped",
    by_type: [
      { type: "looking_away", label: "Looking away from the screen", count: 18, points: 22, cap: 15, capped: 15 },
      { type: "tab_hidden", label: "Switched tab or app", count: 2, points: 6, cap: 10, capped: 6 },
      { type: "multiple_faces", label: "More than one face in view", count: 1, points: 8, cap: 25, capped: 8 },
    ],
  },
};

const events = [
  { id: 1, type: "multiple_faces", severity: "high" as const, confidence: 0.91, started_at: "2026-10-21T10:12:40Z", ended_at: "2026-10-21T10:12:47Z",
    evidenceUrl: snapshotUri("Snapshot 10:12"), review_status: "pending" as const, review_note: null, meta: {} },
  { id: 2, type: "tab_hidden", severity: "medium" as const, confidence: 1, started_at: "2026-10-21T10:26:05Z", ended_at: "2026-10-21T10:26:11Z",
    evidenceUrl: null, review_status: "confirmed" as const, review_note: "Switched to check the clock", meta: {} },
  { id: 3, type: "looking_away", severity: "low" as const, confidence: 0.76, started_at: "2026-10-21T10:40:18Z", ended_at: "2026-10-21T10:40:25Z",
    evidenceUrl: snapshotUri("Snapshot 10:40"), review_status: "dismissed" as const, review_note: "Reading the question sheet beside the laptop", meta: {} },
  { id: 4, type: "snapshot", severity: "info" as const, confidence: 1, started_at: "2026-10-21T10:45:00Z", ended_at: null,
    evidenceUrl: snapshotUri("Snapshot 10:45"), review_status: "pending" as const, review_note: null, meta: { kind: "screen" } },
];

function seedReview(qc: QueryClient, reviews: unknown[] = []) {
  qc.setQueryData(reviewKey(SID), { session, events, reviews });
}

/** Scene 4: the integrity timeline — one event needs review (red), one confirmed, one dismissed, one periodic snapshot. */
function Review() {
  return (
    <Scene path={`/proctor/review/${SID}`} route="/proctor/review/:sessionId" element={<ReviewPage />}
      seed={(qc) => seedReview(qc)} />
  );
}

/** Scene 5: the same session after a human decision has been recorded. */
function ReviewDecided() {
  return (
    <Scene path={`/proctor/review/${SID}`} route="/proctor/review/:sessionId" element={<ReviewPage />}
      seed={(qc) => seedReview(qc, [{ id: "r1-decision-review", decision: "minor_concern", note: "One tab switch, explained; dismissed the rest.", reviewer_name: "Priya Sharma", created_at: "2026-10-21T11:30:00Z" }])} />
  );
}

export const scenes: Record<string, ComponentType> = {
  check: Check,
  "check-results": CheckResults,
  "screen-share-rejected": ScreenShareRejected,
  consent: Consent,
  review: Review,
  "review-decided": ReviewDecided,
};
