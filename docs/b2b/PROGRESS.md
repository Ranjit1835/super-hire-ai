# HiResume B2B — Progress

> Read this first at the start of every session; update it at the end.
> Spec + **Decisions log**: `docs/b2b/hiresume-b2b-build-prompt.md` · Evidence and numbers: `docs/b2b/AUDIT.md`

_Last updated: 2026-10-20_

## Where things stand

**Phase 0 is done and reviewed. Phase 0 follow-ups are on branches waiting for your review. Phase 1 starts only when
you say "go".**

The 2026-09 B2B pilot (10 steps, `docs/b2b/step-*.md`) is live in production with 0 organisations. The follow-up
branch switches it off by default.

## Waiting on you
1. **Move `main` and tag it** (my push/merge to `main` was blocked by the permission system). From the repo:
   ```sh
   git checkout main && git pull --ff-only origin main
   git merge --ff-only fix/live-issues
   git tag -a live-2026-10-20 -m "Live production state merged into main (2026-10-20)"
   git push origin main live-2026-10-20
   ```
   `fix/live-issues` = `origin/main` + the Phase 0 docs commit, so this is a fast-forward and the deploy it triggers
   ships the same code as now.
2. **Review and merge `chore/b2b-followups`** (it contains `fix/b2b-lockdown`). See "Branches to review" below.
3. **Apply two migrations** after review: `20261020000001_b2b_evaluation_claim_cap.sql`,
   `20261020000002_b2b_pricing_rates.sql`.
4. **Deploy the edge functions** from `main` after the merge (B2B stays off because `B2B_ENABLED` is not set):
   `npx supabase functions deploy b2b-interview b2b-evaluate b2b-public-test b2b-invites mock-interview --project-ref zhfahrrxuguagwbujkiz`
5. Decide on the deploy proposal (AUDIT.md section 13): branch protection + CI deploys.
6. Run the voice check on phones (below) and tell me roughly how long replies take.
7. Optional clean-up: the archive tag for `feat/proctoring` (`git tag archive/proctoring-2026-09-28 feat/proctoring`),
   deleting merged branches, and the 1 leftover anonymous user in production.

## Branches to review (all based on `0a6e936` = what `main` becomes)
| Branch | Commits | What |
|---|---|---|
| `fix/b2b-lockdown` | `721d929` | B2B switched off by default (server `B2B_ENABLED`, public test `B2B_PUBLIC_TEST_ENABLED`, frontend `VITE_B2B_ENABLED`); anonymous sessions refused while the public test is off; evaluation retry cap on every path (migration `…0001`). |
| `chore/b2b-followups` (on top of the above) | `f0e00dc`, `a8409a0`, docs | Real Gemini rates in the cost log (migration `…0002`); voice turn-latency logging (no behaviour change); spec Decisions log + Next.js/Claude assumptions fixed; AUDIT cost model re-verified with break-even and pooled credits; deploy proposal. |

## Done
- [x] Phase 0 audit (2026-10-18): `docs/b2b/AUDIT.md`
- [x] Secret scan of all history (2026-10-20): clean. Only two Supabase **anon** keys were ever committed (in
      `.env`; public by design). No service-role keys, API keys, tokens, private keys or DB passwords.
- [x] Docs committed (`0a6e936`) and `fix/live-issues` pushed (Vercel made a preview, not a production deploy)
- [x] Deploy path investigated (AUDIT.md section 13)
- [x] Membership-less model-call paths found and fixed (on `fix/b2b-lockdown`)
- [x] Super admin check: only one admin row in prod (`ra***@gmail.com`); `user_roles` has no write policy and sign-up
      inserts `'user'`, so there's no UI path to become admin
- [x] Cost model re-verified on vendor pages; rates migration written
- [x] Turn-latency logging added (B2C `/voice-interview` and the B2B interview)

## Next (when you say go): Phase 1 — Foundations
1. Local Supabase (Docker) running; migrations replayed locally.
2. Test baseline first: Playwright B2C smoke tests + screenshot baseline; ESLint baseline file (132 errors).
3. Strict `tsconfig` for new B2B code.
4. Reshape pilot tables: `org_type` gains `company`; role columns → `text` + `CHECK`; `settings` jsonb on
   organizations; org credit pool (replaces per-student usage); audit log; itemised consents with withdrawal.
5. AI gateway (provider-agnostic, per-feature config, context caching, exact-match cache, single-flight, cost log,
   quotas).
6. Super admin v1 (plain UI), feature flags, B2B layouts, seed script (300-student demo college).

## Decisions made
See the **Decisions log** at the top of the build prompt (2026-10-20). Earlier: production-only for the pilot
(2026-09-24, now replaced by local Docker + staging before the pilot), Gemini instead of Anthropic (2026-09-26),
voice-only interviews (2026-09-29).

## Corrections
- Phase 0 said `8ed509e`/`857c330` weren't on GitHub. Wrong: they were on `origin/main`; I compared against an
  unfetched remote. Only local `main` was behind.

## Manual checks for you
1. **Voice on real phones.** Open https://hiresume.in/voice-interview on Android Chrome and on an iPhone (Safari),
   start an interview, answer 3 questions on the phone speaker (no headphones). Expected: you hear each question,
   the interviewer doesn't answer itself, it doesn't end early.
2. **After the latency logging is deployed:** run one interview, then in Supabase → Edge Functions → mock-interview
   → Logs, search `[VOICE-LATENCY]`. Expect one line per answer with `turn_end_to_first_audio_ms` and its parts.
3. **After the lockdown is deployed:** `https://hiresume.in/org` shows the 404 page; `/admin/enquiries` still works
   for you; a POST to `/functions/v1/b2b-interview` returns `404 {"code":"B2B_DISABLED"}`.

## How to run locally
```sh
npm install
npm run dev            # B2C only; add VITE_B2B_ENABLED=true to .env.local to see B2B pages
npm test               # Vitest (about 4 min; use --maxWorkers=2 if memory is low). Runs with B2B on.
npm run test:db        # RLS + DB tests on embedded Postgres (PGlite)
npx -y deno@latest check supabase/functions/<fn>/index.ts   # type-check an edge function
npm run build          # SPA + SSR + pre-render
```
B2B edge functions also need `B2B_ENABLED=true` in their secrets (local: `supabase/functions/.env`).
Supabase project: `zhfahrrxuguagwbujkiz` (prod). Read-only queries only; changes go through reviewed migrations.

## Baselines (2026-10-20, branch `chore/b2b-followups`)
- Tests: 380 total, 377 pass / 3 skipped (staging-only). `tsc` (app): 25 errors, strict off. ESLint: 132 errors.
- Prod: 38/38 migrations applied; 34 public tables, all with RLS; 0 B2B organisations; 1 super admin.
