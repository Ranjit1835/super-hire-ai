# V1 tracks

Each track works in its own git worktree and branch, based on `feat/b2b-v1-phase1`.

- **No migration files.** Put proposed schema (tables, columns, functions, policies, grants) in
  `docs/b2b/tracks/<track>.sql`, written as if it were the next migration (it must apply after all existing
  migrations). DB tests load it with `createTestDb({ extraSql: ["docs/b2b/tracks/<track>.sql"] })`. The lead turns it
  into numbered migrations when merging, in order.
- Routes: only in `src/b2b/<area>/routes.tsx`. New frontend code under `src/b2b/<area>/` (strict TS).
- Contracts: `supabase/functions/_shared/contracts/*`. If a contract must change, change it and say so in the summary.
- Never: production access, `supabase db push`, deploys, pushing to `main`, real model or Judge0 calls in tests.

## Shared conventions (fixed before the tracks start)

**URLs** (all behind the B2B flag)
| Path | Owner | What |
|---|---|---|
| `/assess/start?context=drive\|job_role\|practice&id=<driveId\|jobRoleId\|assessmentId>` | A | Creates or resumes the attempt (`assessApi.start`), then redirects to the runner |
| `/assess/a/:attemptId` | A | The test runner (wrapped in `<ProctoredSession kind="assessment">`) |
| `/c/:orgId/*` | D | College portal for TPO admins and trainers (students, drives, analytics) |
| `/learn/v1` and `/learn/v1/drives/:driveId` | D | Student dashboard and a drive's steps (system check → coding/MCQ → interview → done) |
| `/proctor/review/:sessionId` | B | Staff review timeline for one proctoring session |
| `/proctor/check` | B | Stand-alone system check page (students can run it any time) |

**Proctoring interface**: `src/b2b/proctor/index.tsx` exports `ProctoredSession` and `useProctor()`. Track A wraps the
runner in it and reports editor signals (`paste_attempt`, `large_paste`, `typing_burst`) through `useProctor().report`,
and honours `paused` / `onAutoSubmit`. Track B implements it without changing those props.

**Dependencies** are already installed (don't run `npm install`): `@monaco-editor/react`, `@mediapipe/tasks-vision`,
`exceljs`, `zod`, `@tanstack/react-query`, shadcn/ui components in `src/components/ui`.
