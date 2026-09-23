# Step 9 — Cost tracking

## What changed
- `20260923000010_b2b_costs.sql`
  - `b2b_usage_log`: one row per billable event — `llm` (model, input/output tokens, latency), `stt` (seconds of
    recognised speech per spoken answer), `tts` (characters the interviewer speaks) — with `org_id`, `interview_id`,
    `purpose` (opening / turn / evaluation) and **cost in INR computed at insert**. Raw units are stored so costs can
    be recomputed.
  - Logging happens **inside the existing SQL write paths** (`b2b_record_opening`, `b2b_record_turn`,
    `b2b_save_evaluation` — same signatures): no extra network calls per turn, atomic with the turn, and retries don't
    double count (tested). Typed answers log no speech time. Failed evaluator attempts are logged too (they cost money).
  - `b2b_pricing`: rates by key — exact model name, pattern (`gemini-%`) or `%` default; `stt:browser`,
    `tts:browser` for speech. The most specific rate in effect wins. **Seeded LLM rate is a placeholder** (Gemini 2.5
    Flash list price $0.30 / $2.50 per 1M input/output tokens at ₹84/USD = ₹25.2 / ₹210) — replace with your real
    rates. Browser speech is ₹0 but minutes and characters are still tracked, so moving to a paid STT/TTS is a rate
    change, not a code change.
  - Super-admin reports: `super_cost_by_org_month` (IST months), `super_cost_vs_revenue` (students × plan price vs
    cost to date, margin, cost share), `super_recompute_costs` (re-price all logged usage after correcting rates).
    Demo orgs excluded by default. Usage and pricing are invisible to institutions and students (RLS; tested).
- `/admin/costs` (linked from `/admin/orgs`): average cost per interview (incl. evaluation), this month, all time,
  speech minutes; cost vs plan revenue per institution (cost share > 30 % highlighted, negative margin in red);
  institution × month table (interviews, AI calls, tokens in/out, speech minutes, TTS characters, cost, per
  interview); plan price per student editor; rates editor with history; "Recalculate all costs".
- Tests: DB 9 (pricing specificity, per-path logging, retry idempotency, typed answers, failed attempts, reports,
  demo exclusion, recompute, access) + UI 5.

## Rough expectation (placeholder rates — verify with real traffic)
Per 12-question interview: ~12 turn calls × (~2.5k input + ~0.6k output incl. thinking) + evaluation (~8k input +
~3k output) ≈ 38k input + 10k output tokens ≈ **₹3 per interview**. Pilot (120 students × 6) ≈ 720 interviews ≈
**₹2,000–2,500** in model cost. Treat this as an order of magnitude until the first real interviews are logged —
thinking-token usage varies a lot by model and reasoning setting.

## Known limits
- Tokens of provider calls that failed before returning (timeouts, 5xx) aren't reported by the API and can't be logged.
- Revenue is an estimate from plan price × enrolled students; there is no billing integration (non-goal).

## Verify
1. `npm test` (225 pass).
2. Deploy: `supabase db push`.
3. `/admin/costs` → set the Pilot price per student; add a rate row for your exact model from your Gemini invoice.
4. Run one interview end to end → the month table shows 1 interview, ~13 AI calls, speech minutes and a cost;
   "Recalculate all costs" re-prices after you change a rate.
5. Sign in as an org admin: `select * from b2b_usage_log` returns nothing.
