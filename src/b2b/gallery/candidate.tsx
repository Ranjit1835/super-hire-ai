// Gallery scenes for the candidate area (owner: the candidate clone). Fixture data only; see ./kit.tsx and ./college.tsx.
import type { ComponentType } from "react";
import InviteAccept from "../../features/b2b/pages/InviteAccept";
import SharePage from "../candidate/SharePage";
import { CandidateFrame, Steps } from "../candidate/TokenFlowPage";
import type { CandidateState } from "../../../supabase/functions/_shared/contracts/company";
import type { CandidatePurpose } from "../../../supabase/functions/_shared/company-logic";
import { Scene } from "./kit";

// ── /invite/:token ──────────────────────────────────────────────────────────
const COLLEGE_ORG = { id: "org-gallery-college", name: "SVR Engineering College", type: "college", logo_url: null, is_demo: false };

const studentPreview = {
  status: "pending", full_name: "Kiran Rao", email: "kiran@svr.edu.in", roll_no: "21CSE014", batch: "CSE 2026 A",
  org: COLLEGE_ORG, has_account: false, consent: { version: "v1", text: "I agree to share my interview data with SVR Engineering College." },
};

const staffPreview = {
  status: "pending", role: "org_admin", full_name: "Arjun Verma", email: "arjun@svr.edu.in", roll_no: "", batch: null,
  org: COLLEGE_ORG, has_account: false, consent: { version: "v1", text: "I agree to HiResume's staff data-handling terms for SVR Engineering College." },
};

const expiredPreview = { ...studentPreview, status: "expired" };

function InviteStudent() {
  return (
    <Scene path="/invite/gallery-student" route="/invite/:token" element={<InviteAccept />}
      seed={(qc) => qc.setQueryData(["b2b", "invite-preview", "gallery-student"], studentPreview)} />
  );
}

function InviteStaff() {
  return (
    <Scene path="/invite/gallery-staff" route="/invite/:token" element={<InviteAccept />}
      seed={(qc) => qc.setQueryData(["b2b", "invite-preview", "gallery-staff"], staffPreview)} />
  );
}

function InviteExpired() {
  return (
    <Scene path="/invite/gallery-expired" route="/invite/:token" element={<InviteAccept />}
      seed={(qc) => qc.setQueryData(["b2b", "invite-preview", "gallery-expired"], expiredPreview)} />
  );
}

// ── /t/:token (welcome, pre-consent: the Stage is still on screen) ──────────
const tokenInfo = {
  company: { name: "Northwind Robotics" }, role: { title: "Backend engineer" },
  candidate: { fullName: "Asha Reddy", emailMasked: "as***@x.in" },
  purposes: ["account", "assessment", "proctoring_camera"] as CandidatePurpose[],
  proctored: true,
};
const tokenState: CandidateState = {
  roleCandidateId: "00000000-0000-4000-8000-00000000000a", jobRoleId: "00000000-0000-4000-8000-00000000000b",
  attemptId: null, interviewId: null, completed: false,
  steps: { consent: "todo", system_check: "todo", coding: "todo", interview: "todo", done: "todo" },
};

function TokenWelcome() {
  return (
    <CandidateFrame>
      <Steps info={tokenInfo} state={tokenState} token="gallery-token" onState={() => {}} />
    </CandidateFrame>
  );
}

// ── /share/:token ────────────────────────────────────────────────────────────
const sharedReport = {
  roleCandidateId: "00000000-0000-4000-8000-00000000000c", stage: "completed" as const, decision: null,
  invitedAt: "2026-10-18T05:00:00Z", completedAt: "2026-10-20T09:00:00Z",
  candidate: { fullName: "Asha Reddy", email: "asha@demo.test", phone: null },
  role: { id: "00000000-0000-4000-8000-00000000000b", title: "Backend engineer", orgName: "Northwind Robotics" },
  matchScore: 82, recommendation: "strong" as const, coverage: 1,
  skills: [{ skill: "Python", kind: "must" as const, weight: 5, score: 80, evidence: ["Coding test: python 80%"] }],
  coding: { attemptId: "00000000-0000-4000-8000-00000000000d", status: "submitted", score: 8, maxScore: 10, pct: 80, passed: 4, total: 5, pending: false,
    questions: [{ title: "Two sum", language: "python", code: "print(42)", passed: 4, total: 5, score: 8, maxScore: 10 }] },
  interview: null,
  integrity: { score: 92, band: "high" as const, sessions: [{ sessionId: null, kind: "coding", score: 92, band: "high" as const, flags: 0, review: null }] },
  comments: [], decisions: [], evidenceIncluded: false,
};

function Share() {
  return (
    <Scene path="/share/gallery-share" route="/share/:token" element={<SharePage />}
      seed={(qc) => qc.setQueryData(["b2b-share", "gallery-share"], {
        status: "ok", expiresAt: new Date(Date.now() + 3 * 86_400_000).toISOString(), report: sharedReport,
      })} />
  );
}

function ShareRevoked() {
  return (
    <Scene path="/share/gallery-revoked" route="/share/:token" element={<SharePage />}
      seed={(qc) => qc.setQueryData(["b2b-share", "gallery-revoked"], { status: "revoked" })} />
  );
}

export const scenes: Record<string, ComponentType> = {
  "invite-student": InviteStudent,
  "invite-staff": InviteStaff,
  "invite-expired": InviteExpired,
  "token-welcome": TokenWelcome,
  share: Share,
  "share-revoked": ShareRevoked,
};
