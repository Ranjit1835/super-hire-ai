# HiResume B2B — Progress

> Read this first at the start of every session; update it at the end.
> Spec: `docs/b2b/hiresume-b2b-build-prompt.md` · Audit: `docs/b2b/AUDIT.md`

_Last updated: 2026-10-18_

## Where things stand

**Current phase: Phase 0 (audit) is done. Waiting for your answers to AUDIT.md section 12 and a "go" for Phase 1.**

There's no Phase 1 code yet. The 2026-09 B2B pilot (10 steps, `docs/b2b/step-*.md`) is live in production but has no
users (0 organisations).

## Done
- [x] Phase 0: read-only audit → `docs/b2b/AUDIT.md` (stack map, B2C inventory, existing B2B status, prod schema + RLS
      snapshot, gap analysis, voice diagnosis, architecture proposals, cost model, questions)
- [x] Earlier (2026-09-23/24): B2B pilot steps 1–10 on `main` (tenancy, plans, invites, modules, adaptive interview,
      evaluator, dashboard, demo, costs, public test)

## In progress
- Nothing. Waiting for your decisions.

## Next (once you say go)
1. Merge `fix/live-issues` → `main` and push (only with your OK; see Q3).
2. Phase 1 branch `feat/b2b-foundations` from `main`.
3. Test baseline first: Playwright B2C smoke tests + screenshot baseline, before touching any shared module.
4. Then tenancy evolution, audit log, consents, feature flags, AI gateway, super admin v1, seed script.

## Decisions made
| Date | Decision | By |
|---|---|---|
| 2026-09-24 | Production-only (no staging) for the pilot | you |
| 2026-09-26 | Gemini instead of Anthropic for all AI (billing) | you / me |
| 2026-09-29 | Interviews are voice-only; typed mode removed (B2C + B2B) | you |
| 2026-10-18 | Phase 0 docs are uncommitted, waiting on where to commit them (see blockers) | me |

## Open decisions / blockers
- **Q1 framework** (spec says Next.js; repo is Vite). **Q2 LLM provider** (spec says Claude; repo uses Gemini).
- ~~Q3 prod drift~~: wrong. The commits were already on `origin/main`; only local `main` was stale. Resolved 2026-10-20.
- Q4–Q8: evolve the pilot tables, super-admin source, flags for existing B2B routes, staging project,
  proctoring branch.
- Section 14 questions (Q9–Q17), Resend domain + MX (Q18), plan prices (Q19), Design DNA references (Q20).
- Commit target for `AUDIT.md`/`PROGRESS.md`: these files and the spec are untracked on `fix/live-issues`.

## Manual checks for you
1. **Voice fix on real phones** (the 2026-09-29 fix was never confirmed on devices): open https://hiresume.in/voice-interview
   on Android Chrome and on iPhone Safari, start an interview, and answer 3 questions with the phone speaker (no
   headphones). Expected: you hear each question, the interviewer does not answer itself, and it doesn't end early.
2. Tell me roughly how long each reply takes, from finishing your answer to hearing the next question. This
   is the baseline that Phase 5 will be measured against.

## How to run locally
```sh
npm install
npm run dev            # Vite dev server (B2C + B2B routes; /dev/b2b-demo preview in dev only)
npm test               # Vitest: 51 files / 370 tests (about 4 min on this machine; use --maxWorkers=2 if memory is low)
npm run test:db        # RLS + DB tests on embedded Postgres (PGlite), no Docker needed
npx -y deno@latest check supabase/functions/<fn>/index.ts   # type-check an edge function
npm run build          # SPA + SSR + pre-render (fails on HTML-structure errors)
npm run demo:b2b -- status   # demo college seeder (needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)
```
Environment: `.env` holds `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID`.
Edge function secrets live in Supabase (names in AUDIT.md section 1). Supabase project: `zhfahrrxuguagwbujkiz`
(prod; the CLI is linked).

## Baselines (2026-10-18)
- Tests: 370 pass / 3 skipped. `tsc` (app): 25 errors, strict off. ESLint: 132 errors / 27 warnings.
- Prod: 38/38 migrations applied; 34 public tables, all with RLS; 0 B2B organisations.
