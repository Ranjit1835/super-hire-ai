# Step 6 — Evaluator and audio metrics

## What changed

### Audio metrics — `_shared/audio-metrics.ts` (pure, server-side)
Computed from the per-answer timings recorded in Step 5 plus the transcript (no audio is stored):
- words per minute (voice answers with usable timings only), pause before answering (avg / max),
  longest pause inside an answer, average answer length overall and **by difficulty**
- filler counts for um, uh, like, basically, actually, you know (whole words; "you know" as a phrase; "like" after
  pronouns/"would" is treated as a verb). Marked `filler_reliability: "low"` because Chrome's recogniser drops
  most "um/uh" — the count is a lower bound, and the report says so.
- typed answers are counted but excluded from timing metrics; notes explain what's missing.

### Evaluator — `_shared/evaluator.ts` (`evaluator-2026-09-v1`)
- A **separate** model call over the full transcript + audio metrics, with a fixed rubric and 0–10 anchors for the 8
  dimensions (technical_knowledge, communication, language, analytical_thinking, problem_solving, confidence,
  role_specific_knowledge, resume_project_knowledge) plus per-topic scores, primary_gap, readiness_level,
  recommended_focus.
- Prompt: Indian-accented STT caveat ("penalise only clear conceptual mistakes"), audio metrics as objective input
  for communication and confidence, transcript fenced as data.
- **Enforced in code, not trusted to the model:**
  - schema validation; on failure **one retry** with the errors fed back, then the evaluation is marked failed
  - every evidence quote must occur (after normalising case/punctuation) in the **student's** answers; invented
    quotes are dropped; a score left with no valid quote becomes `"insufficient_data"`
  - topics must be module topics; skipped topics become "Not assessed in this interview"
  - overall score = mean of scorable dimensions; `passed` vs the module's pass mark
  - `readiness_level` is **derived by rule** (ready: overall ≥ pass mark and technical / module / communication all
    ≥ pass − 2; not_ready: overall < pass − 2; otherwise developing), so batch filters are consistent. The model's
    label is kept as `model_readiness_level` for audit. With < 3 scorable dimensions the model's label is used.
- Stored result matches the specified JSON (`score` is a number or `"insufficient_data"`).

### Database — `20260923000007_b2b_evaluations.sql`
- `b2b_evaluations`: one row per (interview, evaluator_version) with result, audio_metrics, overall_score,
  readiness_level, primary_gap, attempts, llm_usage, error. **Re-running after a rubric change adds a new version
  row; history is kept.**
- `b2b_latest_evaluations` view (**security_invoker**, so RLS applies — a test proves removing it would leak other
  orgs' scores).
- Service-role functions: `b2b_claim_evaluation` (one evaluator at a time per interview; failed or stale claims are
  retaken), `b2b_save_evaluation`, `b2b_interviews_needing_evaluation(version, org?)`.
- RLS: students read their own, staff their org's, nobody writes directly.

### Functions
- `_shared/evaluate-interview.ts`: claim → metrics → evaluator (medium reasoning, 60 s timeout, temperature 0.2) →
  validate/ground → retry once → save. `B2B_EVALUATOR_MODEL` (default `HIRESUME_MODEL_SMART`, else the interview
  model) lets you use a stronger model for scoring only.
- `b2b-interview` starts evaluation in the background (`EdgeRuntime.waitUntil`) as soon as an interview completes.
- New `b2b-evaluate`: `evaluate` (student own / staff / super-admin; joins a running evaluation instead of paying
  twice), `get`, and `sweep` (super-admin or `x-cron-secret: $B2B_CRON_SECRET`) — evaluates finished interviews that
  lack a result **at the current evaluator version**. After changing the rubric, bump `EVALUATOR_PROMPT_VERSION`,
  deploy, and run `sweep` to re-score.

### Student UI
- Finish screen shows "Scoring your answers…" then the full report (polls if scoring was already running).
- `/learn/report/:interviewId`: readiness, overall score vs pass mark, main gap, what to practise next, each skill and
  topic with its reason and the exact quotes it's based on, "How you spoke" (rate, pauses, fillers with the
  lower-bound note, answer length by difficulty), and the full transcript.
- `/learn` lists past interviews with score and readiness.

### Calibration — `scripts/b2b-calibrate.ts` + `scripts/calibration-lib.ts`
```
npm run calibrate:b2b -- template --org <org-uuid> --limit 30 > trainer-sheet.csv   # sheet for trainers
npm run calibrate:b2b -- compare --human trainer-sheet.csv [--version evaluator-2026-09-v1] [--out report.json]
```
(env `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`; or `--ai ai.json` offline). Per dimension: n, human vs AI mean,
bias, MAE, % within ±1, Pearson r, quadratic-weighted kappa, AI-insufficient count, and — when two trainers scored
the same interview — the **trainer↔trainer baseline**, plus readiness agreement with a confusion matrix.
Target: QWK ≥ 0.6 and MAE ≤ 1 per dimension, comparable to the trainer baseline.

### Tests
Metrics/evaluator 13 · calibration 5 · evaluations DB 6 (mutation-checked) · report UI 4 · finish-screen integration.
Total suite: 175 pass (3 staging-only skipped).

## Not verified yet
Real model output quality (needs deployment + a key). Recommended before the pilot: run 10–20 internal mock
interviews, have two trainers fill the sheet, and run `compare`.

## Verify
1. `npm test`.
2. Deploy: `supabase db push`, `supabase functions deploy b2b-interview b2b-evaluate`; optional secrets
   `B2B_EVALUATOR_MODEL`, `B2B_CRON_SECRET`.
3. Finish an interview → report appears within about a minute; open any skill → quotes are your own words.
4. `select evaluator_version, overall_score, readiness_level, result->'model_readiness_level', result->'dropped_evidence' from b2b_evaluations;`
5. Change `EVALUATOR_PROMPT_VERSION`, redeploy, call `b2b-evaluate {action:"sweep"}` as super-admin → a second
   version row per interview.
6. Optional daily sweep: schedule an HTTP POST with `x-cron-secret` from Supabase Cron (Integrations → Cron).
