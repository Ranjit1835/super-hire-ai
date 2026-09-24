# Step 10 — Public readiness test (`/test/{org-slug}`)

A lead-generation page that coaching institutes share on WhatsApp or Instagram. A visitor takes a short voice test with **no account**, gets a branded gap report, and becomes a lead the institute can follow up.

## What changed

**Migration `20260923000011_b2b_public_test.sql`**
- `organizations` gains these columns:
  - `public_test_enabled`;
  - `public_test_monthly_cap` (default 100, set by the super-admin);
  - `public_test_cta_label` and `public_test_cta_url` (`https://`, `tel:` or `mailto:` only).
- `interview_modules.public_test` controls which modules are offered publicly.
- `b2b_interviews` gains `kind` (`practice` | `public_test`) and `lead_id`.
- `org_leads` table:
  - holds name, +91 mobile, email, optional course, consent version and text, status, and the latest score, readiness level and primary gap;
  - staff can read it and org admins can change **only** `status`, which a trigger enforces;
  - the score fields are synced by a trigger when an evaluation is saved.
- `b2b_public_test_attempts` stores **hashes only** of phone, email and IP, with a prune function.
- `public_test_info(slug)` can be called without logging in:
  - it returns branding, the call-to-action button, and the public modules shortened to at most 6 questions and 10 minutes;
  - its `available` flag is true only when the test is enabled, the plan is active, and this month's usage is under the cap.
- `b2b_start_public_test` (service role only) re-checks everything **atomically** and creates the lead, the attempt and the interview:

  | Reason | When it fires |
  |---|---|
  | `NOT_AVAILABLE` | Test disabled, plan inactive or expired |
  | `MONTHLY_CAP` | Non-cancelled public tests this calendar month ≥ cap |
  | `ALREADY_TAKEN` | Same phone **or** email ≥ 2 times in 30 days for this org |
  | `RATE_LIMITED` | Same IP ≥ 5 per org per day, or ≥ 20 per day across all orgs |
  | `IN_PROGRESS` | This browser already has a test in progress |
  | `CONSENT_REQUIRED` / `MODULE_*` | Consent missing, or the module is not public or has changed |
- `b2b_public_test_failed_start`: if the AI can't ask the first question, the interview is cancelled and the attempt deleted, so the visitor's quota isn't used up.
- Two org functions:
  - `org_update_public_test_settings` (org admin);
  - `org_public_test_usage` (staff).
- The dashboard view `org_dashboard_evaluations` now counts only `kind = 'practice'`, so leads never appear in student analytics.

**Edge function `b2b-public-test`** (action `start`)
- It validates the lead server-side (`_shared/lead.ts`), then hashes phone, email and IP with `B2B_HASH_SALT`.
- It then calls the RPC and asks the opening question (shared `_shared/interview-opening.ts`, also used by `b2b-interview`).
- The rest of the test (answer, resume, end, evaluate) reuses the existing `b2b-interview` and `b2b-evaluate` functions unchanged. Engine, evaluator, cost logging and resume after a dropped connection all come along automatically.

**Visitor identity.** Visitors get a Supabase **anonymous** session, which is created only when they press Start. `AuthContext` treats anonymous sessions as signed out, so B2C pages, nav and paywalls behave exactly as before.

**Frontend**
- `/test/:slug` (`PublicTest.tsx`) moves through these screens:
  1. branded page;
  2. module choice;
  3. lead form;
  4. consent;
  5. live voice interview;
  6. compact report plus the institute's call-to-action button.

  It also handles the fully-booked and unavailable-link states, and resumes a test after a page reload.
- `/org/:id/leads` (`OrgLeads.tsx`) has:
  - an enable toggle;
  - a copyable link;
  - usage shown as used / cap;
  - per-module "offer publicly" switches;
  - call-to-action button text and link;
  - a leads table with search, status filter, per-row status, a report dialog and CSV export.

  The tab appears for coaching institutes, or whenever the public test is enabled.
- **Super-admin → Edit plan** now includes "Free public readiness tests per month".
- The interview loop was pulled out into `useInterviewSession` and `LiveInterviewPanel`, and `InterviewRoom` and `PublicTest` share them. The existing interview-room tests pass unchanged.

## Data minimisation
- Stored per lead:
  - name, mobile, email, optional course, consent text and version, status and result summary;
  - the transcript, like any interview.
- Rate-limit rows hold only salted SHA-256 hashes (no raw IP is ever stored), and old rows can be pruned.
- No audio is stored.

## Tests
- `supabase/tests/rls/public-test.test.ts` has 13 tests covering:
  - anon info;
  - cap, including that cancelled tests don't count;
  - phone and email repeat limits;
  - IP limits;
  - consent;
  - leads isolated across orgs;
  - the status-only update guard;
  - result sync;
  - dashboard exclusion.
- `supabase/tests/unit/lead.test.ts` has 12 tests of lead validation and phone normalisation.
- `src/features/b2b/pages/public-test.test.tsx` has 9 UI tests covering:
  - the form flow;
  - start, run and report;
  - a server rejection that keeps the form filled;
  - fully booked;
  - resume;
  - leads settings, filters and trainer read-only.
- Full suite: **259 passed, 3 skipped** (the staging-only API tests). The build passes and lint is clean on the new code.

## Setup before this works in production
1. `supabase db push`, then `supabase functions deploy b2b-public-test b2b-interview`.
2. **Supabase Dashboard → Authentication → Sign In / Providers → enable "Anonymous sign-ins".** Also turn on the CAPTCHA (Turnstile or hCaptcha) under Attack Protection, because anonymous sign-up is otherwise open to scripts.
3. `supabase secrets set B2B_HASH_SALT=<random 32+ chars>`. If it isn't set, the service key is used as the salt, but a dedicated salt means rotating the key doesn't reset the limits.

## Manual verification
1. As super-admin, open **Edit plan** for an org, set the monthly tests to 3, and save.
2. As its org admin, open **Leads**:
   - enable the test;
   - switch one module to "offer publicly";
   - set the button to `https://wa.me/91…`;
   - copy the link.
3. In an incognito window, open the link:
   - fill the form, tick consent, and take the test (typed answers are fine);
   - the report appears, followed by the call-to-action button.
4. Reload during a test and check that "Continue" resumes it.
5. Retake with the same phone number: the 3rd attempt shows "already taken".
6. Use up the cap: the page shows "fully booked".
7. Back in **Leads**, check that the lead shows its score and readiness, the status can be changed, and CSV export works.
8. The org's **Readiness** dashboard shows none of the public-test results.
