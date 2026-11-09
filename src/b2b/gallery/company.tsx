// Gallery scenes for the company area (owner: the company clone). Fixture data only; see ./kit.tsx and ./college.tsx.
import type { ComponentType } from "react";
import type { QueryClient } from "@tanstack/react-query";
import RolesPage from "../company/RolesPage";
import RoleFormPage from "../company/RoleFormPage";
import RolePage from "../company/RolePage";
import ReportPage from "../company/ReportPage";
import SettingsPage from "../company/SettingsPage";
import type { CompanyOrg, JobRoleRecord, ShareLinkRow, TeamMember } from "../company/queries";
import type { CreditLedgerRow, InviteRow } from "../types";
import type { CandidateReport, PipelineRow } from "../../../supabase/functions/_shared/contracts/company";
import { DEMO, Scene } from "./kit";

const ROLE_DRAFT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
const ROLE_CLOSED = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3";
const RC = {
  asha: "55555555-5555-4555-8555-555555555551",
  bala: "55555555-5555-4555-8555-555555555552",
  chitra: "55555555-5555-4555-8555-555555555553",
};
const ATTEMPT = "66666666-6666-4666-8666-666666666661";
const SESSION_CODE = "88888888-8888-4888-8888-888888888881";
const SESSION_INTERVIEW = "88888888-8888-4888-8888-888888888882";
const HM_ID = "99999999-9999-4999-8999-999999999991";

/** Seeds what CompanyShell reads: staff access (signed-out gallery: user id undefined) and the org. */
export function seedCompanyShell(qc: QueryClient, isAdmin = true) {
  qc.setQueryData(["b2b-company", "access", DEMO.company, undefined], {
    role: isAdmin ? "org_admin" : "recruiter", isSuper: false, staff: true, isAdmin, isEditor: true,
  });
  qc.setQueryData<CompanyOrg>(["b2b-company", "org", DEMO.company], {
    id: DEMO.company, name: DEMO.companyName, type: "company", credits_balance: 640, status: "active",
    settings: { candidate_session_credits: 1 },
  });
}

const demoRole: JobRoleRecord = {
  id: DEMO.role, org_id: DEMO.company, title: "Backend engineer",
  jd_text: "We need a backend engineer with strong Python and SQL experience building APIs at scale for the payments team. ".repeat(2),
  skills_matrix: {
    must_have: [{ skill: "Python", weight: 5 }, { skill: "SQL", weight: 4 }, { skill: "System design", weight: 4 }],
    nice_to_have: [{ skill: "Docker", weight: 2 }, { skill: "AWS", weight: 3 }],
    seniority: "mid", summary: "Backend engineer for the payments team.",
  },
  seniority: "mid", assessment_id: DEMO.assessment,
  interview_config: { enabled: true, duration_min: 25, sections: ["intro", "technical", "problem_solving", "code_walkthrough", "close"], difficulty: "medium", code_walkthrough: true },
  proctoring_policy: "maximum", invite_expiry_days: 7, status: "open", hiring_manager_ids: [HM_ID], created_at: DEMO.created,
};
const demoRoleDraft: JobRoleRecord = {
  ...demoRole, id: ROLE_DRAFT, title: "Frontend engineer", assessment_id: null, status: "draft", hiring_manager_ids: [],
  interview_config: { ...demoRole.interview_config, enabled: false },
  skills_matrix: { must_have: [], nice_to_have: [], seniority: "junior" },
};
const demoRoleClosed: JobRoleRecord = { ...demoRole, id: ROLE_CLOSED, title: "Data analyst", status: "closed" };

const demoAssessments = [{ id: DEMO.assessment, title: "Python backend, 60 min", status: "ready", duration_min: 60 }];
const demoTeam = {
  members: [
    { id: "m1", user_id: HM_ID, role: "hiring_manager", full_name: "Hema Priya", email: "hema@demo.test", created_at: DEMO.created },
    { id: "m2", user_id: "u-rec", role: "recruiter", full_name: "Rahul Sen", email: "rahul@demo.test", created_at: DEMO.created },
  ] as TeamMember[],
  invites: [{ id: "iv1", org_id: DEMO.company, email: "new.recruiter@demo.test", full_name: "", role: "recruiter", status: "pending", expires_at: DEMO.closes, email_sent_at: null, email_error: null, created_at: DEMO.created }] as InviteRow[],
};
const demoLedger: CreditLedgerRow[] = [
  { id: 3, org_id: DEMO.company, delta: -1, balance_after: 640, reason: "consume", feature: "candidate_session", note: "Asha Reddy", created_at: DEMO.opens },
  { id: 2, org_id: DEMO.company, delta: -1, balance_after: 641, reason: "consume", feature: "candidate_session", note: "Bala Krishnan", created_at: DEMO.created },
  { id: 1, org_id: DEMO.company, delta: 750, balance_after: 642, reason: "grant", feature: null, note: "Opening balance", created_at: DEMO.created },
];
const demoShares: ShareLinkRow[] = [
  { id: "sh1", expires_at: new Date(Date.now() + 3 * 86_400_000).toISOString(), revoked_at: null, view_count: 2, last_viewed_at: DEMO.opens, created_at: DEMO.created },
];

