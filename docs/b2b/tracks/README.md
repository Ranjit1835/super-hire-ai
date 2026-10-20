# V1 tracks

Each track works in its own git worktree and branch, based on `feat/b2b-v1-phase1`.

- **No migration files.** Put proposed schema (tables, columns, functions, policies, grants) in
  `docs/b2b/tracks/<track>.sql`, written as if it were the next migration (it must apply after all existing
  migrations). DB tests load it with `createTestDb({ extraSql: ["docs/b2b/tracks/<track>.sql"] })`. The lead turns it
  into numbered migrations when merging, in order.
- Routes: only in `src/b2b/<area>/routes.tsx`. New frontend code under `src/b2b/<area>/` (strict TS).
- Contracts: `supabase/functions/_shared/contracts/*`. If a contract must change, change it and say so in the summary.
- Never: production access, `supabase db push`, deploys, pushing to `main`, real model or Judge0 calls in tests.
