# Step 2 — Plans and entitlements

## What changed
- `supabase/migrations/20260923000002_b2b_plans.sql`
  - `plans` seeded: pilot (6/student, all features, max 150), basic (4/student, no packs, no dashboard),
    pro (10/student, packs + dashboard). `max_students` NULL = no cap. `price_inr_per_student` (default 0)
    is there for Step 9's cost-vs-revenue view; set it manually.
  - `organizations.plan_id` (default `pilot`), `plan_starts_at`, `plan_ends_at`.
  - `org_student_usage (org_id, user_id, interviews_used)` — read-only to users; staff see their org, students
    see themselves.
  - `consume_interview_credit(org, user)` — one atomic upsert (row-locked conflict path), so concurrent starts
    from a lab can't overshoot. Refuses non-students, other orgs' students, expired plans. `refund_interview_credit`
    returns a credit when an interview fails to start. **Both are callable by the service role only** — the
    Step 5 interview function calls them; the browser cannot.
  - Trigger enforces `max_students` on insert / promotion to student, serialized per org with an advisory lock.
  - `my_interview_quota()` (student), `org_usage_summary(org)` (staff / super-admin), `super_add_org_member(org,
    email, role)` (super-admin attaches an existing account as org admin or trainer).
- Step 1 fix: `is_org_staff` / `is_org_admin` returned NULL (not false) for non-members. RLS was unaffected
  (NULL = deny) but a PL/pgSQL `IF NOT …` guard would have been skipped. Now COALESCEd; regression test added.
- UI (new routes, own chrome; B2C nav/FAB/Studio tooltip hidden on them):
  - `/admin/orgs` — super-admin: create institution (name, link slug, type, plan, end date — defaults to 6 weeks,
    logo URL), change plan / end date, add staff by email.
  - `/org`, `/org/:orgId` — staff: students enrolled vs cap, interviews used vs allocated, plan days left,
    searchable student list with used / remaining.
  - `/learn` — student: interviews left and plan end date.
- Tests: `supabase/tests/rls/plans.test.ts` (13), UI tests `src/features/b2b/**` (9).
  Test harness now mirrors Supabase's default EXECUTE grants, so a forgotten REVOKE fails a test.

## Verify
1. `npm test` → 38 pass, 3 skipped.
2. Deploy: `supabase db push`. Make yourself super-admin once in the SQL editor:
   `insert into user_roles (user_id, role) select id, 'admin' from auth.users where email = '<you>' on conflict do nothing;`
3. Open `/admin/orgs` → New institution → Add staff (a second test account) as Org admin.
4. Sign in as that account → `/org` shows 0 / 150 students and the plan window.
5. B2C: `/dashboard`, `/voice-interview` look and behave exactly as before.

## Not yet
- No UI entry point from `/dashboard` to `/org` or `/learn` — added with invites in Step 3 (students land on
  `/learn` after accepting).
- `consume_interview_credit` isn't called anywhere yet; Step 5's interview engine wires it in.
