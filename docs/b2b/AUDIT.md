# HiResume B2B — Phase 0 Audit

> Read-only audit against `docs/b2b/hiresume-b2b-build-prompt.md`. Date: 2026-10-18.
> Branch at audit time: `fix/live-issues` (2 commits ahead of the stale local `main`). No code was changed.
> **Correction (2026-10-20):** finding 2 below was wrong. Those 2 commits were already on `origin/main`; the audit
> compared against an unfetched remote. Only the local `main` was behind. To be resolved by fast-forwarding `main` and tagging `live-2026-10-20`.
> **Update 2026-10-20:** decisions on every question in section 12 are recorded in the Decisions log at the top of
> `hiresume-b2b-build-prompt.md`. Cost model (section 9) re-verified on vendor pages, with break-even and a pooled-credits
> plan. Deploy path documented in section 13. B2B is switched off by default on branch `fix/b2b-lockdown`.
> Production checks were SELECT-only queries on Supabase project `zhfahrrxuguagwbujkiz`
> (table list, RLS flags, row counts, cron jobs, buckets, migration history).

---

## 0. Headline findings (read these first)

1. **The stack isn't the one the spec assumes.** It's a **Vite + React 18 SPA** (react-router 6, plus a custom
   pre-render step for SEO pages). It is **not Next.js**. The LLM is **Google Gemini** (`gemini-3.6-flash` through
   its OpenAI-compatible endpoint). It is **not Claude**: commit `e294dee` says "Anthropic billing is dead —
   migrated 2026-09". Sections 1, 6, 8 and 11 of the spec (Next.js route groups, `ssr: false`, Anthropic prompt
   caching, "Claude as the interviewer brain") need a decision from you before Phase 1. See Q1 and Q2.
2. **~~Production code doesn't match the repo.~~ (Wrong; see the correction at the top.)** The live voice-interview fix (`857c330`) and the Studio button
   fix (`8ed509e`) are deployed to hiresume.in, but they exist only on the local branch `fix/live-issues`. They
   aren't on `main` or on GitHub. Anyone branching from `main` would ship a regression. This should be merged
   first (Q3).
3. **A B2B pilot already exists, is live, and has no users yet.** Ten steps (tenancy, plans, CSV invites,
   modules, adaptive voice interview, evaluator, dashboard, demo, cost tracking, public test) were built
   2026-09-23/24, are deployed, and are reachable in production **without a feature flag**. Production has
   **0 organisations, 0 memberships, 0 B2B interviews and 0 usage-log rows**. That's good news: we can reshape
   the B2B schema with no customer data at risk.
4. **Most of the spec is net-new.** The pilot covers about 15–20% of it: tenancy/RLS, invites, consent records,
   a practice voice interview with an evaluator and evidence-quote checks, a TPO dashboard, and a cost log.
   **Nothing exists yet** for the coding/MCQ engine, Judge0, drives, startup portal, AI gateway
   (cache/dedupe/quotas), audit log, recording, the full proctoring engine, Playwright, or screenshot tests.
   Proctoring has a half-done WIP branch.
5. **Voice-to-voice can't meet the spec as built.** The two reported failures (mobile silence, and the
   interviewer looping on its own voice) were fixed and deployed on 2026-09-26 and 2026-09-29. But the design
   is browser Web Speech API plus one request/response edge-function call per turn. It has no streaming, no
   barge-in and no audio recording, and the estimated turn gap is about 4–8 s against a 1.5 s target.
   **It doesn't depend on WebSockets inside serverless functions**, so that failure mode isn't the cause.
   Phase 5 needs a persistent realtime component (section 6).
6. **Costs are being under-recorded.** The `b2b_pricing` seed uses the Gemini 2.5 Flash list price
   ($0.30/$2.50 per 1M tokens) and ₹84/USD. The model actually used is `gemini-3.6-flash` at **$0.75/$3.75**
   (**doubling to $1.50/$7.50 on 1 Jan 2027**), and the rupee is about **₹95/USD**. Logged LLM cost would read
   about 2.5–3× too low. No rows exist yet, so nothing is wrong today.
7. **Pilot prices may be under cost.** Basic is ₹149 and Pro ₹299 per student per year. With a real voice
   stack, one proctored drive plus 4 practice interviews costs about ₹281 per student per year in variable
   cost alone (section 9). Practice quotas are the main lever.

---

## 1. Stack map

