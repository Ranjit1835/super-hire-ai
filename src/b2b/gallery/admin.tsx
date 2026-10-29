// Gallery scenes for the admin area (owner: the admin clone). Fixture data only; see ./kit.tsx and ./college.tsx.
import type { QueryClient } from "@tanstack/react-query";
import AdminOrgsPage from "../admin/AdminOrgsPage";
import AdminUsagePage from "../admin/AdminUsagePage";
import { CreateOrgDialog } from "../admin/CreateOrgDialog";
import { V1Shell } from "../layout/V1Shell";
import { ADMIN_TABS } from "../admin/AdminOrgsPage";
import type { CreditLedgerRow, InviteRow, OrgRow, PlanRow } from "../types";
import type { OrgUsageRow } from "../../../supabase/functions/_shared/contracts/admin";
import { Scene } from "./kit";

const plan = (id: string, org_type: "college" | "company", price: number, credits: number): PlanRow => ({
  id, name: id.replace(/_/g, " "), org_type, price_inr_per_student: price, drives_included: 1,
  credits_per_student: credits, credits_included: 0, is_active: true,
});
const demoPlans: PlanRow[] = [
  plan("college_starter", "college", 399, 4),
  plan("college_plus", "college", 599, 5),
  plan("company_v1", "company", 0, 0),
];

const org = (over: Partial<OrgRow>): OrgRow => ({
  id: "o1", name: "Walkthrough College", slug: "walkthrough-college", type: "college", status: "active",
  plan_id: "college_starter", plan_starts_at: "2026-08-01T00:00:00Z", plan_ends_at: "2027-07-31T00:00:00Z",
  seat_limit: 300, credits_balance: 1180, contact_name: "Priya Sharma", contact_email: "priya@walkthrough.edu",
  contact_phone: "9900000001", address: null, logo_url: null, settings: {}, is_demo: false,
  created_at: "2026-08-01T05:00:00Z", ...over,
});
const demoOrgs: OrgRow[] = [
  org({}),
  org({ id: "o2", name: "Acme Labs", slug: "acme-labs", type: "company", plan_id: "company_v1", status: "suspended",
    seat_limit: null, credits_balance: 20, contact_name: "Rahul Nair", contact_email: "rahul@acmelabs.in" }),
  org({ id: "o3", name: "Second City Institute of Technology", slug: "sci-tech", plan_id: "college_plus",
    seat_limit: 450, credits_balance: 2250, plan_ends_at: "2027-03-31T00:00:00Z" }),
];
const demoInvites: InviteRow[] = [
  { id: "i1", org_id: "o1", email: "tpo@walkthrough.edu", full_name: "TPO", role: "org_admin", status: "pending",
    expires_at: "2026-11-07T00:00:00Z", email_sent_at: null, email_error: null, created_at: "2026-10-20T05:00:00Z" },
  { id: "i2", org_id: "o3", email: "placements@scitech.edu", full_name: "Placements", role: "trainer", status: "pending",
    expires_at: "2026-11-10T00:00:00Z", email_sent_at: null, email_error: null, created_at: "2026-10-22T05:00:00Z" },
];
const demoLedger: CreditLedgerRow[] = [
  { id: 1, org_id: "o1", delta: 1200, balance_after: 1200, reason: "grant", feature: null, note: "Starter plan", created_at: "2026-08-01T05:00:00Z" },
  { id: 2, org_id: "o1", delta: -20, balance_after: 1180, reason: "consume", feature: "practice_interview", note: null, created_at: "2026-09-10T11:00:00Z" },
];

function seedShell(qc: QueryClient) {
  qc.setQueryData(["b2b-v1", "is-super", undefined], true);
  qc.setQueryData(["b2b-v1", "orgs"], demoOrgs);
  qc.setQueryData(["b2b-v1", "plans"], demoPlans);
  qc.setQueryData(["b2b-v1", "staff-invites"], demoInvites);
  qc.setQueryData(["b2b-v1", "ledger", "o1"], demoLedger);
}

/** Organisations table with the just-created invite link panel showing. */
function Orgs() {
  return (
    <Scene path="/admin/orgs" route="/admin/orgs"
      element={<AdminOrgsPage demoInviteLink={{ email: "tpo@gokaraju.edu", link: "https://hiresume.in/invite/8f2c1a0e9b" }} />}
      seed={seedShell} />
  );
}

function OrgsEmpty() {
  return (
    <Scene path="/admin/orgs" route="/admin/orgs" element={<AdminOrgsPage />}
      seed={(qc) => {
        qc.setQueryData(["b2b-v1", "is-super", undefined], true);
        qc.setQueryData(["b2b-v1", "orgs"], []);
        qc.setQueryData(["b2b-v1", "plans"], demoPlans);
        qc.setQueryData(["b2b-v1", "staff-invites"], []);
      }} />
  );
}

/** The create-organisation dialog, open over the orgs table. */
function OrgsCreateDialog() {
  return (
    <Scene path="/admin/orgs" route="/admin/orgs"
      element={(
        <V1Shell title="Super admin" subtitle="Colleges and companies" tabs={ADMIN_TABS}>
          <CreateOrgDialog open onOpenChange={() => {}} plans={demoPlans} onCreated={() => {}} />
        </V1Shell>
      )}
      seed={seedShell} />
  );
}

const demoUsage: OrgUsageRow[] = [
  { org_id: "o1", org_name: "Walkthrough College", org_type: "college", status: "active", plan_id: "college_starter",
    credits_balance: 1180, credits_used_month: 20, students: 300, students_active: 210, candidates: 0, members: 3,
    ai_calls_month: 40, ai_cost_inr_month: 52.5, ai_cost_inr_total: 180.25, cache_hits_month: 10, cache_hit_rate_month: 0.25 },
  { org_id: "o2", org_name: "Acme Labs", org_type: "company", status: "suspended", plan_id: "company_v1",
    credits_balance: 20, credits_used_month: 4, students: 0, students_active: 0, candidates: 18, members: 2,
    ai_calls_month: 18, ai_cost_inr_month: 21, ai_cost_inr_total: 64, cache_hits_month: 2, cache_hit_rate_month: 0.111 },
  { org_id: "o3", org_name: "Second City Institute of Technology", org_type: "college", status: "active", plan_id: "college_plus",
    credits_balance: 2250, credits_used_month: 95, students: 450, students_active: 388, candidates: 0, members: 5,
    ai_calls_month: 160, ai_cost_inr_month: 198.4, ai_cost_inr_total: 940.6, cache_hits_month: 70, cache_hit_rate_month: 0.4375 },
];

function Usage() {
  return (
    <Scene path="/admin/usage" route="/admin/usage" element={<AdminUsagePage />}
      seed={(qc) => {
        qc.setQueryData(["b2b-v1", "is-super", undefined], true);
        qc.setQueryData(["b2b-v1", "usage"], demoUsage);
      }} />
  );
}

export const scenes = {
  orgs: Orgs,
  "orgs-empty": OrgsEmpty,
  "orgs-create-dialog": OrgsCreateDialog,
  usage: Usage,
};
