# Gemini Live spike (track C, time-boxed)

**Question:** should the startup portal's V1 interview use Gemini Live (browser connects straight to Google with an
ephemeral token, no voice server) instead of the beta browser-speech flow? LiveKit Agents stays the plan unless this
clearly wins.

Nothing here was measured yet: the build machine has no API key and no microphone. The code is ready; the owner runs
the steps below and fills in the results table.

## What was built

- `b2b-interview` action **`liveToken`** (`supabase/functions/b2b-interview/v1.ts`): asks Gemini for a single-use
  ephemeral token (`POST https://generativelanguage.googleapis.com/v1alpha/auth_tokens`, `uses: 1`, session must open
  within 2 minutes, token valid 30 minutes). Answers **503 `LIVE_NOT_CONFIGURED`** when `GEMINI_API_KEY` is unset.
  Allowed for the subject of a live interview, or (no interview id) staff / super admin. The API key never reaches the
  browser.
- Dev-only page **`/interview/v1/live-spike`** (`src/b2b/interview/LiveSpikePage.tsx`; routed only in `npm run dev`
  or with `VITE_B2B_LIVE_SPIKE=true`): microphone → 16 kHz PCM → WebSocket `BidiGenerateContentConstrained` with the
  token; plays the 24 kHz reply audio; runs a scripted 5-question interview; shows per-turn latency, p50 / p95 and
  session length; "Download results (JSON)".
- Latency definition: **candidate's speech end → first reply audio chunk received**. Speech end comes from a local
  energy detector (the last loud frame, 600 ms hang-over), so it excludes the hang-over. Playback start adds a few
  milliseconds on top.

**To verify against Google's current docs before trusting a number** (APIs in preview change): the token endpoint and
body, the WebSocket URL, the default model name (`gemini-live-2.5-flash-preview`; override with the
`GEMINI_LIVE_MODEL` secret), message field names, and the session limits below.

## How to run it (about 45 minutes)

1. `supabase/functions/.env`: `B2B_ENABLED=true`, `GEMINI_API_KEY=<key>` (optional `GEMINI_LIVE_MODEL=<model>`).
   `.env.local`: `VITE_B2B_ENABLED=true`.
2. `npx supabase start -x studio,imgproxy,vector,logflare`, `npx supabase functions serve b2b-interview`, `npm run dev`.
3. Sign in as a staff user (TPO admin, recruiter) or the super admin. Open `http://localhost:8080/interview/v1/live-spike`
   in Chrome, **with headphones**.
4. **Latency run (3 sessions):** "Get token and connect", answer all 5 questions naturally, "Stop", "Download results".
   Do one run on home Wi-Fi and one on a phone hotspot (~2 Mbps) to approximate lab conditions.
5. **Indian-English accuracy (5 clips):** take 5 short answers from real students (or AI4Bharat Svarah clips) covering
   different accents and some technical terms (SQL, JSON, Kubernetes, hash map). Play each into the microphone during
   a session (or speak them) and compare the "you" transcript lines with the reference text: count word errors and,
   separately, wrong technical terms.
6. **Session length:** leave one session open and idle-talk until the server sends `goAway` or closes; note the
   minutes and the close code. Audio-only sessions are documented at about 15 minutes without context-window
   compression or session resumption (**to verify**), which is shorter than a 20-minute interview.
7. **Barge-in:** speak over the interviewer once; note whether it stops ("Interrupted (barge-in)" in the log).

## What to record

| Measure | Beta flow (today) | Gemini Live | Notes |
|---|---|---|---|
| Turn latency p50 / p95 (ms) | from the room's dev panel (`?dev=1`) or `[VOICE-LATENCY]` logs | | target ≤ 1,500 ms |
| Latency on ~2 Mbps hotspot p50 / p95 | | | |
| Indian-English: word errors on 5 clips | | | |
| Technical terms recognised (of N) | | | |
| Max session length before `goAway` | n/a | | 20-minute interview needs |
| Barge-in works | no (mic off while speaking) | | |
| Cost per 20-minute interview (₹) | AUDIT.md section 9 | **to verify** | see below |

**Cost (to verify from Google's published pricing on the day):** a 20-minute interview is ~10 minutes of candidate
audio in and ~6–8 minutes of model audio out, plus text tokens for the transcript. Per-minute audio is billed as
tokens (about 25 tokens per second of audio, **to verify**), so: input ≈ 600 s × 25 = 15k audio tokens, output ≈
450 s × 25 ≈ 11k audio tokens. Multiply by the current Live-model audio input / output prices, add the context
re-read on every turn (it grows over the session and is often the biggest part), convert at the current ₹ rate, and
compare with AUDIT.md section 9's cost for the beta flow plus the LiveKit/Deepgram target.

## Decision rule

Use Gemini Live for the **startup portal in V1** only if **all** hold:

1. p50 ≤ 1,500 ms and p95 ≤ 2,500 ms on both networks, and clearly better than the beta flow;
2. Indian-English accuracy at least as good as the beta flow on the 5 clips, with technical terms mostly right;
3. a 20-minute interview fits in one session, or session resumption works reliably in a test;
4. cost per 20-minute interview within the startup plan's margin (AUDIT.md section 9) at the verified prices;
5. the evaluation, injection defence and transcript can still be produced server-side (the transcript lines
   would have to be posted to the server per turn; not built in the spike).

Otherwise **LiveKit stays the plan** and the beta flow carries V1. Either way, the server-side state machine,
evaluator and room UI from track C are reused.
