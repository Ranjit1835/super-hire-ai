# Step 4 — Modules and company packs

## What changed
- `supabase/migrations/20260923000004_b2b_modules.sql`
  - `interview_modules`: `spec` JSONB `{ name, type: skill|company_pack|hr, description?, topics[], pass_threshold,
    max_turns, max_minutes, style_notes? }`, validated by `b2b_valid_module_spec()` (CHECK). `name`/`type` are
    generated columns for filtering. `org_id NULL` = HiResume library template.
  - `version` bumps on every spec change (Step 5 interviews will snapshot spec + version, so results always
    reference the exact rubric they were run with). `org_id` is immutable. Archive (`is_active=false`) instead of
    delete keeps history.
  - **Company packs are gated by plan in the database**: creating, re-typing or re-activating a pack in an org whose
    plan lacks `company_packs_enabled` is refused (`PLAN_FEATURE`); students on such a plan can't read pack modules
    even if one exists from before a downgrade.
  - RLS: library visible to anyone in an institution (not plain B2C users), edited only by super-admin; staff see all
    their org's modules; students see only active ones; only org admins write their own org's modules.
  - Seeded library (11): Java Fundamentals, Advanced Java, Python Fundamentals, SQL, DSA Basics, HR / Behavioral,
    and TCS / Infosys / Wipro / Accenture / Cognizant **"-style fresher round (practice)"**. Each pack's description
    says "Unofficial practice … Not affiliated", its style notes tell the interviewer "Do not claim to represent …",
    and no pack has a "Why <company>" topic — it's "Motivation for joining a service/consulting company".
- `supabase/functions/_shared/module-spec.ts` — the same rules in TS (normalise + per-field errors), shared by the
  admin form and the Step 5 engine. A test asserts every seeded spec passes it unchanged.
- UI
  - `/org/:orgId/modules` — "Modules for your students" (edit / archive / restore, show archived) and the library
    grouped by type with "Enable for students" (copies the template; shows "Enabled" once added). Packs show the
    disclaimer and, on Basic, "Included in Pilot and Pro plans".
  - `/org/:orgId/modules/new` and `/:moduleId` — editor: name, type, short description, topics (Enter or paste a
    comma list, de-duplicated, reorder, remove), questions / minutes / pass mark with a "time per question" hint,
    interviewer style notes. Field-level errors; DB errors mapped to plain English.
  - `/learn` — students see enabled modules with description, questions, minutes, pass mark and topics.
    The Start button arrives with the interview engine (Step 5).
- Tests: `supabase/tests/rls/modules.test.ts` (16, mutation-checked), `supabase/tests/unit/module-spec.test.ts` (3),
  UI tests for library enable, plan lock, trainer read-only, editor validation/save, student list.

## Verify
1. `npm test`.
2. Deploy: `supabase db push`.
3. As org admin (Pilot): Modules → Enable "SQL" and "TCS-style fresher round (practice)" → both appear under
   "Modules for your students"; library cards say "Enabled".
4. Edit SQL → add a topic "Window functions" → Save. (Version goes to 2.)
5. Super-admin: switch the org to Basic → the TCS card on the library shows "Included in Pilot and Pro plans";
   a student on the org no longer sees the TCS module on `/learn`.
6. Student `/learn` lists the modules with topics.
