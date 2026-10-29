# HiResume B2B — Progress

> Read this first at the start of every session; update it at the end.
> Spec + **Decisions log**: `docs/b2b/hiresume-b2b-build-prompt.md` · Evidence and numbers: `docs/b2b/AUDIT.md`

_Last updated: 2026-10-29_

## Current: `HIRESUME_B2B_SPEC.md`, Phase 1 in progress (branch `feat/b2b-hardening`)

**Decisions (2026-10-29):**
- **D1:** Claude in production; Gemini for now to keep costs down. The gateway gets a Claude provider and a per-environment switch.
- **D2:** Docker. It's installed; local Supabase runs with `supabase start -x vector,logflare,imgproxy,studio`.
- **D3:** sessions built in the app.
- **D4:** researched in `docs/b2b/VOICE_STACK_RESEARCH.md`. Recommendation: Sarvam plus Pipecat with Smart Turn v3, pending a 1-day bake-off.
- **D5:** B2B and B2C kept separate on one login.
- **D6:** Dolos.
- **D7:** super admin has full access; TPOs manage students only.
- **D8:** hotfix PR #7, plans readable by super admins only. You apply it.

**Phase 1, done (evidence in the commits and tests):**
- **R3.1:** the plans table is super-admin only (#7, cherry-picked here). The plan tier (`plan_id`) is hidden from everyone except super admins through column privileges plus `super_orgs()`, and `org_usage_summary` no longer returns the tier to staff (migration 0016, `plans.test.ts`).
- **R3.3 / D7:** staff invites are super-admin only, and org admins can update or delete student memberships only (migration 0017, `v1-isolation.test.ts`).
- **R1.3 / R1.4:** the seat cap applies on every path with a per-org lock, a used seat is never recycled, and `super_free_seat()` frees one (migration 0018, `seats.test.ts`, plus a real-Postgres race on local Supabase).

- **R1.5 / R1.6, changed by owner decision (2026-10-29): no credits are charged for logging in.** What's recorded instead is what each student was given and did: activated, then assigned, started, and completed / absent / removed. This lives in the append-only `student_activity` table, written only by triggers. A student sees only the drives their TPO assigned, gets one attempt per drive (unique per drive and student; attempts are reused), and a finished drive stays "Completed" until the TPO assigns another. The seat counts as used once the student activates their account (R1.4). The TPO roster shows drives done / assigned and last active (migration 0019, `student-activity.test.ts`). Session expiry and single-device (R1.6) aren't built. **Open question:** practice tests are still self-serve when a TPO enables them on a test, and they cost 0.25 credit each.

**Phase 1, next:**
- R1.8 per-activity costs and quotas.
- R3.2 no B2C pages from B2B.
- R3.5 MFA and admin audit.
- R1.9 alerts.
- R6.1 cost views.
- R5.5 retention job (P1).

**Deploy notes:**
- Hotfix migration `20261029100001` (in #7) sorts after 0006–0018. When the batch goes to production, use `supabase db push --include-all`; the CLI skips older-numbered migrations otherwise, as it did locally.
- Migrations 0006–0018 and the V1 functions are not in production. Never deploy B2B functions from this branch until they are.
- Local test runs: use `--maxWorkers=2`. With Docker running, the 8 GB machine times out under full parallelism.

---

_Previous status (2026-10-22) below._

## Where things stand

**Fast-track mode (Decisions log 2026-10-20).** Phase 1 and all V1 tracks (A–E) are built: PR #3 (Phase 1) and
PR #4 (tracks, on top of #3). **Now blocked on Docker** for the local walkthroughs (`docs/b2b/TESTING.md`); after
those, one batched production release for your approval.

## PRs
| PR | Branch | Base | What |
|---|---|---|---|
| #1 | `fix/b2b-lockdown` | main | B2B off by default; no model calls without membership; evaluation retry cap |
| #2 | `chore/b2b-followups` | main (stacked on #1) | Real cost rates, voice latency logging, decisions, fast-track spec |
| #3 | `feat/b2b-v1-phase1` | `chore/b2b-followups` (stacked) | Phase 1: V1 schema, AI gateway, contracts, super admin v1, e2e + CI |
| #4 | `feat/b2b-v1-tracks` | `feat/b2b-v1-phase1` (stacked) | V1 tracks A–E + local testing kit |

Merge in order #1 → #2 → #3. **Hold #4 out of `main` until the batched release:** a push to `main` deploys edge
functions (`deploy-functions.yml`), and track C's `b2b-evaluate` needs migration 0009, so migrations must go first. Merging to `main` deploys the website (Vercel) immediately; edge functions deploy
from `main` once the `SUPABASE_ACCESS_TOKEN` secret exists. **B2B stays off in production either way** (frontend
flag unset, `B2B_ENABLED` secret unset). Production migrations are batched and applied only by you (see below).

## Waiting on you
1. **Docker for local Supabase** (you chose this, 2026-10-20). In an *administrator* PowerShell:
   ```powershell
   wsl --install            # then reboot
   ```
   After the reboot, install Docker Desktop (https://www.docker.com/products/docker-desktop/), start it once, then tell
   me. I'll run local Supabase without the heavy extras: `npx supabase start -x studio,imgproxy,vector,logflare`.
2. **Judge0 server** (track A). Judge0 needs cgroup v1, which Docker Desktop on Windows doesn't provide, so it can't run
   on this laptop. Please create the **DigitalOcean droplet: Bangalore (BLR1), Basic, 4 vCPU / 8 GB, Ubuntu 22.04,
   $48/month**, add your SSH key, and send me its IP. (Approved hosting; this is the pilot server.)
3. **CI secrets** (CI proposal approved):
   - Supabase → Account → Access Tokens → *Generate new token* (name: `github-actions`) → copy it.
   - Then, in the repo folder: `gh secret set SUPABASE_ACCESS_TOKEN` and paste the token
     (or GitHub → repo → Settings → Secrets and variables → Actions → *New repository secret*).
   - For the manual migration workflow also: `gh secret set SUPABASE_DB_PASSWORD` (Supabase → Project Settings →
     Database → database password; reset it there if you don't have it).
4. **Branch protection** (after PR #3 is merged, so the `checks` and `e2e` checks exist on `main`): GitHub → repo →
   Settings → Branches → *Add branch protection rule* → `main` → tick *Require a pull request before merging*
   (Required approvals: **0**) and *Require status checks to pass* → add `checks` and `e2e` → Save. I can do this
   with `gh api` if you prefer; say so.
5. **Phone voice check** (still open from Phase 0) and the old items: Resend domain + MX, archive tag for
   `feat/proctoring` (`git tag archive/proctoring-2026-09-28 feat/proctoring && git push origin archive/proctoring-2026-09-28`).

## Phase 1 — done (2026-10-21)

**Built**
- **Schema** (migrations `20261021000001…0005`, not applied; batched for the V1 release):
  - Tenancy reshaped in place: org type and member role are **text + CHECK** (enums dropped). Org types `college`,
    `company` (+ legacy `coaching_institute`). Roles `org_admin` (TPO admin / company admin), `trainer`, `student`,
    `recruiter`, `hiring_manager`; a trigger ties roles to the org type; the type is locked once an org has members.
  - Orgs: status, seat limit, contacts, `settings` (modules, quotas, proctoring/results defaults, retention 90 days),
    **pooled credit balance + ledger** (atomic, idempotent consume/refund; super-admin grant/top-up).
  - **Audit log** written by triggers on every admin-managed table, with the acting user.
  - **Consents** itemised by purpose, withdrawable by the subject. **Staff invites** bound to the invited email.
  - **Every V1 table**: students (held if under 18), candidates, question bank + test cases + reference solutions,
    assessments, drives + assignments, job roles + role candidates + comments, attempts + autosaved answers +
    submissions + edit history, interviews linked to drives/roles/coding attempts, proctoring sessions/events/reviews,
    competency dimensions + scores, share links, resume links. RLS on all of them.
  - Results visibility: practice always; drives per the release rule; candidates never. Hiring managers see only
    assigned roles.
- **AI gateway** (`supabase/functions/_shared/ai-gateway`): per-feature provider/model config (Gemini default,
  `B2B_AI_CONFIG` overrides), exact-match cache (per org for personal data), **single flight**, quotas, zod-validated
  output with one retry, cost log with context-cached tokens. Interview turns and evaluations never cached.
- **Contracts** (`supabase/functions/_shared/contracts`): zod schemas for admin, college, company, candidate, assess,
  proctor, interview — shared by edge functions and browser. Stub functions answer 501 until a track implements them.
- **Super admin v1**: `b2b-admin` function + `/admin/orgs` (create college/company with plan, seats, validity, opening
  credits and first admin invite; invite staff; credits ledger; suspend/reactivate) + `/admin/usage` (per-org AI cost,
  cache hit rate, credits, students/candidates). Scoped B2B theme (slate/blue) on V1 screens only.
- **Quality gates**: Playwright B2C smoke + screenshots (8 pages × desktop/mobile) and "B2B routes are 404 in production
  builds"; ESLint/TypeScript baseline (fail on new errors only); strict TS for new B2B code; CI workflows.

**Tests**: 431 pass / 3 skipped (Vitest: unit, UI, RLS on embedded Postgres) + 36 Playwright tests. New: V1 isolation
suite (4 orgs × every role × every V1 table, reads and writes), AI gateway DB + unit tests, contract tests, admin UI tests.
**Bugs caught and fixed by the new tests:** an org admin could invite staff into another org (NULL role comparison);
a taken-over AI cache key kept its old expiry so the prune job could delete an in-flight claim.

**Found, not fixed (B2C frozen):** `supabase/functions/referral` selects the profile without `id` and then filters by
`profile.id`, so referral stats are probably always empty. CI skips Deno-checking it until you decide.

**Manual test (once local Supabase runs; before that, the UI tests cover it):**
1. `.env.local`: `VITE_B2B_ENABLED=true`; `supabase/functions/.env`: `B2B_ENABLED=true`, `GEMINI_API_KEY=…`.
2. Make your local user super admin: `insert into user_roles (user_id, role) select id, 'admin' from auth.users where email = '<you>';`
3. `/admin/orgs` → New organisation → College, Starter, 300 seats → credits suggested 1,200 → Create with a TPO email →
   copy the invite link (email isn't configured locally) → open it signed in as that email → you're the TPO admin.
4. New organisation → Company → Company plan → invite a recruiter → `/admin/usage` shows both orgs.

## Next: V1 tracks
Up to 3 at a time, subagents in separate worktrees; tracks list schema changes, I add the migrations.
- **A** assessment engine (needs the Judge0 server for real runs; bank, generation, runner, MCQ can start without it)
- **B** proctoring V1
- **C** interview V1 + Gemini Live spike
- **D** college portal
- **E** startup portal

Planned order: A + B + D first (college walkthrough), then C + E (startup walkthrough).

## V1 tracks A, B, D — merged (2026-10-20)

Branch `feat/b2b-v1-tracks` (from `feat/b2b-v1-phase1`): tracks merged in order A → B → D; their SQL is now migrations
`20261021000006_b2b_v1_assessment`, `…07_b2b_v1_proctoring`, `…08_b2b_v1_college` (not applied to prod).
- **A, assessment:** Judge0 client (503 `JUDGE0_NOT_CONFIGURED` until the server exists), `b2b-assess`, question bank
  `/assess/bank/:orgId` (+ `global`), test builder `/assess/tests/:orgId`, runner `/assess/start`, `/assess/a/:attemptId`.
  Cron: deadline sweep every minute; grading call every 2 min only when submissions are queued (reuses Vault secrets).
- **B, proctoring:** `b2b-proctor`, system check `/proctor/check`, `ProctoredSession`, review `/proctor/review/:id`,
  private `b2b-evidence` bucket (guarded block; untested on PGlite). Real-browser checks still to do (MediaPipe,
  `getDisplayMedia` monitor surface, `screen.isExtended`, fullscreen, VAD, snapshots).
- **D, college:** `b2b-college`, `/c/:orgId/*` (students + import, drives, analytics + exports, credits & team),
  `/learn/v1`. College tabs now link to Tests and Question bank.

Checks on the merged branch: DB/unit 321 pass / 3 skipped; B2B UI 113 pass; strict tsc 0; quality no new errors
(132 lint / 25 tsc baseline); deno check passes for b2b-assess/proctor/college/admin.

Known gaps: ~~builder allows saving a test whose pool rules can't be filled~~ (fixed 2026-10-22); analytics speed unmeasured at scale;
the bank's "Portal" tab points at the college portal (company portal comes with Track E).

Next: tracks C (interview V1 + Gemini Live spike) and E (startup portal).

## V1 tracks C, E — merged (2026-10-21)

Same branch `feat/b2b-v1-tracks`; migrations `20261021000009_b2b_v1_interview`, `…10_b2b_v1_startup` (not applied).
- **C, interview:** `_shared/interview-v1/` (template, section state machine with follow-ups, coverage and time-boxes,
  code walkthrough, injection detector, blind scrub, verified quotes, answer signals, latency p50/p95, evaluator with
  1–5 anchors and band); V1 actions in `b2b-interview/v1.ts`; room `/interview/v1/start`, `/interview/v1/i/:id`
  (**voice only**, audio re-check + resume); dev page `/interview/v1/live-spike` + `docs/b2b/gemini-live-spike.md`
  (owner runs it; nothing measured yet). b2b-evaluate no longer shows unreleased drive results.
- **E, startup:** `b2b-company`, `b2b-candidate`, `/co/:orgId/*` (roles from JD + skills matrix, pipeline, report,
  credits & team), `/t/:token` (+ `/t` resumes the last link), `/share/:token`, `/portal/:orgId` (routes to `/c` or
  `/co`). `job_roles.interview_config` drives C's interview. Credits charged once per completed candidate.
- **Lead fixes on merge:** a drive assignment completes only when both test and interview are done (trigger +
  analytics status); pilot `current` ignores V1 interviews; runner "Done" returns to the drive / candidate steps /
  practice zone; the internal-links test now reads B2B route files (all B2B links resolve).

Checks: Vitest 760 pass / 3 skipped (whole suite); strict tsc 0; quality no new errors (132 / 25); deno check passes
for all 9 B2B functions.

Known gaps: nothing run in a real browser or against local Supabase yet (needs Docker); Judge0 server not created;
Gemini Live untested; ~~job-role completion synced only on touch~~ (trigger, migration 0011); candidate system check is self-reported.

Next: local Supabase (Docker) → college + startup walkthroughs end to end → one batched production release for approval.

## 2026-10-22
- **Migration `20261021000011_b2b_v1_completion_sync`:** job-role candidates are synced (credits, notification) by a
  trigger the moment their test or interview ends, no longer only when someone opens the row.
- **Local testing kit:** `scripts/b2b-local-setup.mjs` (env files, demo accounts, super admin, seeded bank; local only),
  `docs/b2b/TESTING.md` (setup + both walkthroughs), fixtures in `docs/b2b/fixtures`. Anonymous sign-ins on in local
  config. Accepted invites now land in the right portal (staff → `/c` or `/co`, college students → `/learn/v1`).
- **Test builder draw check:** the server quietly gives fewer questions when a pool runs dry, and rules draw in order
  without repeats, so overlapping rules (or a rule overlapping chosen questions, also across sections) could short a
  candidate even when each rule alone had enough. The builder now shows the worst-case count per rule and refuses to
  save a test as **Ready** if any rule can come up short; drafts still save with the warning (`checkDraw` in
  `src/b2b/bank/forms.ts`).
- Docker still not installed (checked 2026-10-22: no Docker Desktop; WSL component not enabled).

## Decisions made
See the **Decisions log** at the top of the build prompt. Phase 1 implementation choices:
- Roles: `org_admin` serves as both TPO admin and company admin (label by org type); no separate enum values.
- Legacy org type `coaching_institute` kept (the pilot's public test uses it); not offered when creating orgs.
- Candidate sessions are Supabase anonymous users linked to the candidate row on first token use.
- Super admin stays `user_roles.role = 'admin'` (owner's account only, granted by SQL; no UI path).

## How to run locally
```sh
npm install
npm run dev                 # add VITE_B2B_ENABLED=true to .env.local for B2B pages
npm test                    # Vitest (about 4 min; --maxWorkers=2 if memory is low)
npm run test:db             # RLS + DB tests on embedded Postgres (PGlite)
npm run typecheck:b2b       # strict TS for new B2B code
npm run quality             # fails only on NEW lint/type errors (quality:update after fixing old ones)
npm run build:e2e && npm run e2e   # B2C smoke + screenshots (local win32 baselines are not committed)
npx -y deno@latest check supabase/functions/<fn>/index.ts
```

## Baselines (2026-10-21, `feat/b2b-v1-phase1`)
- Vitest 431 pass / 3 skipped; Playwright 36 pass. tsc (app) 25 errors; ESLint 132 errors (both baselined).
- Prod unchanged: 38/38 migrations applied; 5 V1 migrations + 2 Phase-0 migrations pending your approval.
