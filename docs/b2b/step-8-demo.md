# Step 8 — Demo mode

## What changed
- `scripts/demo-lib.ts` — deterministic generator for **Demo Engineering College**: 40 fictional students (Indian
  names, JNTU-style roll numbers) in 3 batches (CSE A, CSE B, ECE), 4 modules (SQL, Java Fundamentals, DSA Basics,
  HR / Behavioral), ~120 completed interviews over the last five weeks (~1,400 transcript turns).
  - Archetypes: strong, improving, steady, needs technical / communication / analytical, struggling, not attempted.
  - Transcripts use a topic content bank (correct facts, examples, typical misconceptions); communication-weak
    students get fillers, slower speech and long pauses, so the **audio metrics are computed by the real code**.
  - Scores go through the **real evaluator validator** (evidence grounding + readiness rule): every quote is a whole
    sentence from that interview's answers. Result: 7 ready · 24 developing · 6 not ready · 3 not attempted,
    average +0.6 first → latest, realistic weakest topics.
- `scripts/b2b-demo.ts` — `npm run demo:b2b -- seed | reset | delete | status [--admin-email you@x.com] [--seed N]`.
  Creates the org (`is_demo = true`, Pilot plan for a year), batches, modules, 40 accounts on
  `@demo.hiresume.invalid` with random unstored passwords (nobody can sign in as them), memberships, usage,
  interviews, turns and evaluations. Partial failures roll back. `--admin-email` makes your existing account the
  demo's org admin so you can present from your own login.
- `20260923000009_b2b_demo.sql`
  - `b2b_demo_reset(org)` (service role): **refuses any org that isn't `is_demo`**, deletes children in FK-safe order,
    and returns only accounts that are on the demo domain **and** belong to no real org — a real person attached as
    demo admin is never deleted (the script re-checks the domain before deleting).
  - The evaluation sweep skips demo orgs, so fictional data never costs LLM calls.
- "Clearly marked": amber banner + DEMO badge on every screen (existing), PDFs watermarked "DEMO - fictional student
  and scores", Excel gets a "DEMO INSTITUTION" line and a "Students (DEMO)" sheet.
- **Dashboard fix found while building the demo:** a student's readiness was taken from their latest interview only,
  so a good HR round showed "Ready" over weak SQL. Readiness is now the **lowest of the latest result in each module
  attempted** (test added).
- Visual review of the dashboard and drill-down in Chrome via a dev-only in-memory preview (`/dev/b2b-demo`, not in
  production builds). Fixed: stray vertical scrollbar in the tab bar; semi-transparent sticky header letting content
  show through; demo quotes cut mid-sentence.

## Verify
1. `npm test` (211 pass).
2. Deploy migrations (`supabase db push`), then with the production URL + service key:
   `SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npm run demo:b2b -- reset --admin-email <your email>`
3. Sign in → `/org` → Demo Engineering College → Readiness: banner, 40 students, heatmap, filters, exports
   (PDF watermark, Excel "(DEMO)").
4. `npm run demo:b2b -- reset` again → same data (seeded), no duplicate accounts. `delete` removes everything;
   `status` confirms.
5. Try `b2b_demo_reset` on a real org id in the SQL editor → "REFUSED".
6. Local look without a backend: `npm run dev` → `http://localhost:5173/dev/b2b-demo/`.
