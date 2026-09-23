# Step 5 — Adaptive interview engine

## What changed

### Database — `20260923000005_b2b_interviews.sql` (+ `…000006` cron)
- `b2b_interviews`: org, student, module id + **version + full spec snapshot**, engine `state` (persisted after every
  answer), status (`in_progress | completed | abandoned | cancelled`), `end_reason`, `prompt_version`, `client_meta`,
  `started_at` / `deadline_at`. One live interview per student (partial unique index).
- `b2b_interview_turns`: one row per question and per answer, with topic, difficulty, `meta` (answer timings, in-turn
  assessment, LLM usage/latency, rule overrides) and `client_turn_id` (unique → idempotent retries).
- Service-role-only functions: `b2b_start_interview` (serialised per student; resumes an existing live interview;
  checks module active/version/pack plan; **consumes the credit atomically** via Step 2), `b2b_record_opening`,
  `b2b_record_turn` (row lock + idempotency + optimistic turn check), `b2b_end_interview` (0 answers → cancelled +
  **credit refunded**), `b2b_cancel_failed_start` (LLM outage at start → refund), `b2b_expire_stale_interviews`
  (abandon 30 min after deadline; runs lazily and every 15 min via pg_cron).
- RLS: students read their own interviews/turns; staff read their org's; no direct writes by anyone.

### Engine — `supabase/functions/_shared/interview-engine.ts` (pure, unit-tested)
State (as specified): `module_id, current_topic, difficulty, topics_covered, topics_remaining, per_topic_signal,
turn_count` (+ `questions_on_topic`). The model proposes; the rules decide:
- **Difficulty**: strong → up, weak / no answer → down, adequate / off-topic → same (beginner → intermediate → advanced).
- **Topics**: the model may only pick from an enum of allowed topics; an invented topic is overridden and the question
  regenerated for a real one. Moves on when the model says the topic is covered, when the per-topic cap is hit
  (≈ turns/topics + 1, max 3), or when the remaining questions are needed to reach every remaining topic.
- **End**: all topics covered, max questions reached, or < 45 s left. The final answer skips the model call.
- **Follow-ups on what the student said**: last answer + the last 6 turns go into each call; the prompt requires
  building on the student's words and probing misconceptions without teaching.

### Prompts — `_shared/interview-prompts.ts` (`interviewer-2026-09-v1`)
Topic whitelist, style notes framed as guidance that can't override rules, Indian-English STT caveat, no praise / no
answers, ≤ 45-word spoken questions, company packs never claim to represent the company, student answers wrapped in
`<student_answer>` and sanitised against tag break-out (prompt injection).

### Edge function — `b2b-interview` (`start | resume | answer | end | current`)
- LLM via new `_shared/b2b-llm.ts` (same Gemini key/endpoint; 20 s timeout, one retry with jitter, `reasoning_effort:
  low`, auto-drops the parameter if a model rejects it, returns token usage for Step 9).
- Opening question fails → interview cancelled, credit refunded, "try again in a minute".
  A mid-interview model failure never blocks the student: rules pick the topic and a deterministic fallback question
  is used (flagged `fallback` in turn meta).
- Retry of a stored answer (same `clientTurnId`) returns the stored result with no second model call; a stale turn
  number returns 409 with the latest state so the client resyncs.

### Browser — voice pipeline unchanged in kind (Web Speech API), tuned for B2B
- `useVoiceAnswer`: `en-IN` recognition, Indian-English TTS voice when installed, answer ends after **5 s of silence
  after speech starts** (or 15 s of no speech) or on **Done answering**; Chrome's self-ended sessions are restarted
  without losing words; measures `response_latency_ms` (pause before answering), `speech_ms`, `max_pause_ms`,
  `question_tts_ms`, confidence, restarts, `ended_by` (Step 6 audio metrics).
- `/learn/interview/:moduleId`: pre-flight (tips, remaining interviews, browser check, **type-instead** option), live
  view (question, live transcript, timer, progress, Done, End), retry banner with the answer kept in sessionStorage,
  resume after reload (re-sends an in-flight answer with the same id), 409 resync, mic-blocked → typing fallback,
  finish screen (cancel = refund message).
