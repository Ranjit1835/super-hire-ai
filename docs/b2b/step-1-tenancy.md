# Step 1 — Multi-tenancy

## What changed
- `supabase/migrations/20260923000001_b2b_tenancy.sql`
  - `organizations` (name, slug, type, logo_url, is_demo, created_by). `plan_id` arrives in Step 2.
  - `batches` (org_id, name, department, course, start_date).
  - `org_memberships` (org_id, user_id, role, batch_id, full_name, email, roll_no). Student identity lives here,
    org-scoped, so staff never get access to B2C `profiles`.
  - Composite FK `(batch_id, org_id) → batches(id, org_id)`: a membership can't reference another org's batch.
  - Trigger: `user_id` / `org_id` on a membership are immutable.
  - Helpers (SECURITY DEFINER, empty search_path, not callable by anon): `is_super_admin()`, `org_role_of(org)`,
    `is_org_member(org)`, `is_org_staff(org)`, `is_org_admin(org)`, `my_batch_ids()`.
    Super-admin = existing `user_roles.role = 'admin'`.
  - RLS: members read their org; staff read roster + all batches; students read only their own row + batch.
    Org creation/settings = super-admin only. Memberships are inserted only by super-admin or the service role
    (invite acceptance, Step 3); org admins can update/remove members of their own org.
- No B2C table, policy, function or page was modified.
- Tests: `supabase/tests/rls/tenancy.test.ts` (15 tests) on embedded Postgres (PGlite) applying the real
  migration; `supabase/tests/api/tenancy.api.test.ts` hits a real staging project over REST (skipped unless
  `STAGING_SUPABASE_URL`, `STAGING_SUPABASE_ANON_KEY`, `STAGING_SUPABASE_SERVICE_ROLE_KEY` are set; refuses prod).
- The RLS suite was mutation-checked: weakening the read or write policies makes 5 / 2 tests fail.

## Verify
1. `npm run test:db` — 15 pass, 3 skipped (staging).
2. Optional, against a staging project: `supabase db push` there, export the three STAGING_* vars, rerun.
3. After deploying (`supabase db push` on prod): B2C sign-in, resume analysis and voice interview behave as before;
   in SQL editor `select * from organizations` is empty.

## Security note for later steps
Edge functions use the service-role key, which bypasses RLS. Every B2B function must resolve the caller's
org role via `org_role_of` semantics before touching org data; each gets its own tests.