| Area | What's there | Key files |
|---|---|---|
| Frontend | React 18.3, TypeScript 5.8, Vite 5.4 (SWC), react-router-dom 6.30, Tailwind 3.4 + shadcn/ui (Radix), framer-motion 12, TanStack Query 5, react-hook-form + zod 3, recharts, exceljs, pdf-lib, pdfjs-dist | `src/App.tsx` (all routes), `src/main.tsx`, `vite.config.ts` |
| SEO pre-render | `build` = SPA build + SSR build of `src/entry-server.tsx` + `scripts/prerender.mjs`. Writes static HTML for public pages and 8 blog posts. `scripts/html-structure.mjs` fails the build on HTML the parser would reshape. App routes get a no-index shell. | `src/seo/*`, `scripts/prerender.mjs` |
| Router model | One flat `<Routes>` in `App.tsx`. B2B uses a nested `OrgLayout` under `/org/:orgId`. No route groups or layouts per surface beyond that. | `src/App.tsx:88-136` |
| Auth | Supabase Auth: email/password + custom email OTP (`send-otp`/`verify-otp` via Resend), Google OAuth (`/auth/callback`), password reset. `ProtectedRoute` on the client. Super-admin = `user_roles.role = 'admin'`. | `src/contexts/AuthContext.tsx`, `src/components/ProtectedRoute.tsx`, `supabase/functions/auth-signin` |
| Database | Supabase Postgres. **38 migrations, all 38 applied in prod** (latest `20260926000002`). 34 public tables, **RLS on for all 34** (section 4). | `supabase/migrations/*` |
| Storage | One private bucket, `resumes` (per-user folder policy). No B2B buckets. | migration `20260215160118_…` |
| Edge functions | 27 Deno functions. All have `verify_jwt = false` and do their own auth checks. B2C: analyze-resume, auth-signin, check-fix-access, claim-guest-analysis, create-payment-order, enhance-resume, fix-resume, get-guest-analysis, mock-interview, razorpay-webhook, referral, send-otp, verify-otp, verify-payment, weekly-stats (UI retired), studio-* (7). B2B: b2b-invites, b2b-interview, b2b-evaluate, b2b-public-test. | `supabase/functions/*`, `supabase/config.toml` |
| Cron | pg_cron (7 active jobs): expire-early-bird-subscriptions, clean-login-attempts, reset-monthly-resume-counts, expire-stale-b2b-interviews (15 min), b2b-evaluation-sweep (5 min, via pg_net + Vault secret), delete-old-guest-analyses, prune-public-test-attempts | migrations `…0002_schedule_early_bird…`, `…0006`, `…0004_schedule_evaluation_sweep…`, `20260926000002` |
| LLM (B2C) | `_shared/ai.ts`: Gemini through the OpenAI-compatible endpoint. `MODEL_FAST`/`MODEL_SMART` both default to `gemini-3.6-flash`. Tool-call JSON output, retries on 429/5xx, `reasoning_effort` knob. Used by analyze-resume, enhance-resume, fix-resume, mock-interview, studio-chat, studio-parse-resume. Shared honesty rule in `_shared/resume-honesty.ts`; emoji stripping in `_shared/no-emoji.ts`. | `supabase/functions/_shared/ai.ts` |
| LLM (B2B) | `_shared/b2b-llm.ts`: same provider, separate client with per-call timeout, bounded retries, usage and latency returned for cost logging. `B2B_INTERVIEW_MODEL`, `B2B_EVALUATOR_MODEL`, `B2B_REASONING_EFFORT`. Prompts in `_shared/interview-prompts.ts`, `_shared/evaluator.ts` (`evaluator-2026-09-v1`), `_shared/interview-opening.ts`. | `supabase/functions/_shared/b2b-llm.ts` |
| Claude API | **Not used anywhere.** Spec section 1 assumes it. | — |
| Payments | Razorpay, INR only: `create-payment-order`, `verify-payment` (HMAC), `razorpay-webhook`. Plans in `src/config/pricing.ts`. | `supabase/functions/create-payment-order` etc. |
| Email | Resend (OTP, B2B invites). **hiresume.in is not verified in Resend**, `B2B_EMAIL_FROM` is unset, and the domain has **no MX records**. | `_shared/invite-email.ts` |
| Hosting | **Vercel** (`vercel.json`: cleanUrls, SPA rewrite to `/app`, immutable assets). `netlify.toml` is left over from an earlier host. Domain `hiresume.in` (live, HTTP 200). | `vercel.json`, `.vercel/project.json` |
| Environments | **Production only.** No staging project (decided 2026-09-24). The DB tests use embedded Postgres (PGlite) instead. | — |
| Tests | Vitest 3 + jsdom + Testing Library. **51 files / 370 tests pass, 3 skipped** (2026-10-18). DB/RLS tests run on PGlite against the real migrations (`npm run test:db`, 21 files). Staging API tests skip themselves when no staging env vars are set. **No Playwright, no screenshot tests, no E2E.** | `vitest.config.ts`, `supabase/tests/*` |
| Type checking | `tsconfig.app.json` has **`strict: false`**, `noImplicitAny: false`. `tsc -p tsconfig.app.json --noEmit` → **25 errors**. Edge functions are type-checked separately with `npx deno check`. | — |
| Lint | ESLint 9 flat config, typescript-eslint. **132 errors, 27 warnings**: supabase/functions 53, src/pages 35, src/features 23, src/components 18, other 3. Mostly `no-explicit-any`. No Prettier config. | `eslint.config.js` |
| Observability | **None.** No Sentry/PostHog. `console.log` in edge functions only (Supabase logs). | — |
| Security headers | **No CSP or security headers** (only an asset cache header). | `vercel.json` |
| Rate limits | `login_attempts` (auth), per-feature checks in AI functions, hashed IP/phone attempts for the public test. CAPTCHA for the public test is **still pending**. | migrations `20260401000001`, `20260923000011` |

### Env var names (names only)