- `/learn`: Start / Resume per module, "Continue your … interview" banner, completed counts, disabled when out of
  interviews or another interview is live.
- The B2C `/voice-interview` and `mock-interview` function are untouched.

### Tests
Engine 14 · prompts/meta 8 · DB lifecycle 13 (mutation-checked: removing the turn check, owner check, refund or RLS each
fails tests) · voice hook 7 (fake recogniser + fake timers) · interview room 8 · learn start/resume 3.

## Capacity: 60+ concurrent students from one lab

**Load shape.** Each student answers roughly every 45–90 s (question read aloud ~8 s, thinking, 20–60 s answer, 5 s
silence cut-off). 60 students ≈ **40–80 answer requests/min** steady, plus a start burst (60 starts in ~20 s ≈ 3 req/s).
Each answer = 1 LLM call (≈1.5–3k input tokens; ~150 visible output + thinking), occasionally a 2nd short call when a
topic is overridden; the last answer makes none.

| Layer | Assessment | Action |
|---|---|---|
| **Gemini rate limits** | Free tier (~10–15 RPM) **will fail** a lab. Paid tier limits for flash models are in the 1,000+ RPM range. | **Use a paid Gemini key** and confirm the RPM/TPM for `gemini-3.6-flash` in AI Studio before the pilot. |
| **LLM latency** | Thinking model; dominant part of "answer → next question" (expect ~2–6 s). | `reasoning_effort: low`, 20 s timeout, one jittered retry; UI shows "Thinking about your answer…". Measure p90 with the load test; switch `B2B_INTERVIEW_MODEL` if > 8 s. |
| **Edge functions** | ~5 DB round trips + 1 LLM call per request; pilot total ≈ 120 students × 6 interviews × ~13 requests ≈ 10k invocations. | None needed. |
| **Postgres** | Tiny row-level writes; one advisory lock per student start. | None needed. |
| **Browser speech-to-text** | Chrome streams each mic to Google's speech service; **no published quota**; 60 streams from one college IP is untested. ~2 Mbps upstream total. | Lab rehearsal with 10 → 30 → 60 PCs; ask college IT to allow Google speech endpoints. Typing fallback exists. |
| **Room acoustics** | 60 students speaking in one room → open mics pick up neighbours → garbage transcripts. **Likely the #1 real-world risk.** | **Headsets with boom mics**, or split the batch into two sessions. |
| **Browsers** | Speech recognition needs Chrome or Edge; Firefox has none, Safari is unreliable. | Pre-flight warns and offers typing; standardise lab PCs on Chrome. |
| **Retry storms** | Server retries once with jitter; client never auto-loops (student taps Try again); retries are idempotent. | — |

**Run the load test** (staging only; uses real LLM calls):
```
STAGING_SUPABASE_URL=… STAGING_SUPABASE_ANON_KEY=… STAGING_SUPABASE_SERVICE_ROLE_KEY=… \
  npm run load-test:b2b -- --students 60 --answers 4 --ramp 20
```
It creates a throwaway org + 60 students, runs them concurrently with realistic think time, prints p50/p90/p99 per
action, error codes, LLM latency / retries / fallbacks and tokens per call, then deletes everything (`--keep` to inspect).
**Not yet run** — needs a staging project with the migrations and functions deployed.

## Verify manually
1. `npm test` (147 pass, 3 staging tests skipped).
2. Deploy: `supabase db push`, `supabase functions deploy b2b-interview`, set a paid `GEMINI_API_KEY` secret.
3. Student account (Chrome): `/learn` → Start interview on SQL → allow mic → answer 2 questions aloud; watch difficulty
   follow your answers (`b2b_interview_turns.difficulty`) and the topic chip change.
4. Reload the tab mid-interview → "Resume interview (question N of M)" → continues from the same question.
5. Turn Wi-Fi off, answer, see "Connection lost…", turn it back on, **Try again** → one answer stored, not two.
6. Start and immediately End → "credit was returned"; `/learn` still shows the same remaining count.
7. Staff: `select turn_index, role, topic, difficulty, meta from b2b_interview_turns where interview_id = …`.