function pipelineRow(over: Partial<PipelineRow> & { id: string; full_name: string; email: string }): PipelineRow {
  return {
    phone: null, stage: "invited", decision: null, match_score: null, recommendation: null,
    invited_at: DEMO.created, started_at: null, completed_at: null, invite_expires_at: DEMO.closes,
    email_sent_at: DEMO.created, email_error: null, attempt_status: null, coding: null, interview: null,
    integrity: null, integrity_band: null, credits_charged: false, ...over,
  };
}
const demoPipeline = {
  access: "editor" as const,
  total: 3,
  counts: { invited: 1, in_progress: 0, completed: 2, shortlisted: 0, rejected: 0, hired: 0 },
  rows: [
    pipelineRow({ id: RC.asha, full_name: "Asha Reddy", email: "asha@demo.test", stage: "completed", decision: "advance", match_score: 82, recommendation: "strong", coding: 84, interview: 78, integrity: 92, integrity_band: "high", completed_at: DEMO.opens, attempt_status: "submitted", credits_charged: true }),
    pipelineRow({ id: RC.bala, full_name: "Bala Krishnan", email: "bala@demo.test", stage: "completed", match_score: 58, recommendation: "borderline", coding: 60, interview: 55, integrity: 48, integrity_band: "low", completed_at: DEMO.opens, attempt_status: "submitted", credits_charged: true }),
    pipelineRow({ id: RC.chitra, full_name: "Chitra Nair", email: "chitra@demo.test", stage: "invited" }),
  ],
};

function demoReport(over: Partial<CandidateReport> = {}): CandidateReport {
  return {
    roleCandidateId: RC.asha, stage: "completed", decision: "advance", invitedAt: DEMO.created, completedAt: DEMO.opens,
    candidate: { fullName: "Asha Reddy", email: "asha@demo.test", phone: "+91 90000 00001" },
    role: { id: DEMO.role, title: "Backend engineer", orgName: DEMO.companyName },
    matchScore: 82, recommendation: "strong", coverage: 0.88,
    skills: [
      { skill: "Python", kind: "must", weight: 5, score: 88, evidence: ["Coding test: python 90%", "Interview: explained decorators and async/await correctly"] },
      { skill: "SQL", kind: "must", weight: 4, score: 74, evidence: ["Coding test: sql 70%"] },
      { skill: "System design", kind: "must", weight: 4, score: 65, evidence: ["Interview: described a basic queue-based design"] },
      { skill: "Docker", kind: "nice", weight: 2, score: null, evidence: [] },
    ],
    coding: {
      attemptId: ATTEMPT, status: "submitted", score: 17, maxScore: 20, pct: 85, passed: 17, total: 20, pending: false,
      questions: [
        { title: "Rate limiter", language: "python", code: "class RateLimiter:\n    def __init__(self, capacity):\n        self.capacity = capacity\n        self.tokens = capacity\n\n    def allow(self):\n        if self.tokens <= 0:\n            return False\n        self.tokens -= 1\n        return True\n", passed: 9, total: 10, score: 9, maxScore: 10 },
        { title: "Merge intervals", language: "python", code: "def merge(intervals):\n    intervals.sort()\n    out = [intervals[0]]\n    for s, e in intervals[1:]:\n        if s <= out[-1][1]:\n            out[-1][1] = max(out[-1][1], e)\n        else:\n            out.append([s, e])\n    return out\n", passed: 8, total: 10, score: 8, maxScore: 10 },
      ],
    },
    interview: {
      interviewId: "77777777-7777-4777-8777-777777777771", status: "completed", overall: 78, readiness: "ready", evaluationStatus: "completed",
      transcript: [
        { turn: 1, role: "interviewer", content: "Walk me through the rate limiter you submitted." },
        { turn: 1, role: "candidate", content: "It's a token bucket: I keep a token count, refill it on a timer, and reject a request when it's empty." },
        { turn: 2, role: "interviewer", content: "How would you scale that across multiple servers?" },
        { turn: 2, role: "candidate", content: "I'd move the counter into Redis so every server checks the same bucket." },
      ],
      evidence: [
        { label: "communication", score: 82, quotes: ["I'd move the counter into Redis so every server checks the same bucket."], reason: "Clear, specific answers" },
        { label: "system design", score: 65, quotes: ["I'd move the counter into Redis so every server checks the same bucket."], reason: "Reasonable first step, didn't cover failure modes" },
      ],
    },
    integrity: {
      score: 76, band: "medium",
      sessions: [
        { sessionId: SESSION_CODE, kind: "coding", score: 58, band: "low", flags: 3, review: null },
        { sessionId: SESSION_INTERVIEW, kind: "interview", score: 94, band: "high", flags: 0, review: "no_concern" },
      ],
    },
    comments: [{ id: "c1", author: "Rahul Sen", body: "Strong on fundamentals, system design answer was thin. Worth a follow-up round.", createdAt: DEMO.opens }],
    decisions: [{ decision: "advance", note: "Moving to the panel round.", by: "Rahul Sen", createdAt: DEMO.opens }],
    evidenceIncluded: true,
    ...over,
  };
}