- **Client (Vite):** `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID`
- **Edge functions:** `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`,
  `HIRESUME_MODEL_FAST`, `HIRESUME_MODEL_SMART`, `ANALYZE_REASONING_EFFORT`, `B2B_INTERVIEW_MODEL`,
  `B2B_EVALUATOR_MODEL`, `B2B_REASONING_EFFORT`, `B2B_HASH_SALT`, `B2B_CRON_SECRET`, `B2B_EMAIL_FROM` (unset),
  `APP_BASE_URL`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RESEND_API_KEY`
- **Scripts/tests:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `STAGING_SUPABASE_URL`, `STAGING_SUPABASE_ANON_KEY`,
  `STAGING_SUPABASE_SERVICE_ROLE_KEY`
- **Vault:** `b2b_cron_secret` (read by the evaluation-sweep cron)

---

## 2. B2C feature inventory (frozen surface)

| Feature | Routes | Key files | Backend | Status |
|---|---|---|---|---|
| Landing + marketing | `/`, `/pricing`, `/about`, `/college-placement`, `/blog`, `/blog/:slug` | `src/pages/Landing.tsx`, `src/components/landing/*`, `src/content/blog/*` | — (pre-rendered) | Working |
| Auth | `/auth`, `/auth/callback`, `/verify-otp`, `/reset-password` | `src/pages/Auth.tsx`, `OtpVerification.tsx` | auth-signin, send-otp, verify-otp | Working |
| Resume analyzer | `/dashboard`, `/analysis/:id` | `src/pages/Analysis.tsx`, `src/lib/pdf-text.ts` | analyze-resume (`resume_score_cache`) | Working |
| Guest analysis | `/analysis/guest/:token` | `GuestAnalysis.tsx`, `src/hooks/useGuestResumeUpload.ts` | get-guest-analysis, claim-guest-analysis | Working (deleted after 7 days) |
| ATS checker | `/ats-checker` | `ATSChecker.tsx` | analyze-resume | Working |
| Fix my resume (paid) | `/fix/:id` | `FixResume.tsx`, `src/lib/ats-pdf.ts` (5 ATS templates) | fix-resume, check-fix-access | Working |
| Resume builder | `/build-resume` | `ResumeBuilder.tsx`, `src/components/resume-builder/*` | enhance-resume | Working |
| Resume Studio | `/studio`, `/studio/:resumeId`, `/studio/shared/:shareToken` | `src/features/studio/*` | studio-* (7) | Working, except **"Download PDF" is a TODO stub** (`StudioPage.tsx:90`) |
| Voice mock interview | `/voice-interview` (`/mock-interview` redirects here) | `src/pages/VoiceInterview.tsx`, `src/lib/speech.ts`, `src/components/interview/*` | mock-interview (`interview_sessions`) | Working after the 2026-09-29 fix; needs phone confirmation |
| Payments | dialogs on several pages | `src/components/PaymentDialog.tsx`, `src/config/pricing.ts` | create-payment-order, verify-payment, razorpay-webhook | Working |
| Referrals, leaderboard | `/leaderboard`, dashboard widget | `ReferralWidget.tsx`, `Leaderboard.tsx` | referral | Working |
| Retired | `/weekly-stats` → `/dashboard`, `/reels-campaign` → `/` | — | weekly-stats (still deployed, no UI) | Unused |

---

## 3. Existing B2B work: files, routes, tables, migrations, branches

### 3.1 Migrations (all applied to prod)

| Migration | Contents | Status |
|---|---|---|
| `20260923000001_b2b_tenancy` | `organizations`, `batches`, `org_memberships`, enums `org_type (college, coaching_institute)`, `org_member_role (org_admin, trainer, student)`, helpers `is_super_admin`, `is_org_*` | Done |
| `…0002_b2b_plans` | `plans` (pilot/basic/pro), `org_student_usage`, atomic `consume_interview_credit` | Done |
| `…0003_b2b_invites` | `org_invites` (hashed token, 30-day expiry), `org_consents` (version + exact text), import/accept/rotate/revoke functions | Done |
| `…0004_b2b_modules` | `interview_modules` (validated spec JSONB, library of 11 templates) | Done |
| `…0005/0006` | `b2b_interviews`, `b2b_interview_turns`, engine functions, expiry cron | Done |
| `…0007_b2b_evaluations` | `b2b_evaluations` | Done |
| `…0008_b2b_dashboard` | `org_dashboard_evaluations()` | Done (aggregation happens client-side; see gap 5.8) |
| `…0009_b2b_demo` | `b2b_demo_reset()` | Done (no demo org seeded in prod right now) |
| `…0010_b2b_costs` | `b2b_usage_log`, `b2b_pricing`, cost reports | Done, but **pricing seed is stale** (headline 6) |
| `…0011_b2b_public_test` | `org_leads`, `b2b_public_test_attempts`, `public_test_info()`, `b2b_start_public_test()` | Half-done (CAPTCHA pending) |
| `20260924000003/4` | Evaluation retry + 5-min sweep cron | Done |
| `20260924000005` | `institution_enquiries` | Done |
| `20260926000001` | Plan prices (pilot free 30 days / ≤150, basic ₹149, pro ₹299 per student per year) | Done |

### 3.2 Edge functions and shared modules

| File | Status |
|---|---|
| `b2b-invites` (import/resend/revoke/preview/register/accept) | Done. **Email delivery blocked** until the Resend domain is verified. Invite links can be copied or exported as CSV. |
| `b2b-interview` (start/turn/end) | Done. Voice only since 2026-09-29. |
| `b2b-evaluate` (+ sweep) | Done |
| `b2b-public-test` | Half-done (CAPTCHA) |
| `_shared/interview-engine.ts` (adaptive state machine: difficulty, topic coverage, per-topic caps, time-box) | Done. Close in spirit to spec section 6's state machine; reusable. |
| `_shared/evaluator.ts` (zod-like validation, verbatim evidence-quote check, retry) | Done. Reusable for spec section 6 evaluation. |
| `_shared/audio-metrics.ts` (WPM, pauses, fillers from timings) | Done (limited by browser STT) |
| `_shared/invite-csv.ts`, `module-spec.ts`, `b2b-consent.ts`, `b2b-http.ts`, `lead.ts`, `invite-email.ts` | Done |

### 3.3 Frontend (`src/features/b2b/*`), live with **no feature flag**

| Route | Page | Status |
|---|---|---|
| `/admin/orgs`, `/admin/costs`, `/admin/enquiries` | SuperAdminOrgs / Costs / Enquiries | Done (plain UI) |
| `/org`, `/org/:orgId` (+ dashboard, students/:userId, modules, modules/:moduleId, invites, leads, import) | OrgLayout + 8 pages | Done |
| `/learn`, `/learn/interview/:moduleId`, `/learn/report/:interviewId` | LearnHome, InterviewRoom, StudentReport | Done |
| `/invite/:token` | InviteAccept | Done |
| `/test/:slug` | PublicTest | Half-done (CAPTCHA) |
| `/dev/b2b-demo/*` | DemoPreview | Dev-only (`import.meta.env.DEV`), unused in prod |

### 3.4 Scripts and docs

- `scripts/b2b-demo.ts` + `demo-lib.ts`: demo college generator (40 students, about 120 interviews). Done; **not currently seeded in prod**.
- `scripts/b2b-calibrate.ts` + `calibration-lib.ts`: evaluator calibration. Done.
- `scripts/b2b-load-test.ts`: **never run** (needs staging, and none exists).
- `docs/b2b/step-1…10-*.md`: per-step notes. Accurate.

### 3.5 Branches

| Branch | Ahead of `main` | Status |
|---|---|---|
| `fix/live-issues` (current) | 2 (`8ed509e`, `857c330`) | Live in prod and already on `origin/main` (local `main` was stale). Merged 2026-10-20. |
| `feat/proctoring` | 1 (`294381e`, WIP) | Half-done. About 1,500 lines: MediaPipe FaceLandmarker (CDN WASM, about 10 fps, main thread), gaze features, an incident rules engine (gaze_away, no_face, multiple_faces, tab_hidden, window_blur, fullscreen_exit; flag after 3 warnings), `proctoring_sessions`/`proctoring_events` migration with RLS, tests. Branched **before** the voice fix, so it will conflict in `InterviewRoom.tsx`. Migration **not applied**. Salvageable for Phase 4: the rules engine, gaze and detector code, and the RLS tests. The schema needs to change to the spec's `proctoring_events` (severity, confidence, evidence path, review status). |
| `feat/b2b-pilot`, `feat/ats-templates`, `feat/enquiries`, `feat/home-trim`, `feat/honest-copy`, `feat/seo`, `feat/speed-and-results`, `feat/ui-fixes`, `fix/navigation`, `fix/studio-no-emoji`, `fix/voice-interview` | 0 | Already merged; can be deleted (ask first) |

---

## 4. DB schema snapshot (production, 2026-10-18)

All 34 public tables have **RLS enabled**. Policy counts and row counts are from `pg_policies` and
`count(*)`/`reltuples`. Tables with 0 policies are deny-all and reachable only through SECURITY DEFINER
functions or the service role. That's intentional.

| Table | Domain | RLS | Policies | Rows (approx.) |
|---|---|---|---|---|
| profiles | B2C | on | 3 | 121 |
| user_roles | B2C/admin | on | 1 | 107 |
| user_sessions | B2C | on | 2 | — |
| otp_codes | B2C | on | 1 | — |
| login_attempts | B2C | on | 0 | 3 |
| payments | B2C | on | 1 | — |
| referrals | B2C | on | 1 | — |
| leaderboard_entries | B2C | on | 2 | — |
| resume_analyses | B2C | on | 3 | 164 |
| resume_score_cache | B2C | on | 1 | 579 |
| guest_analyses | B2C | on | 1 | 127 |
| resume_builders | B2C | on | 4 | — |
| interview_sessions | B2C | on | 3 | 11 |
| studio_resumes | B2C | on | 4 | 44 |
| studio_sessions | B2C | on | 1 | 51 |
| studio_messages | B2C | on | 1 | 51 |
| studio_versions | B2C | on | 2 | — |
| studio_suggestions | B2C | on | 2 | 260 |
| institution_enquiries | B2B sales | on | 2 | 0 |
| organizations | B2B | on | 4 | 0 |
| batches | B2B | on | 4 | 0 |
| org_memberships | B2B | on | 4 | 0 |
| plans | B2B | on | 2 | 3 |
| org_student_usage | B2B | on | 1 | 0 |
| org_invites | B2B | on | 1 | 0 |
| org_consents | B2B | on | 1 | 0 |
| interview_modules | B2B | on | 4 | 11 |
| b2b_interviews | B2B | on | 1 | 0 |
| b2b_interview_turns | B2B | on | 1 | 0 |
| b2b_evaluations | B2B | on | 1 | 0 |
| b2b_usage_log | B2B | on | 1 | 0 |
| b2b_pricing | B2B | on | 2 | seeded |
| org_leads | B2B | on | 2 | 0 |
| b2b_public_test_attempts | B2B | on | 0 | 0 |

Storage buckets: `resumes` (private). Not present: audit log, platform_admins table (super-admin is
`user_roles.role='admin'`), feature-flag table, `ai_cache`, quotas beyond `org_student_usage`.

---

## 5. Gap analysis: spec vs what exists

✅ exists and is reusable · 🟡 partial or needs reshaping · ❌ missing

| Spec area | State | Notes |
|---|---|---|
| **3 Roles** super_admin / tpo_admin / student | 🟡 | `user_roles.admin` + `org_admin`/`trainer`/`student`. Needs mapping (org_admin→tpo_admin), and the enum needs company roles. |
| company_admin / recruiter / hiring_manager / candidate | ❌ | `org_type` has no `company`. No token-only candidate identity. |
| One identity, B2C + org member | ✅ | Memberships table; no duplicate users. |
| RLS isolation proven by tests | ✅ | PGlite suites, mutation-checked. Must extend to every new table. |
| Audit log of admin actions | ❌ | |
| **4 Data model** organizations (plan, seats, credits, validity, settings jsonb) | 🟡 | plan, plan dates, max_students exist. No credits, `settings`, retention, modules or quotas jsonb. |
| invites (hashed, expiring, single use) | ✅ | `org_invites`. |
| consents (purpose, version, withdrawn_at) | 🟡 | `org_consents` stores version + exact text. Not itemised per purpose; no withdrawal. |
| students table (roll_no, dept, CGPA, backlogs, 10th/12th, DOB…) | 🟡 | `org_memberships` + invites have name/email/roll_no/batch only. No academic fields, no pre-activation rows. |
| candidates | ❌ | |
| questions / test_cases / reference_solutions / assessments / attempts / submissions / edit_history | ❌ | |
| interview_templates / interview_sessions | 🟡 | `interview_modules` (topics, pass mark, turns, minutes, style) + `b2b_interviews`/turns. No skills matrix with weights, sections, persona, media refs. |
| drives / roles / assignments | ❌ | |
| proctoring_events / integrity_reviews | 🟡 | WIP branch only, simpler schema. |
| competency_dimensions / dimension_scores | 🟡 | Evaluator writes 8 fixed dimensions into `b2b_evaluations`. No normalised 0–100 table. |
| ai_cache / ai_usage_log / quotas | 🟡 | `b2b_usage_log` + `b2b_pricing` (B2B only, stale rates). `resume_score_cache` is B2C-only. No single-flight, no per-org quota beyond interview credits. |
| share_links | 🟡 | Studio share links only. |
| **5 Assessment engine** (bank, AI generation + verification, builder, Monaco runner, server timer, Judge0, grading, plagiarism, replay, watermark) | ❌ | Nothing exists. |
| MCQ | ❌ | |
| **6 Voice interview** streaming STT/TTS, ≤1.5 s, barge-in, recording, text fallback | ❌ | Browser Web Speech only; text mode was removed 2026-09-29 by your decision. See section 6. |
| Adaptive state machine with coverage + time-box | ✅/🟡 | `_shared/interview-engine.ts`. Needs sections (intro, technical, behavioural, code walkthrough…) and must-have skill coverage. |
| Code walkthrough | ❌ | Depends on the assessment engine. |
| Prompt-injection defence | 🟡 | Transcript fenced as data in the evaluator. No live-turn injection detection or logging. |
| Evaluation: zod JSON, evidence quotes verified, recommendation band, blind scoring | 🟡 | Validation + verbatim-quote check ✅. Blind scoring (name/college stripping), 1–5 anchors, bands, double scoring ❌. |
| AI-answer signals | ❌ | |
| Interviewer avatar tiers | ❌ | B2C has a 2D animated avatar; no tiers. |
| **7 Proctoring** system check, consent, identity, gaze calibration, screen-share enforcement, single display, camera/audio ML, policies, integrity score, review UI, evidence storage, retention, accommodations | 🟡/❌ | WIP branch covers face/gaze/tab/fullscreen events. Everything else is missing. Mic AudioCheck exists. |
| **8 AI gateway** exact cache, single-flight, prompt caching, cost log, quotas | 🟡 | Two clients (`ai.ts`, `b2b-llm.ts`) with retries. Cost log for B2B only. No cache, dedupe or quotas. |
| **9 College portal** super-admin onboarding + tracking | 🟡 | Create org, plan, end date, staff; cost per org. No seats-over-time, modules toggles, alerts. |
| TPO: CSV/XLSX import with mapping + dedupe/merge | 🟡 | CSV import with header aliases + dedupe ✅. No XLSX, no column-mapping UI, no merge, no academic fields. |
| Departments / batches / sections | 🟡 | `batches` (name, department, course). |
| Drives + cohort filters + windows + release rules | ❌ | |
| Live drive monitor (realtime) | ❌ | |
| Analytics (server-side filters, saved views, funnel, heatmap, 360, exports) | 🟡 | Readiness dashboard, heatmap, drill-down, PDF/XLSX/CSV exports ✅, but **aggregated in the browser** (`src/features/b2b/lib/dashboard.ts`). No saved views or funnel. |
| Student: OTP/magic-link login, drives, practice quota, resume optimizer scoped + cached | 🟡 | Invite → account → `/learn` practice interviews with quota ✅. No drives; resume tools not org-scoped. |
| **10 Startup portal** | ❌ | Nothing exists. |
| **11 Design system + motion** | ❌ | Skills installed (section 10 below). B2B uses B2C styles. |
| **12 NFRs** CSP/headers, Sentry, rate limits on public endpoints, private evidence buckets, retention jobs, DPDP consent per purpose, under-18 block | 🟡 | Retention cron for guest data ✅, hashed tokens ✅, some rate limits ✅. No CSP, no error tracking, no DOB/under-18 handling, CAPTCHA pending. |
| Playwright E2E + B2C screenshot baseline | ❌ | Required by every phase's Definition of Done. Must be built in Phase 1 before any shared change. |
| Feature flags + B2B route groups | ❌ | B2B routes are live unflagged (Q6). |

---

## 6. Voice diagnosis

**Method.** I read the code (`src/lib/speech.ts`, `src/pages/VoiceInterview.tsx`,
`src/features/b2b/hooks/useVoiceAnswer.ts`, `supabase/functions/mock-interview`, `b2b-interview`), traced git
history, and checked the **live JS bundle** on hiresume.in. I did **not** reproduce it end to end with a real
microphone on a phone. That needs a person speaking on Android and iOS, and it's listed as a manual step for
you in PROGRESS.md. Production also has no turn-latency data yet (0 rows in `b2b_usage_log`, 11 B2C sessions).

**How it works today.**
```
Browser                                     Supabase Edge Function (per turn, HTTP)
SpeechRecognition (Chrome → Google STT)  →  POST mock-interview / b2b-interview
  2.5 s silence timer ends the answer          → Gemini 3.6 Flash (non-streaming, low effort)
speechSynthesis (device voices)          ←  JSON { next question }
```
No WebSockets, no long-lived serverless connections. **The serverless-WebSocket failure mode doesn't apply.**

**Root causes of the late-September failures (both fixed and live):**

| Symptom | Root cause | Fix | Live? |
|---|---|---|---|
| Interviewer silent on phones | Mobile browsers only allow `speechSynthesis` inside a user tap. The first question came back 10–25 s after the tap (slow Gemini start call), so speech was silently refused. | `b499622`: `primeSpeech()` in the Start tap, sentence chunking, a "blocked" outcome, mic and voice error help | Yes (on `main`) |
| Interview loops and ends itself | Android TTS reports "ended" before the audio finishes, so the mic heard the interviewer's question and sent it back as the answer. The model then answered itself and hit its wrap-up. Also empty model replies were spoken as silence, and default thinking effort made replies take 10–25 s. | `857c330`: `waitForSpeechEnd()`, an echo filter (`isEchoOfPrompt`), a headphones hint, low reasoning effort, no empty replies | Yes (confirmed in the live bundle; on `origin/main`) |

**Structural limits (why the spec targets can't be met with this design):**
1. **Latency about 4–8 s per turn (estimate).** 2.5 s fixed silence wait + edge-function round trip + a
   non-streaming LLM call + TTS start. The target is ≤1.5 s.
2. **No barge-in.** The mic is deliberately off while the interviewer speaks (the echo fix depends on it).
3. **No recording.** The Web Speech API never exposes the audio, so there's no evidence, playback or audio ML.
4. **Inconsistent recognition.** Chrome and Edge only (Firefox has none, iOS is unreliable). Audio is sent to
   Google's servers by the browser, which our consent notice must disclose. Indian-English accuracy isn't
   controllable.
5. **Device-dependent voices.** Android without Google TTS has no voice at all.

**Proposed fix.** Keep the B2C interview on the current stack (it works now; B2C is frozen). Build the B2B
interview in Phase 5 on a **persistent realtime component** (options in section 7.1). Reuse
`interview-engine.ts` (state machine) and `evaluator.ts` (validation + quote verification) as-is.

---

## 7. Architecture proposals

### 7.1 Realtime voice

| Option | How | ₹ per 20-min interview | Latency (p50, expected) | Effort | Risk |
|---|---|---|---|---|---|
| **A. LiveKit Agents on our own VM (recommended)** | Browser ↔ WebRTC ↔ LiveKit server + Python/Node agent worker on one VM (DigitalOcean Bangalore, $48/month). Streaming STT (Deepgram Nova-3 or Sarvam Saaras) → LLM (state machine calls) → streaming TTS (Deepgram Aura-2, Sarvam Bulbul, or Cartesia). Silero VAD + turn detector for barge-in. Records both sides server-side to Storage. | **≈ ₹45 (Sarvam) / ₹54 (Deepgram)** at 2027 Gemini prices, 1,500 interviews per month (section 9.1) | about 1.0–1.6 s | Medium-high | We run one VM. Need an STT/TTS shoot-out on Indian accents. |
| B. Gemini Live (native audio), browser direct | Browser opens a WebSocket straight to Gemini Live using a short-lived token minted by an edge function. No server of ours. State machine via function calls. | about ₹20–60 (list price about ₹20; per-turn context re-billing can multiply it) | about 0.6–1.0 s | Medium | Model is the brain and the voice, so less control. Not Claude. Recording needs extra client capture. Vendor lock-in. |
| C. Keep Web Speech, streaming LLM + sentence TTS | Same browser stack, stream tokens and speak sentences early | about ₹14 (₹27 from 1 Jan 2027) | about 3–5 s | Low | Misses latency, barge-in and recording requirements. |

A can also run as **LiveKit Cloud** instead of self-hosting (Ship plan $50/mo for 5,000 agent minutes, then
$0.01/min). That's about ₹19 more per interview but nothing to operate. A sensible path is to start on Cloud
during Phase 5 and move to self-hosting once volume justifies it.

### 7.2 Code execution (Judge0)

| Option | Monthly | Fits a 300-student drive? | Notes |
|---|---|---|---|
| **Self-hosted Judge0 CE on 1–2 VMs (recommended)** | $48 per droplet (DigitalOcean BLR1; Hetzner SG is now $58–73) | Yes. Scale workers for drive peaks. | Judge0 1.13 needs **cgroup v1**, so the host boot setting has to change on Ubuntu 22.04+. Isolated from the web app as required. A per-org concurrency limit lives in our queue. |
| Judge0.com managed | €27 / €54 / €107 for 2K / 5K / 10K submissions **per day** | **No.** 300 students × about 105 executions ≈ 31K in one day, over the top cap. | Fine for Phase 3 development only. |
| RapidAPI pay-per-use | $0.0017 per submission (≈ ₹17 per candidate test) | Yes | Most expensive at volume. |

### 7.3 Background jobs

The current pattern is pg_cron + pg_net → edge function (the evaluation sweep). Proposal:
**Supabase Queues (pgmq) in Postgres** as the single job queue. Short jobs (evaluations, emails, analytics
refresh, retention deletes) are consumed by edge functions on a cron tick. Long or heavy jobs (Judge0 result
fan-in, media transcode, plagiarism fingerprinting, vision labelling) are consumed by a **worker process on
the same VM** as the voice agent and Judge0. Alerts come from a `failed_jobs` view plus error tracking.
The alternative is a hosted job service (Inngest or Trigger.dev): less to run, one more vendor.

### 7.4 Media and evidence storage

Supabase Storage **private** buckets per purpose (`evidence`, `recordings`), with org-scoped paths
`org/{org_id}/{session_id}/…`, RLS on `storage.objects`, short-lived signed URLs for reviewers, and **TUS
resumable uploads** with a client retry queue. A per-org retention job deletes objects and rows after N days.
Pro includes 100 GB, then $0.021/GB-month. If full-video recording becomes the default, move recordings to
Cloudflare R2 (no egress fees).

### 7.5 Analytics queries

Move aggregation from the browser to Postgres: a normalised `dimension_scores` table, composite indexes
(org, cohort fields, time), **materialised views refreshed by pg_cron** for heatmaps and funnels, and
paginated SECURITY DEFINER RPCs for filtered tables. The p95 < 500 ms target gets validated on a 300-student
seeded demo.

---

## 8. Hosting summary (decided 2026-10-20; prices verified on vendor pages)

| Component | Where | Monthly |
|---|---|---|
| Web app (SPA + pre-rendered pages) | Vercel (existing, deploys from `main`) | existing |
| DB, Auth, Storage, Edge Functions, cron, queues | Supabase Pro (shared with B2C; base fee not counted) + compute Micro → Small | +$15 |
| Staging (before the first college pilot) | Second Supabase project, Micro compute | about $10 |
| **Judge0 + job worker (pilot)** | **One DigitalOcean droplet in Bangalore (BLR1)**, Basic 4 vCPU / 8 GB | **$48** |
| Voice agent (after the pilot) | A second droplet in BLR1, or LiveKit Cloud | $48 / $50 + $0.01 per agent-minute over 5,000 |
| Error tracking | Sentry Developer (free, 5K errors, 1 user) → Team | $0 → $29 ($26 annual) |
| Email (invites, OTP) | Resend Pro (50K emails, no daily cap; the free plan caps at 100 a day) | $20 |
| **B2B fixed cost, pilot** | | **about $93 ≈ ₹8,800/month ≈ ₹1.06 lakh/year** |
| **B2B fixed cost, after the voice upgrade** | | **about $141 ≈ ₹13,400/month ≈ ₹1.61 lakh/year** |

Why DigitalOcean Bangalore and not Hetzner Singapore (as I suggested in Phase 0): Hetzner raised Singapore prices in
June 2026. CPX31 is now $73.49/month and CPX32 $57.99/month, against the $32 a blog quoted. DigitalOcean's 4 vCPU /
8 GB droplet is $48/month in every region, and BLR1 is in India. Judge0 needs cgroup v1 on the host (a boot setting on
Ubuntu 22.04+). The server must be load-tested before the first real drive.

---

## 9. Cost model (re-verified 2026-10-20)

### 9.0 Prices: Phase 0 figure vs the vendor's own page

All prices are from the vendor's official pricing page on 2026-10-20. **₹95 per USD**: USD/INR traded at 94.7–96.8
in October 2026. The FBIL/RBI reference-rate pages are script-rendered and couldn't be read automatically, so please
check the FBIL rate when quoting. Planning uses **2027 prices**, because a pilot that starts now runs into 2027.

| Item | Phase 0 (source) | Official page (2026-10-20) | Change |
|---|---|---|---|
| **gemini-3.6-flash** (what the app runs) | $0.75 / $3.75 per 1M (3.8 Flash, third-party blog) | **Same as 3.8 Flash: $0.75 / $3.75 through 31 Dec 2026; $1.50 / $7.50 from 1 Jan 2027.** Context cache: $0.075 per 1M cached input (→ $0.15) + $0.50 per 1M tokens per hour storage (→ $1.00). [ai.google.dev/gemini-api/docs/pricing](https://ai.google.dev/gemini-api/docs/pricing) | Reconciled; doubling confirmed on Google's page |
| Gemini Live (native audio) | $0.005 / $0.018 per min (blog) | Same: audio in $0.005/min, audio out $0.018/min | Confirmed |
| Deepgram Nova-3 streaming | $0.0077/min | Page shows **$0.0048/min** pay-as-you-go with $0.0077 struck through (Growth $0.0042). Planned at **$0.0077** in case the offer ends. [deepgram.com/pricing](https://deepgram.com/pricing) | Confirmed (promo noted) |
| Deepgram Aura-2 TTS | $0.015 per 1K chars (blog) | **$0.030 per 1K chars** (Growth $0.027) | **2× higher** |
| Sarvam STT (Saaras) | ₹0.49/min | ₹0.49/min real-time (₹0.41 on Growth). [sarvam.ai/api-pricing](https://www.sarvam.ai/api-pricing) | Confirmed |
| Sarvam TTS (Bulbul V4 Flash) | ₹2 per 1K chars | ₹2.00 per 1K chars (₹1.70 on Growth) | Confirmed |
| LiveKit Cloud | $50 Ship, $0.01/agent-min | Same: Build free (1,000 min), Ship $50 (5,000 min), Scale $500 (50,000 min); overage $0.01/min. [livekit.com/pricing](https://livekit.com/pricing) | Confirmed |
| Claude (not the default; kept for comparison) | Haiku 4.5 $1/$5, Sonnet 5 $2/$10 | Same; cache read $0.10 / $0.20, cache write $1.25 / $2.50. [claude.com/pricing](https://claude.com/pricing) | Confirmed |
| Judge0 managed | €27 / €54 / €107 for 2K / 5K / 10K per day | Same, + €0.001 per extra submission. [judge0.com](https://judge0.com/) | Confirmed |
| Supabase | storage $0.021/GB | Pro $25 (+$10 compute credit), Micro $10 / Small $15 / Medium $60, storage 100 GB then $0.0213/GB, egress 250 GB then $0.09/GB. [supabase.com/pricing](https://supabase.com/pricing) | Confirmed |
| Server | Hetzner SG CPX31 $32 (blog) | **Hetzner SG CPX31 $73.49, CPX32 $57.99** (June 2026 increase); **DigitalOcean 4 vCPU / 8 GB $48** (all regions incl. BLR1) | **Switched to DigitalOcean BLR1** |
| Sentry Team | $26 | $29 monthly / $26 annual; Developer free (5K errors) | Minor |
| Resend | $20 | Pro $20 (50K/month); free plan 100 a day | Confirmed |

The cost log's rate table is fixed by migration `20261020000002_b2b_pricing_rates.sql` (₹71.25 / ₹356.25 per 1M
now, ₹142.5 / ₹712.5 from 1 Jan 2027). It isn't applied yet; it's for your review.

### 9.1 One 20-minute AI voice interview

Assumptions: 20 min of mic audio streamed; about 6 min (about 5,000 characters) of interviewer speech; 15 turns
averaging about 6K input / 800 output tokens (90K / 12K in total), of which about 2.5K per turn is a static prompt
that context caching can serve at 10%; one evaluation of about 10K input / 6K output tokens (medium thinking).

| Line | Pilot stack (browser speech + Gemini) | Target: LiveKit + Sarvam + Gemini | Target: LiveKit + Deepgram + Gemini |
|---|---|---|---|
| STT | ₹0 (Chrome sends audio to Google) | ₹9.8 | ₹14.6 (₹9.1 at the current promo) |
| TTS | ₹0 (device voice) | ₹10.0 | ₹14.3 |
| LLM turns, 2026 / **2027** | ₹10.7 / **₹21.4** (₹8.3 / **₹16.6** with context caching) | ₹8.3 / **₹16.6** (cached) | same |
| Evaluation, 2026 / **2027** | ₹2.9 / **₹5.7** | same | same |
| Realtime infra (one $48 BLR1 droplet, 1,500 interviews/month) | ₹0 | ₹3 | ₹3 |
| **Total, 2027 prices** | **≈ ₹27** (≈ ₹22 cached) | **≈ ₹45** | **≈ ₹54** |
| Total, 2026 prices | ≈ ₹14 | ≈ ₹34 | ≈ ₹43 |

LiveKit Cloud instead of our own droplet: Ship's $50 covers 5,000 agent-minutes (250 interviews), then about ₹19 per
interview. Gemini Live (native audio) would be about ₹20 per interview at list price, plus per-turn context re-billing.

### 9.2 One coding test (60 min, 3 problems, proctored by snapshots)

| Line | ₹ (2027) |
|---|---|
| Judge0 on the shared BLR1 droplet (about 105 executions) | ≈ 0 marginal (fixed $48/month) |
| Optional AI code-quality review (3 solutions, 3K in / 1K out each) | 3.4 |
| Screen + webcam snapshots every 30 s + on events (about 16 MB, 90-day retention) | 0.1 |
| Optional vision labelling of about 20 flagged frames | about 2 |
| **Typical** | **≈ ₹3–6** |

If the droplet is overloaded at drive peaks, Judge0's managed overflow costs €0.001 per execution (≈ ₹10 per test).

### 9.3 One resume optimisation (Gemini, 2027)

Analysis (6K in / 5K out) ₹4.4. Each Studio edit turn (8K in / 1.5K out) about ₹2.2. **Planned: analysis + 3 edits
≈ ₹11.** A duplicate resubmission served from the cache costs ₹0.

### 9.4 Evidence storage

Snapshots only (no continuous video for colleges): about 16 MB per coding test + about 5 MB per 20-minute interview
≈ 21 MB per student per drive. At 90-day retention that's **about ₹0.13** per student per drive. Supabase's included
100 GB holds about 4,700 drives' worth before the $0.0213/GB rate applies.

### 9.5 Per student per year

Usage profile (unchanged from Phase 0): 1 proctored drive (coding + interview + resume task) + 4 practice interviews +
2 practice coding tests + 3 resume optimisations. 2027 prices; pilot stack without context-cache savings (conservative), target stack with caching (as in 9.1).

| | Pilot stack | Target stack (Sarvam) |
|---|---|---|
| Drive (3.4 + 2 + interview + 11 + 0.13) | ₹43.5 | ₹61.5 |
| 4 practice interviews | ₹108 | ₹180 |
| 2 practice coding tests | ₹6.8 | ₹6.8 |
| 3 resume optimisations | ₹33 | ₹33 |
| **Variable cost per student per year** | **≈ ₹190** | **≈ ₹281** |

Startup candidate (later): proctored coding + AI review + 30-minute target-stack interview + double-scored evaluation +
resume screen ≈ **₹90** (2027).

### 9.6 Break-even students at ₹399 / ₹499 / ₹599 per student per year

Break-even = B2B fixed cost per year ÷ (price − variable cost per student). Prices are ex-GST. Excluded: GST, payment
fees (Razorpay about 2% + GST if a college pays online), sales and support time, the shared Supabase Pro base fee.

| Price | Pilot stack: margin per student | Students to cover ₹1.06 lakh/year | Per college if 3 colleges | Target stack: margin | Students to cover ₹1.61 lakh/year | Per college if 3 colleges |
|---|---|---|---|---|---|---|
| ₹399 | ₹209 | **508** | 170 | ₹118 | **1,363** | 455 |
| ₹499 | ₹309 | **344** | 115 | ₹218 | **738** | 246 |
| ₹599 | ₹409 | **260** | 87 | ₹318 | **506** | 169 |

These numbers assume every student uses the full profile in 9.5. Real usage is usually lower, so real break-even is
lower. A single 300-student pilot college at ₹499 covers the pilot fixed cost on its own.

### 9.7 Pooled-credits plan (your decision: pooled per college, not unlimited per student)

- **Credit** = one 20-minute practice AI interview. A practice coding test = ¼ credit; a resume optimisation = ½
  credit; cache hits are free. Proctored **drives are included** in the plan and don't use credits.
- **Pool** = students × credits per student, shared by the whole college, valid for the contract period. A student
  can use more or less than "their" share. The TPO sees the balance; the super admin gets an alert at 80%.
- **Top-up**: 100 credits for ₹7,500 (₹75 per credit). Margin per credit is ≈ 64% on the pilot stack (₹27) and
  ≈ 40% on the target stack (₹45).

| Plan | Per student per year | Includes | Cost per student at full use, pilot / target | Margin, pilot / target | Break-even students (all colleges), pilot / target |
|---|---|---|---|---|---|
| Starter | ₹399 | 1 drive + 4 credits | ₹152 / ₹242 | ₹248 (62%) / ₹158 (39%) | 429 / 1,021 |
| Standard | ₹499 | 2 drives + 5 credits | ₹222 / ₹348 | ₹277 (56%) / ₹151 (30%) | 383 / 1,065 |
| Plus | ₹599 | 3 drives + 5 credits | ₹266 / ₹410 | ₹333 (56%) / ₹189 (32%) | 318 / 849 |

The plans are sized so the target stack keeps at least 30% margin even if every credit is used. The current pilot
plans (Basic ₹149, Pro ₹299) should be retired before quoting; the 30-day free pilot can stay. Implementing this
replaces the per-student `org_student_usage` counter with an org credit balance (Phase 1 schema, Phase 6 UI).

---

## 10. Installed skills check (spec section 0.10 and section 11)

All five skill packs are installed globally (`~/.claude/skills`) and show up in this session:
`design-dna`; `paint`, `cast`, `bunshin` (genjutsu, installed as **standalone skills**, so they're invoked as
`paint`/`cast`, not `/genjutsu:paint`); `motion-design`; `gsap-core/-timeline/-scrolltrigger/-plugins/-utils/-react/-performance/-frameworks`;
`threejs-*` (10). For R3F the project needs `three`, `@react-three/fiber` and `@react-three/drei`. The spec's
"dynamic import with `ssr: false`" maps to `React.lazy` + `import()` here (it's an SPA; the pre-renderer must
skip these components).

---

## 11. Risks to flag now

- **Under-18 students (DPDP).** No DOB is collected anywhere today. Proctoring must be blocked for under-18s
  until you decide (Q-14.9). First-year students can be 17.
- **Web Speech privacy.** The current interviews send student audio to Google through Chrome. That should be in
  the consent text, or the feature should move to Option A.
- **Prod-only workflow.** Every migration lands directly on production. Phase 3+ schema work and the load tests
  (Phase 9) really want a staging project (one more Supabase project, about $10–25/month). That's a paid
  addition, so it's your call.
- **Email.** Without a verified Resend domain and MX records, OTP/magic-link login for students and candidates
  (spec section 9/10) can't be relied on.
- **Strict TypeScript.** The spec requires strict mode. The app is non-strict, with 25 errors. Proposal: new B2B
  code under `src/b2b/` with its own `tsconfig` (strict) instead of flipping the B2C config.
- **Gemini price doubling on 1 Jan 2027** affects every B2C AI feature too, not just B2B.

---

## 12. Questions for you

**Blocking Phase 1**
1. **Framework.** The spec says Next.js; the app is Vite + react-router with a custom pre-renderer.
   (a) **Keep Vite, recommended.** B2B gets its own lazy-loaded route tree and layouts, effort is low, B2C is
   untouched. (b) Migrate everything to Next.js: weeks of work and risk to B2C SEO and pixel parity. (c) A
   separate Next.js app for B2B on a subdomain: two codebases, which goes against "one shared core".
2. **LLM provider.** The spec says Claude; the code moved to Gemini when Anthropic billing stopped. The
   gateway will be provider-agnostic either way. Which should B2B use: Claude (Haiku 4.5 for live turns,
   Sonnet 5 for evaluation), Gemini, or a per-feature mix? Is Anthropic billing available again?
3. **Prod drift.** May I merge `fix/live-issues` into `main` and push, so B2B branches start from what's live?
4. **Existing B2B tables.** Since prod has zero B2B rows, may I **evolve** the pilot tables (rename and extend
   `organizations`, `org_memberships`, add `company` to `org_type`, add roles to `org_member_role`) instead of
   creating parallel ones? Adding enum values can't be undone. Keep or drop `coaching_institute` and the
   public lead test (`/test/:slug`)?
5. **Super admin.** Keep `user_roles.role='admin'` as the platform-admin source, or add a `platform_admins`
   table as in the spec (needs a one-time copy of admin users)?
6. **Feature flags.** The pilot's B2B routes are live today without a flag. Put them behind the new flag too
   (off by default), or leave them live?
7. **Staging.** Create a staging Supabase project (paid, about $10–25/month) for migrations and load tests?
8. **Proctoring branch.** Salvage `feat/proctoring` into Phase 3/4 (my recommendation: keep the rules engine,
   gaze and detector code and tests; redo the schema), or discard it?

**Section 14 decisions**

9. Hosting for voice, Judge0 and workers: one or two self-managed VMs (about $64–112/month, recommended) vs
   managed services (LiveKit Cloud + Judge0 managed, about $100–200/month and Judge0's daily caps)?
10. Voice stack: Option A with an STT/TTS shoot-out (Deepgram vs Sarvam on Indian-English recordings),
    Option B (Gemini Live), or C?
11. Recording policy: audio + snapshots by default (recommended, about ₹0.15 per student per drive), or full
    webcam video?
12. Default retention for recordings and evidence: 90 days (recommended), 30, or 180?
13. Students see their own scores by default? Practice quota per student per month (I suggest 2 interviews +
    4 coding)?
14. Startup self-serve signup and payments: later (recommended; sales-led V1) or now?
15. Path-based URLs `hiresume.in/c/{college}` (default) or a subdomain per college?
16. Department coordinator role: now or later?
17. Under-18 students: exclude from proctored sessions (recommended until legal advice) or build parental
    consent?

**Other**

18. Resend: can you verify hiresume.in in Resend and add MX/forwarding? Student and candidate OTP login
    depends on it.
19. Plan prices: revisit ₹149/₹299 against the cost model before quoting colleges?
20. Design DNA (Phase 2): please send 2–3 reference URLs or screenshots, or say "you pick".

---

## 13. How production is deployed (and the proposal to deploy only from `main`)

**Today** (verified 2026-10-20 in Vercel and Supabase):

| Part | How it reaches production | Tied to `main`? |
|---|---|---|
| Website (Vercel project `super-hire-ai`, domains hiresume.in + www) | Vercel's GitHub integration. Every push to `main` builds and goes live; every other branch gets a preview URL (e.g. my push of `fix/live-issues` made a preview, not a production deploy). The last 15 production deploys all came from `main`. | **Yes** |
| Edge functions (27) | `npx supabase functions deploy` run by hand from a laptop. Versions range from 2026-05-25 to 2026-09-29. | **No.** Whatever is on the laptop gets deployed. The deployed code I could download (7 functions) matches `main`; the 3 b2b ones I couldn't download haven't changed in git since they were deployed. Each function bundles its own copy of `_shared/`, so older bundles carry older shared code. |
| Migrations | `npx supabase db push` by hand. 38/38 applied, matching the repo. | **No** |
| Secrets | Set by hand (`supabase secrets set`) | n/a |
| Vercel env vars | Set in the Vercel dashboard | n/a |

There is no CI (no `.github/`) and `main` has no branch protection.

**Proposal: `main` is the only deploy source**
1. **Branch protection on `main`**: changes only through pull requests; required check = tests + type check + lint (no
   new errors). You approve every PR.
2. **GitHub Actions `deploy-functions.yml`**: on push to `main`, if `supabase/functions/**` changed, run
   `supabase functions deploy` for **all** functions (so every bundle has the same `_shared/` code). Uses a
   `SUPABASE_ACCESS_TOKEN` repository secret. Manual laptop deploys stop.
3. **GitHub Actions `migrate.yml`**: **manual trigger only**, in a protected GitHub "production" environment that
   needs your approval. It runs `supabase db push` from `main`. Migrations are reviewed in the PR and applied only
   when you press the button, which keeps your "I review and apply every migration" rule with an audit trail. The
   same workflow can target staging first once the staging project exists.
4. **Vercel**: keep production branch = `main`. Turn off CLI production deploys by convention (or restrict the team
   token), so the only way to production is a merge.
5. **Tags**: tag every production release (`live-YYYY-MM-DD`), as with `live-2026-10-20`.

Nothing above has been set up yet. It needs your OK: it adds a GitHub token secret and changes repository settings.
