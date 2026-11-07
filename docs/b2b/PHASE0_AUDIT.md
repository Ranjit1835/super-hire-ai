# HiResume B2B — Phase 0 Audit (against `HIRESUME_B2B_SPEC.md`)

_2026-10-29 · branch `feat/b2b-hardening` (from `design/b2b-redesign` @ 45f34ef, PR #5) · read-only audit, no code changed in this phase_

Status key: **Done** (evidence) · **Partial** · **Missing** · **Broken** · **Differs** (built deliberately another way; needs your call).
Severity: **P0** security / data leak / blocker · **P1** requirement broken · **P2** quality.

---

## 1. Baseline (R4.1)

| Check | Result | Evidence |
|---|---|---|
| Unit + UI + DB (PGlite RLS) tests | **795 passed**, 3 skipped (90 files) | `npx vitest run` |
| Strict B2B types | clean | `npm run typecheck:b2b` (tsconfig.b2b.json) |
| App-wide types | 25 errors, all pre-existing B2C (`Dashboard.tsx`, `Leaderboard.tsx`, Studio) | `tsc -p tsconfig.app.json` |
| Lint | 132 errors repo-wide, **0 in B2B** | `eslint .`, `eslint src/b2b src/features/b2b` |
| Edge functions (Deno) | all `b2b-*` pass `deno check` | `npx deno check supabase/functions/b2b-*/index.ts` |
| Production build | ok | `vite build` |
| B2C Playwright smoke | passes in CI (`e2e` job) | `e2e/b2c.spec.ts`, CI run on 3287f63 |

## 2. Facts that differ from the spec's assumptions

| Spec assumes | Repo reality | Impact |
|---|---|---|
| Next.js | **Vite + React SPA** + Supabase edge functions (Deno) | "server actions / API routes" = edge functions + SECURITY DEFINER SQL. Fine, but every server-side check lives there. |
| Claude API | **Gemini** via an AI gateway (`supabase/functions/_shared/ai-gateway/gemini.ts`); B2C migrated Anthropic → Gemini (commit e294dee) | R6.2/R6.3/R6.4 (Claude prompt caching, Haiku/Sonnet routing, Message Batches) don't apply as written. Decision D1. |
| Production is separate from a staging project | One Supabase project `zhfahrrxuguagwbujkiz` = production. Two other projects exist on the account (`csdfwrmrdralczdpjofg`, `heyrjrdwhxuwatzxpxmi`), purpose unknown. Local Supabase needs Docker (not installed). | Spec §0: "If no non-production project exists, stop and ask me." Decision D2. |
| Supabase Auth session controls usable | Single-session / inactivity / time-box are **Pro plan and up** (supabase.com/docs/guides/auth/sessions); project is on **Free** | R1.6 must be built in the app, or upgrade. Decision D3. |
| B2B is dark in prod | The pilot B2B functions answer in prod (`b2b-interview` returns `BAD_REQUEST`, not `B2B_DISABLED`), so the `B2B_ENABLED` secret is set. PR #1 (lockdown) isn't merged. | The P0 below is reachable in production today. |

## 3. P0 / P1 issue list

### P0
1. **Plan prices readable by every TPO/staff member — live in production.** RLS `"Read plans"` lets org staff read their plan row, including `price_inr_per_student` (`supabase/migrations/20260923000002_b2b_plans.sql:49-55`; prices seeded in `20260926000001_b2b_plan_prices.sql:5-7`). Any staff user can `GET /rest/v1/plans`. Violates R3.1. _Fix:_ restrict `plans` to super admin; expose features to staff through a definer function without monetary/tier fields. Needs a prod migration → your approval.
2. **Tier name and credit balance readable by students.** `"Members read own org"` (`20260923000001_b2b_tenancy.sql:126-127`) lets every member — students included — read the whole `organizations` row (`plan_id` = tier name like `basic`/`pro`, `credits_balance`, `settings`). R3.1 forbids tier names to TPOs/students; R1.9 forbids monetary values to TPOs. _Fix:_ narrow column exposure via a view/definer function; students get name/logo only.

### P1
3. **Seat cap bypassed by single add.** Bulk import counts and locks (`20261021000008_b2b_v1_college.sql:103-105, 189`), but the manual "Add student" is a plain RLS insert with no seat check (no trigger on `students`). R1.3.
4. **Deactivating frees a seat.** Seats used = `status <> 'deactivated'` (`20261021000008_b2b_v1_college.sql:105`). R1.4 says a seat with ≥1 counted session is never freed except by super admin.
5. **No per-login counted sessions.** Credits are charged per activity (practice attempt `20261021000006_b2b_v1_assessment.sql:411`, candidate session `20261021000010_b2b_v1_startup.sql:354`), not per login. No session ledger, idle/absolute expiry or one-device rule for B2B. B2C sign-in allows **2** active sessions (`supabase/functions/auth-signin/index.ts:90-103`). R1.5, R1.6.
6. **Org admins can create org admins and change roles.** `b2b_invite_staff` lets an org admin invite any staff role incl. `org_admin` (`20261021000001_b2b_v1_tenancy.sql:403-410`); the memberships UPDATE policy lets them change `role` (`20260923000001_b2b_tenancy.sql:158-161`). R3.3 says only Super Admin.
7. **No MFA for super admin; audit log covers table changes, not before/after of every admin action.** No `aal2`/MFA anywhere. Audit triggers exist (`audit_*` in v1 migrations). R3.5.
8. **Retention promised, not implemented.** Consent text promises deletion after the retention period (`supabase/functions/_shared/company-logic.ts:27-28`, default 90 days), but no scheduled job deletes proctoring snapshots, transcripts or events (only interview-expiry and evaluation-sweep crons exist). R5.5 / DPDP.
9. **Voice stack is the browser Web Speech API** (`src/lib/speech.ts`, `src/features/b2b/hooks/useVoiceAnswer.ts`): accent, STT accuracy and latency vary by browser/OS. R5.2/R5.3 require replacing it. No barge-in or streaming TTS.
10. **B2B users can reach B2C upsells.** The V1 shell's "Back to HiResume" goes to `/dashboard` (B2C, with paywalls/pricing) (`src/b2b/layout/V1Shell.tsx`, ShellTab bar). R3.2.
11. **No plagiarism detection** (code or MCQ). R2.8.
12. **Paper uniqueness not enforced.** Per-student seeded random draw exists (`20261021000006_b2b_v1_assessment.sql:205-270`), but no overlap target (≤10%), no pool-size check vs batch size, no parameterized MCQ templates or coding variants, no exposure tracking. R2.1–R2.3.

### P2
13. Migrations have no down/rollback scripts (R4.4 "every migration reversible").
14. No low-credit / plan-expiry alerts to super admin (R1.9).
15. Bulk import shows rejected rows on screen (first 200) but has no downloadable rejected-rows report (R1.2) (`src/b2b/college/ImportPage.tsx:224`).
16. Proctoring lacks identity continuity, iris-based gaze, second-speaker/whisper detection and object/phone detection (R5.4); has head pose, face count, VAD energy, tab/fullscreen/screen-share/devtools/multi-display.
17. Evaluation dimensions differ from R5.6 (no "project ownership"; has clarity/confidence and code walkthrough) (`supabase/functions/_shared/interview-v1/evaluation.ts:17`).

## 4. Traceability matrix

| ID | Status | Evidence | Gap → plan | Effort |
|---|---|---|---|---|
| R1.1 Plans | Partial | `plans` table + `super_update_org`, `seat_limit`, validity (`20261021000001_b2b_v1_tenancy.sql:117-157`) | Per-feature quotas only for interviews; price leaks (P0-1) | M |
| R1.2 No self-registration | Done / Partial | Students only via import or invite token (`b2b_accept_invite`); CSV row validation + dedupe (`src/b2b/college/lib/import.ts`) | Downloadable rejected-rows report (P2-15) | S |
| R1.3 Seat cap atomic | Partial | Import locks + counts (`…_college.sql:103-212`) | Single add bypass (P1-3): trigger with org-row lock | S |
| R1.4 No seat recycling | Broken | `status <> 'deactivated'` count | Count seats ever used (needs R1.5 ledger) | S |
| R1.5 Per-login session counted | Missing | — | Session ledger + charge at login via edge function | L |
| R1.6 Session definition | Missing | Pro-only Auth controls; B2C allows 2 sessions | App-level: session id in ledger, heartbeat idle 30 min / absolute 8 h, newest-wins | L |
| R1.7 Atomic, idempotent credits | Done (per activity) | `b2b_consume_credits` single UPDATE + unique `(org, ref_type, ref_id)` consume index (`…_v1_tenancy.sql:250, 280-312`); ledger insert-only for clients | Key on `session_id + reason` once R1.5 exists | S |
| R1.8 Activity costs & quotas | Partial | `candidate_session_credits` setting (`…_startup.sql:167`); practice 0.25 hard-coded (`…_assessment.sql:411`); `usage_counters` | Super-admin cost table per activity; per-student feature quotas | M |
| R1.9 Visibility | Partial | TPO sees credits/seats (`CreditsTag`), no money | Alerts missing (P2-14); tier/credits readable by students (P0-2) | S |
| R1.10 Metering | Done (LLM) | `b2b_usage_log` via gateway (tokens, cost, org, user) (`20261021000003_b2b_v1_ai_gateway.sql`) | Speech is browser-side → not metered (changes with D4) | S |
| R2.1 Different papers | Partial | Seeded per-student draw + option shuffle | Overlap target, pool check, super-admin override (P1-12) | L |
| R2.2 Bank & blueprint | Partial | Tagged bank + section pick rules; builder draw check (`src/b2b/bank/forms.ts:244`) | Parameterized MCQ templates, coding variants, pool-size calculator | L |
| R2.3 No LLM at exam time | Partial | Generation is staff-side (`assessApi("generate…")`); coding verified by reference solution in Judge0 (`b2b_record_verification`) | Independent MCQ validation pass; exposure count + retirement; Batch API (see D1) | M |
| R2.4 Nothing secret on client | Done | Candidate payload has no answers / only sample tests (`…_assessment.sql:478-496`); hidden test I/O never stored (`_shared/judge0.ts:222-228`); server deadline + autosave queue | One-question-at-a-time / no back-nav option missing | S |
| R2.5 Sandbox | Partial | Judge0 client (`_shared/judge0.ts`), rate-limited runs | Judge0 not provisioned in prod (droplet pending); security config to verify | M + ops |
| R2.6 High proctoring | Done / Partial | Fullscreen, copy/paste/right-click, paste size (`large_paste`), entire-screen check (`displaySurface === "monitor"`), `screen.isExtended`, Chromium/desktop check (`src/b2b/proctor/systemCheck.ts`), per-assessment `strict_max_violations` | Thresholds per org (now per assessment); warn → final → submit ladder | S |
| R2.7 Code playback | Partial | `edit_history` captured by autosave (`…_core.sql`, runner `EditEvent`) | Reviewer replay UI; "sudden full solution" flag | M |
| R2.8 Plagiarism | Missing | — | Evaluate Dolos / JPlag / copydetect (D6) | L |
| R3.1 No pricing outside SA | **Broken (P0)** | see P0-1, P0-2 | Lock RLS + bundle grep test | S |
| R3.2 No B2C upsells | Broken | V1 shell links to B2C `/dashboard` | B2B-only home; hide B2C nav for B2B-only users | S |
| R3.3 Only SA grants TPO | Differs (P1-6) | org admin can invite org_admin / edit roles | Restrict to super admin (D7) | S |
| R3.4 Roles not in user_metadata | Done | No role/org reads from `user_metadata` (grep); roles in `org_memberships` + `user_roles` under RLS | — | — |
| R3.5 SA hardening | Partial | Audit triggers on orgs, memberships, plans, invites, students, drives, assessments… | MFA (aal2) for super admin; before/after on every admin RPC | M |
| R3.6 Tenant isolation | Done (tested) | PGlite RLS suites (`supabase/tests/rls/*.test.ts`, e.g. tenancy "org admin of A vs org B"); module tenant guard (migration 0013) | Add per-endpoint IDOR tests for every edge action | M |
| R4.1 Baseline | Done | §1 | Run B2C smoke every phase | — |
| R4.2 Additive only | Done | B2B tables/routes separate; B2C untouched in PR #5 | — | — |
| R4.3 Shared code | Partial | Shared interview engine/prompts changed in #6 (B2C-safe, tested) | Keep listing per change | — |
| R4.4 Ship dark / reversible | Partial | `VITE_B2B_ENABLED` + `B2B_ENABLED` flags | Prod secret currently **on** (§2); no down migrations | S |
| R4.5 Email collision | Partial | Invite accept links an existing account (`b2b_accept_invite`) | Written policy (D5) | S |
| R5.1 Human-like interviewer | Partial | Sections, follow-ups, opening by first name, closing line (`_shared/interview-v1/*`) | Named persona, repeat/silence handling, Indian-English phrasing pass, "any questions for me?" | M |
| R5.2 Turn-taking & latency | Partial | Turn latency measured (p50/p95) | Streaming STT→LLM→TTS, barge-in, <1 s target (D4) | L |
| R5.3 Indian English voice | Missing | Web Speech API | Vendor choice (D4) | L |
| R5.4 Proctoring engine | Partial | `src/b2b/proctor/*` (face count, head pose, VAD, browser signals, snapshots, integrity score) | Identity continuity, iris gaze, second speaker, object detection; AI-voiced warnings | L |
| R5.5 Consent & privacy | Partial | Consent screens + versioned consent rows; private bucket + signed URLs | Retention deletion job (P1-8); deletion-on-request flow | M |
| R5.6 Evaluation | Done / Differs | Rubric + verified quotes + fixed-rule band (`interview-v1/evaluation.ts`) | Align dimensions (P2-17) | S |
| R6.1 Instrument everything | Partial | Gateway logs tokens/cost/latency/org/user; super-admin cost pages | Speech not metered; per-day/per-student views | M |
| R6.2 Prompt caching | Differs | Response cache `ai_cache` (`…_ai_gateway.sql:44`); Claude prompt caching N/A on Gemini | D1 | — |
| R6.3 Model routing | Differs | Gemini models via gateway config | D1 + small evals | M |
| R6.4 Batch API | Missing | — | D1 | M |
| R6.5 No LLM where code works | Done | MCQ grading, Judge0, proctoring, credits are deterministic | — | — |
| R6.6 Output control | Partial | JSON schema outputs; `maxTokens` per feature (`_shared/ai-gateway/config.ts`) | Verify per feature | S |
| R6.7 App-level caching | Partial | `ai_cache` keyed by input hash | Pre-synthesized TTS lines (with D4) | S |
| R6.8 Bounded context | Done | Turn prompt sends last 6 turns (`interview-v1/prompts.ts`) | Checkpoint summaries for long interviews | S |
| R6.9 Guardrails | Partial | Run rate limit, quota counters, client turn-id dedupe, idempotent openings | Org token budgets, cost-spike circuit breaker | M |
| R6.10 Unit economics | Missing | — | Report after D1/D4 | S |

## 5. Decisions for you

- **D1 — LLM provider.** The spec is written for Claude (prompt caching, Haiku/Sonnet routing, Message Batches). The code runs on Gemini through a gateway that could take a second provider. Options: (a) stay on Gemini and map R6 to Gemini's context caching / batch mode; (b) move B2B to Claude per the spec; (c) route per task through the gateway. _Recommendation:_ (c), deciding per task from a small eval, starting with the evaluator and question generation, where batch and caching pay most. Pricing must be checked against the current docs before choosing.
- **D2 — Where to build and test.** There's no staging project I can confirm, and Docker isn't installed. Options: (a) install Docker and use local Supabase; (b) designate one of the two other Supabase projects as staging; (c) rely on the PGlite suites only (they run migrations but not edge functions, Auth or Storage). _Recommendation:_ (b), plus (c) in CI. I need you to confirm which project is safe to use.
- **D3 — Sessions (R1.5/R1.6).** Supabase's session controls need the Pro plan. Options: (a) upgrade to Pro and use single-session plus inactivity timeout, adding the counted-session ledger in the app; (b) build it all in the app: a session ledger row at login, a heartbeat, 30-minute idle and 8-hour absolute expiry enforced on every B2B call, and newest login wins. _Recommendation:_ (b). It works on any plan and is fully testable, and Pro features can be layered on later.
- **D4 — Voice stack.** Compare Sarvam (Bulbul en-IN TTS and STT), Azure Speech en-IN, Deepgram and ElevenLabs, with LiveKit Agents or Pipecat for turn-taking. This needs a current pricing and latency check and a short listening test with Indian-accented speakers. _Recommendation:_ I research it and bring a cost-per-minute table before any build.
- **D5 — Email collision (R4.5).** _Recommendation:_ link to the same login but keep separate contexts. B2B membership is a row in `org_memberships`, and B2C plans and credits are never read or written by B2B code. Show a notice at invite acceptance ("This account is also your personal HiResume account"). The alternative is rejecting the invite and asking for another email, which is worse for students who already use HiResume.
- **D6 — Plagiarism engine.** Evaluate Dolos (MIT, AST-based, has a library) against JPlag (Java service) and copydetect (Python, winnowing). _Recommendation:_ Dolos, run asynchronously from a worker, because edge functions can't run it.
- **D7 — R3.3 versus the current design.** Org admins currently invite other org admins and trainers. Options: only the super admin creates org admins (org admins can still add trainers and recruiters), or super admin only for all staff. _Recommendation:_ the first; it matches the spec's intent without making you onboard every trainer.
- **D8 — The P0 price leak is live in production.** The spec says never deploy. Options: (a) I prepare a one-migration hotfix (`plans` readable by super admin only) as its own PR for you to apply; (b) turn off the production `B2B_ENABLED` secret until Phase 1 ships. _Recommendation:_ (a) now, and also (b) if no college is using the pilot yet.

## 6. Production readiness of what exists today

**NO-GO for B2B in production.**

**Blockers:**
- **Pricing leaks:** P0-1 and P0-2 break R3.1.
- **The core commercial model is missing:** per-login session counting and the seat rules (R1.3–R1.6).
- **Voice interviews rely on the browser's built-in speech:** R5.3.
- **Retention isn't enforced** even though consent promises it.
- **Production state:** migrations 0006–0015 have never been applied there, and Judge0 isn't provisioned.

What is solid and can carry forward:
- **Access control:** every table has row-level rules, all 124 privileged functions are locked down by default, tenant links are consistent, and 795 tests pass.
- **Exam integrity:** no secrets reach candidates.
- **Credits:** atomic per-activity charging.
- **Evaluation:** evidence-backed and verified.
- **Proctoring:** the browser-side engine.
- **The redesigned portals.**

B2C is unaffected. The only production change today was PR #6, the prompt-forging fix, which was tested and verified.