function Roles() {
  return (
    <Scene path={`/co/${DEMO.company}/roles`} route="/co/:orgId/roles" element={<RolesPage />}
      seed={(qc) => {
        seedCompanyShell(qc);
        qc.setQueryData(["b2b-company", "roles", DEMO.company], [
          { ...demoRole, counts: { total: 18, completed: 9 } },
          { ...demoRoleDraft, counts: { total: 0, completed: 0 } },
          { ...demoRoleClosed, counts: { total: 32, completed: 30 } },
        ]);
      }} />
  );
}

function RolesEmpty() {
  return (
    <Scene path={`/co/${DEMO.company}/roles`} route="/co/:orgId/roles" element={<RolesPage />}
      seed={(qc) => { seedCompanyShell(qc); qc.setQueryData(["b2b-company", "roles", DEMO.company], []); }} />
  );
}

function RoleForm() {
  return (
    <Scene path={`/co/${DEMO.company}/roles/${DEMO.role}/edit`} route="/co/:orgId/roles/:roleId/edit" element={<RoleFormPage />}
      seed={(qc) => {
        seedCompanyShell(qc);
        qc.setQueryData(["b2b-company", "role", DEMO.role], demoRole);
        qc.setQueryData(["b2b-company", "assessments", DEMO.company], demoAssessments);
        qc.setQueryData(["b2b-company", "team", DEMO.company], demoTeam);
      }} />
  );
}

function Role() {
  return (
    <Scene path={`/co/${DEMO.company}/roles/${DEMO.role}`} route="/co/:orgId/roles/:roleId" element={<RolePage />}
      seed={(qc) => {
        seedCompanyShell(qc);
        qc.setQueryData(["b2b-company", "role", DEMO.role], demoRole);
        qc.setQueryData(["b2b-company", "pipeline", DEMO.role, {}, 1, { by: "match_score", dir: "desc" }], demoPipeline);
      }} />
  );
}

function Report() {
  return (
    <Scene path={`/co/${DEMO.company}/candidates/${RC.asha}`} route="/co/:orgId/candidates/:roleCandidateId" element={<ReportPage />}
      seed={(qc) => {
        seedCompanyShell(qc);
        qc.setQueryData(["b2b-company", "report", RC.asha], { access: "editor", report: demoReport() });
        qc.setQueryData(["b2b-company", "shares", RC.asha], demoShares);
      }} />
  );
}

function Settings() {
  return (
    <Scene path={`/co/${DEMO.company}/settings`} route="/co/:orgId/settings" element={<SettingsPage />}
      seed={(qc) => {
        seedCompanyShell(qc);
        qc.setQueryData(["b2b-company", "ledger", DEMO.company], demoLedger);
        qc.setQueryData(["b2b-company", "team", DEMO.company], demoTeam);
      }} />
  );
}

export const scenes: Record<string, ComponentType> = {
  roles: Roles, "roles-empty": RolesEmpty, "role-form": RoleForm, role: Role, report: Report, settings: Settings,
};
