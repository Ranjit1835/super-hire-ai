# Hiresume B2B — Master Build Prompt

> **For Claude Code.** Save this file in the repo as `docs/b2b/hiresume-b2b-build-prompt.md`. It is the single source of truth for the B2B build. Re-read the relevant sections at the start of every session.

---

## Decisions log

Newest first. Where a decision conflicts with older text below, the decision wins; the sections below have been
edited to match. Evidence and numbers: `docs/b2b/AUDIT.md`.

### 2026-10-20 (later): FAST-TRACK, both portals in V1

**Goal:** colleges **and** startups as fast as possible. For V1, speed beats polish. This entry overrides the
"college pilot first" plan below.

**Process**
- **No "go" between phases.** When a phase's checks pass, add a short summary to `PROGRESS.md` and continue. Stop only
  for: production migrations or deploys, paid services, a scope change, or a decision only the owner can make.
- **PRs:** `fix/b2b-lockdown` (#1) and `chore/b2b-followups` (#2) to `main`. Phase 1 is based on `chore/b2b-followups`;
  **one PR per milestone** after that.
- **CI approved** (AUDIT.md section 13). Branch protection on `main`: require a PR and passing checks, **no required
  approvals** (solo).
- **Local Supabase** for development. Production migrations are **batched**: the owner approves them once per milestone.
- **Quality gates stay:** RLS isolation tests, B2C smoke + screenshot tests, B2B flag off in production, no direct
  production writes.
- **Parallel tracks after Phase 1:** up to 3 at a time, run by subagents in separate git worktrees; the lead merges
  them. **Tracks don't create migration files**: they list schema changes, and the lead adds migrations on the
  integration branch, in order.
- **UI:** reuse the existing shadcn/ui + Tailwind components with a **scoped B2B theme**. Design DNA, `paint` and all
  motion work (GSAP, Three.js avatar, Lottie) come **after V1 works end-to-end**.

**Phase 1 — foundations + contracts** (first, not parallel): org types `college` and `company`; roles as text + CHECK;
memberships, invites, audit log, consents, credits. AI gateway: cache, single-flight dedupe, cost log, quotas. Super
admin v1: create college and company orgs, plans and credits, invite org admins, usage page. **Every V1 B2B table** plus
TypeScript types and API contracts (stubs), so the tracks can build in parallel. B2C smoke + screenshot baseline; RLS
isolation tests.

**V1 tracks (after Phase 1)**
- **A. Assessment engine:** question bank (global + org), AI generation with sandbox verification, Judge0, runner
  (Monaco, autosave, server timer, randomization, single session), grading, MCQ (aptitude + CS). Edit history logged from
  day one (replay UI later). Judge0 in local Docker for development; if it can't run on the owner's machine, the owner
  creates the DigitalOcean Bangalore server.
- **B. Proctoring V1:** system check, consent, entire-screen share enforcement, single-display check, screen + webcam
  snapshots, browser events, MediaPipe face checks (no face, multiple faces, looking away via head pose), speech
  detected during the coding test (VAD), Standard / Strict / Maximum policies, integrity score with a review timeline.
- **C. Interview V1:** the pilot's adaptive interview and evaluator with the beta voice flow, plus a code walkthrough of
  the candidate's coding submission. **Time-boxed spike in parallel:** Gemini Live API with ephemeral tokens (browser
  connects directly, no voice server); measure latency, Indian-English handling, session-length limits and cost per
  20-minute interview. If it clearly beats the beta flow at an acceptable cost, use it for the startup portal in V1;
  otherwise LiveKit stays the plan.
- **D. College portal:** student import with dedupe, drives with eligibility filters, student dashboard, TPO analytics
  with filters, CSV/XLSX export, results release, pooled credits.
- **E. Startup portal:** role from JD → skills matrix, invites (email + CSV), candidate token flow (coding + AI
  interview), candidate report (scores, code, transcript, integrity timeline), pipeline table, expiring share links,
  credits.

**After V1 (fast-follow):** gaze calibration, phone detection, multi-speaker audio, face match, plagiarism, live drive
monitor, code replay UI, kanban, candidate compare, PDF exports, marketing pages, design and motion pass.

**V1 is done when both walkthroughs pass end-to-end on local Supabase:**
- *College:* super admin creates a college → TPO imports a CSV with duplicates → creates a drive (coding + MCQ + AI
  interview) for CSE 2027, CGPA ≥ 7, zero backlogs → 5 test students complete it with proctoring → TPO filters by
  department + integrity band and exports XLSX.
- *Startup:* super admin creates a company → recruiter creates a role from a JD → invites 3 candidates → 2 complete
  coding + interview → recruiter opens the reports and shares one via an expiring link.

Then one production release (batched migrations + functions) for the owner's approval.

### 2026-10-20 (after the Phase 0 review)

**Stack and process**
- **Framework: Vite + React + React Router stays.** No Next.js. B2B gets its own lazy-loaded route tree and
  layout components (the React Router equivalent of route groups). B2B landing pages are **pre-rendered at build
  time** by the existing pre-render step (`scripts/prerender.mjs`, `src/seo/routes.ts`) for SEO.
- **LLM: Gemini stays the default.** The AI gateway is provider-agnostic: model and provider are set **per feature in
  config**, so another provider (e.g. Claude) can be added to one feature later without touching the others. Use the
  provider's **context caching** where available (Gemini: explicit/implicit context caching).
- **Production deploys come from `main` only.** All new work branches from `main` (tagged `live-2026-10-20`).
  Proposal for CI-driven deploys: AUDIT.md section 13.
- **Never write to the production database directly.** Every change is a migration file that the owner reviews and
  applies. Read-only queries are allowed for audits.
- **Environments:** local Supabase (Docker) for development and migration tests now; a paid staging project before
  the first college pilot.
- **TypeScript strict only for new B2B code** (its own `tsconfig`). Don't fix B2C type errors. **Lint:** baseline the
  current 132 errors and fail only on new ones.

**Pilot leftovers**
- All B2B routes are behind a feature flag, **off in production** (frontend `VITE_B2B_ENABLED`, server
  `B2B_ENABLED`; the anonymous public test has its own `B2B_PUBLIC_TEST_ENABLED`). No B2B endpoint may make a model
  call without an org membership (fixed 2026-10-20, branch `fix/b2b-lockdown`).
- **Reshape the pilot tables; no parallel tables.** While they are empty, change role columns from Postgres enums to
  `text` + `CHECK` so role changes stay reversible.
- **Super admin: the owner's account only**, granted by a one-time SQL statement the owner runs. No UI path to
  become super admin.
- **Proctoring branch:** keep `feat/proctoring`, tag it as an archive, don't merge it. Reuse parts.
- genjutsu is installed as standalone skills: invoke **`paint`** and **`cast`** (not `/genjutsu:paint`).

**Section 14 answers**
1. **Hosting:** one server in a region close to India (DigitalOcean Bangalore, $48/month) for Judge0 + the job
   worker during the pilot. Load-test it before the first real drive.
2. **Voice:** LiveKit Agents is the target, **built after the pilot**. Before that, a **bake-off**: Deepgram vs Sarvam
   on Indian-English clips (AI4Bharat's Svarah benchmark plus a few real student recordings), measuring accuracy,
   end-to-end latency from a server near India, and cost per 20-minute interview. **Now:** log turn latency (turn end
   to first audio) in the current voice flow with no behaviour change. The pilot uses the current voice flow,
   labelled **beta**.
3. **Evidence:** periodic screen + webcam **snapshots** by default. **No continuous video for colleges** (lab Wi-Fi
   can't take hundreds of uploads). Startups can enable video later.
4. **Retention:** 90 days for evidence and recordings, configurable per org. Scores and reports stay for the contract
   period.
5. **Results:** practice scores shown immediately; drive results only when the TPO releases them. Practice usage comes
   from **pooled per-college credits**, not unlimited per student (plan: AUDIT.md section 9.7).
6. **Startups:** self-serve signup and payments later. Sales-led V1.
7. **URLs:** path-based.
8. **Department coordinator role:** later.
9. **Under-18:** not activated in V1. Check DOB at import.

**Re-sequenced plan (college pilot first)** — *superseded by the fast-track entry above*:
Phase 1 → Phase 2 (time-boxed: tokens + app shells only) → Phase 3 → Phase 4-lite (system check, consent,
entire-screen share + snapshots, basic camera checks: no face, multiple faces) → Phase 6 core (student import,
drives, TPO analytics) → pilot with one college. Gaze/audio proctoring, the voice upgrade, the startup portal and the
marketing pages come after the first college signs.

---

## 0. How to work

You are the lead engineer turning Hiresume (hiresume.in) into a B2B platform with two new portals, **Colleges** and **Startups**, while the existing **B2C product keeps working exactly as it does today**.

1. **Fast-track (since 2026-10-20).** Work through Section 13 without waiting for a "go" between phases. When a phase's checks pass, add a short summary to `PROGRESS.md` (what was built, manual test steps, test results, open questions) and continue. **Stop only for:** production migrations or deploys, paid services, a scope change, or a decision only I can make. One PR per milestone.
2. **Keep a progress file.** Maintain `docs/b2b/PROGRESS.md` with: done / in progress / next / decisions made / blockers / how to run locally. Read it at the start of every session and update it at the end. I had a long gap last time and lost track of where things stood; this file must make any future gap painless.
3. **B2C is frozen.** Do not change B2C routes, pages, styles, prompts, DB tables or behavior. If a shared module must change, first add tests that lock the current B2C behavior, then change it. Ask me before altering any existing table.
4. **Ask before:** adding a paid service or new infrastructure, changing auth, deleting files or data, or running an irreversible migration. **Never write to the production database directly**: every change is a migration file the owner reviews and applies.
5. **Options, not guesses.** For big decisions give 2–3 options with cost, effort and risk, and recommend one.
6. **Branches and flags.** Work on feature branches from `main` (the only deploy source), commit in small steps with clear messages, and keep every B2B surface behind a feature flag (`VITE_B2B_ENABLED` / `B2B_ENABLED`) until I switch it on.
7. **Quality bar.** TypeScript strict for new B2B code (separate `tsconfig`; B2C type errors are left alone). ESLint: the 132 existing errors are a baseline; no new ones. zod validation on every API input and every LLM output. No secrets on the client. Every new table gets RLS. Every permission is checked server-side.
8. **Reuse, don't fork.** The resume analyzer, Resume Studio and the mock interview agent already exist. Pull shared logic into a services layer and call it from B2B instead of copying it.
9. **Honest copy.** Never write "100% proctoring", "cheat-proof" or "guaranteed" anywhere in the product or marketing. Use "AI proctoring", "integrity score", "flagged for review".
10. **Installed skills.** These Claude Code skills are installed and must be used as described in Section 11: Three.js (`CloudAI-X/threejs-skills`), GSAP (`greensock/gsap-skills`), Motion Design (`lottiefiles/motion-design-skill`), genjutsu (`AThevon/genjutsu`, installed as the standalone skills `paint`, `cast` and `bunshin`), Design DNA (`zanwei/design-dna`). If one isn't available in the session, tell me instead of improvising.

### Definition of done (every phase)
- Acceptance criteria for the phase pass and are demonstrated.
- B2C regression suite and B2C screenshot comparisons pass.
- No new type or lint errors. Migrations are committed and documented.
- `PROGRESS.md` updated, including manual test steps.

---

## 1. What exists today (verify everything in Phase 0)

- **Stack:** Vite + React 18 SPA with React Router 6 and a build-time pre-render step for public pages; Supabase (auth, Postgres, storage, Deno edge functions, pg_cron); **Gemini** (`gemini-3.6-flash`) through a shared AI client; Razorpay (INR only); hosted on Vercel. (Verified in Phase 0; see AUDIT.md.)
- **B2C features:** LLM resume analyzer, Resume Studio (conversational AI resume editor), ATS templates, mock interview agent with voice mode. Voice-to-voice was reported broken in late September 2026.
- **B2B conversion** was started and left half-done after a long gap. Its exact state is unknown; Phase 0 finds it.
- **Domain is `hiresume.in`** (not hireresume.in). Use it in every URL, email, metadata tag and link.

---

## 2. What we're building

| Surface | Users | Core value |
|---|---|---|
| B2C (existing) | Job seekers | Unchanged |
| College portal | Super admin → TPO → students | Proctored coding tests, proctored voice-to-voice AI interviews, resume optimizer, TPO analytics with filters, super-admin usage tracking |
| Startup portal | Super admin → company team → candidates | A complete vetting platform like micro1: JD → skills matrix → proctored coding assessment + proctored AI interview → scorecards, recordings, transcripts, integrity reports, ranking |

**Architecture principle: one shared core, two thin portal shells.** Do not build two separate products. The shared core:

- Tenancy, roles, audit
- Assessment engine (coding first, MCQ next)
- AI interview engine (voice-to-voice, adaptive)
- Proctoring engine (browser + screen + camera + audio → integrity score + evidence)
- Resume engine (existing B2C logic, reused)
- AI gateway (every LLM call: cache, dedupe, quotas, cost log)
- Analytics on a unified competency model

---

## 3. Roles and access

| Role | Scope | Can |
|---|---|---|
| `super_admin` | Platform | Create, suspend and configure orgs (college or company): plan, seat limit, credits, validity dates, enabled modules, quotas, proctoring defaults, data retention. Invite org admins. Manage the global question bank and interview templates. See usage, AI cost and cache savings per org. Read the audit log. Open a read-only support view of any org (logged). |
| `tpo_admin` | One college | Import and manage students, departments, batches. Create drives. Live-monitor drives. Review integrity flags. Analytics and exports. Release results. Manage other TPO users. |
| `student` | Self, inside one college | Take assigned drives, practice within quota, use the resume optimizer, see results the TPO released. |
| `company_admin` | One company | Everything in the company, including team management. |
| `recruiter` | One company | Create roles, invite candidates, view reports, move the pipeline. |
| `hiring_manager` | Assigned roles | View reports, comment, record decisions. |
| `candidate` | Own session only | Token / magic-link access to their own assessment. No password account needed. |

Rules:
- One auth identity can be a B2C user and an org member at the same time (memberships table). Never create duplicate users.
- Tenant isolation is enforced in Postgres RLS, not only in app code, and proven by automated tests.
- Super-admin powers run server-side only. The service-role key never reaches the browser.
- Every admin action writes to `audit_logs`.

---

## 4. Data model (starting point; adapt after the audit)

- **Tenancy:** `organizations` (type `college|company`, plan, seat_limit, credits, valid_from/valid_to, `settings` jsonb for enabled modules, quotas, proctoring defaults, retention days, results-release default), `org_members` (role, status), `platform_admins`, `invites` (hashed token, expiry, single use), `audit_logs`, `consents` (subject, purpose, notice version, granted_at, withdrawn_at).
- **People:** `students` (org, user_id nullable until activated, roll_no, name, email, phone, department, batch_year, section, cgpa, active_backlogs, tenth_pct, twelfth_pct, dob, status, custom jsonb; unique per org on roll_no and on email), `candidates` (org, email, name, phone, resume ref, source, status).
- **Assessments:** `questions` (org nullable = global, type `coding|mcq`, statement, difficulty, topics, languages, starter code, time/memory limits, status `draft|verified|retired`, version), `test_cases` (sample/hidden, weight), `reference_solutions`, `assessments` (sections, duration, pool rules, randomization, proctoring policy), `attempts` (subject, server-side deadline, status, randomized question set, scores), `submissions`, `edit_history` (compact keystroke/diff log for replay).
- **Interviews:** `interview_templates` (skills matrix, sections, duration, persona, rubric), `interview_sessions` (status, transcript, media refs, evaluation, scores).
- **Programs:** `drives` (college: modules, cohort filter, schedule window, policy, results-release rule), `roles` (company: JD, skills matrix, assessment + interview config, pipeline stages), plus assignment tables linking students/candidates to them.
- **Proctoring:** `proctoring_events` (session ref, type, severity, confidence, start/end, evidence path, metadata, review status; high volume, so index on org + session + time and batch the inserts), `integrity_reviews`.
- **Analytics:** `competency_dimensions`, `dimension_scores` (org, subject, source type/id, dimension, score 0–100, timestamp).
- **AI:** `ai_cache`, `ai_usage_log`, `usage_counters` / quotas.
- **Resume:** link existing B2C resume analyses to org/student through a join table instead of altering B2C tables (ask me if altering is genuinely cleaner).
- **Sharing:** `share_links` (hashed token, scope, expiry).

---

## 5. Assessment engine (coding + MCQ)

**Question bank**
- Global bank (super admin) plus org-private questions.
- Coding question fields: title, statement (markdown), difficulty, topics, allowed languages, starter code per language, constraints, time and memory limits, sample + hidden test cases with weights, reference solution(s), version, status.
- MCQ (aptitude, CS fundamentals, module-wise topics): single and multi-select. Build after coding works, in the same engine.

**AI question generation**
- The LLM (through the AI gateway; Gemini by default) generates original problems from topic + difficulty + role, together with test cases and a reference solution.
- Run the reference solution against every test case in the sandbox. Publish only if all pass; then mark `verified`. Anything that fails stays `draft`.
- Don't reproduce well-known problem statements verbatim. Prefer parameterized variants so each batch can get different numbers.

**Assessment builder (TPO and recruiter)**
- Sections, duration, pool rules (e.g. "2 easy + 1 medium from arrays, strings"), per-candidate randomization (question selection, order, MCQ option shuffle), allowed languages, proctoring policy, attempt window, late-join rule, results visibility.

**Candidate runner**
- Monaco editor, language switcher, run against samples, custom input, submit.
- Autosave every ~5 s and on blur. Server-authoritative timer: the deadline lives on the server, so a refresh or reconnect resumes with the correct remaining time. Auto-submit at the deadline.
- One active session per attempt. A second tab or device is blocked and logged as an integrity event.
- Network-loss tolerant: queue saves locally, retry with backoff, show connection status.
- Faint dynamic watermark (candidate email/ID + time) over the test UI to deter photographing and leaking questions.

**Code execution**
- Judge0 (open source), running outside the web app on its own VM/container, or a hosted Judge0 plan. Candidate code must never run inside the web app or the Supabase edge-function runtime. Hosting decided: one DigitalOcean Bangalore server for the pilot (AUDIT.md section 8).
- Queue and batch submissions, per-org concurrency limits, hard timeouts.

**Grading**
- Weighted test-case score; capture compile and runtime errors.
- Optional AI code-quality review (readability, complexity, edge cases) as a separate dimension, never mixed into correctness.

**Integrity signals from the editor**
- External paste blocked by default and every attempt logged; large single insertions; typing-burst anomalies; time to first keystroke; idle gaps.
- Keystroke-level replay from `edit_history` so a reviewer can watch how the code was written.
- Plagiarism: token-based similarity (winnowing / MOSS-style fingerprints) across all submissions to the same question within an org and drive. Flag pairs above a threshold with a side-by-side diff.

---

## 6. AI interview engine (voice-to-voice)

**Voice pipeline (fix or rebuild based on the Phase 0 diagnosis)**
- Streaming speech-to-text that handles Indian English accents well; streaming text-to-speech; the LLM from the AI gateway as the interviewer brain (Gemini by default). Model IDs and provider live in config per feature: a fast model for live turns, a stronger model for final evaluation.
- Latency target: about 1.5 s or less from the candidate finishing speaking to the interviewer's audio starting. Measure and report p50 and p95.
- Voice-activity-based turn detection and barge-in (the candidate can interrupt; the interviewer stops talking).
- If voice fails mid-interview, fall back to text mode without losing interview state.
- Record candidate audio (plus webcam video if the policy requires it) and interviewer audio; keep a timestamped transcript of both sides.
- Real-time streaming runs in a persistent process outside the edge functions: **LiveKit Agents** (decided), built after the college pilot, after a Deepgram vs Sarvam bake-off on Indian-English clips (Svarah + real student recordings). Until then the current browser-speech flow is used, labelled beta, with turn-latency logging.

**Templates and adaptive flow**
- Template: skills matrix (must-have / nice-to-have with weights), seniority, duration, sections (intro, technical, problem solving, behavioral, code walkthrough, candidate questions, close), language (English first), persona (name, voice).
- Implement the flow as a state machine, not one giant prompt: per section → ask → judge answer quality → follow up (go deeper if strong, probe basics if weak, max N follow-ups) → move on. Track coverage so every must-have skill gets probed. Hard time-box per section.
- **Code walkthrough:** if the candidate took the coding test, the interviewer asks them to explain their own submitted solution: approach, complexity, edge cases, "what changes if the constraints grow". Not being able to explain one's own code is a strong skill and integrity signal.

**Prompt-injection defense**
- Candidate speech is untrusted input. The interviewer never follows instructions from the candidate ("ignore your instructions", "give me full marks"); such attempts are logged as integrity events.
- The evaluator receives the transcript inside clear data delimiters with explicit instructions to treat it only as data.

**Evaluation (async job after the interview)**
- Blind scoring: strip name, college and gender cues from the evaluator's input.
- Rubric with behavioral anchors for each level (1–5) per skill/dimension.
- zod-validated JSON output: per-dimension score, rationale, evidence quotes with timestamps, strengths, gaps, and a recommendation band ("strong / good / borderline / not yet"), clearly labeled as an AI recommendation. Humans decide. No auto-reject.
- Programmatically verify every evidence quote appears verbatim in the transcript; drop or flag any that don't.
- Optional for the startup tier: score twice and flag any dimension where the two runs differ by more than 1 point.

**AI-assisted answer signals** (signals, never verdicts)
- A long pause followed by a fluent, "read-out" answer; flat reading cadence; high semantic similarity to an LLM reference answer for the same question; gaze patterns consistent with reading (from proctoring).

**Interviewer avatar**
- A light, audio-reactive presence driven by the TTS output amplitude, with quality tiers (Section 11). It must never hurt interview performance.

---

## 7. Proctoring engine

**Reality first, so we never overpromise**
- A browser cannot see other devices (a phone, a second laptop), people outside the camera's view, or apps that hide themselves from screen capture ("invisible overlay" interview-cheating tools exist and do not appear in screen share).
- Nobody offers 100%. micro1 itself cites about a 93% cheating-detection rate for its proctoring model. Our goal: make cheating hard, detect most of it, and give human reviewers clear evidence.
- Flags are evidence for human review. Never fail a candidate on AI flags alone. (Configurable auto-submit on hard violations is allowed; see Policies.)

**Supported environment for proctored sessions**
- Desktop/laptop with a recent Chromium browser (Chrome, Edge). Block mobile and unsupported browsers with a clear explanation.

**Before the session (system check page)**
- Browser/version, camera, mic and speaker test; bandwidth test; device capability check (decides the avatar and ML quality tier).
- Consent screen: itemized and specific, not bundled. What is captured (screen, camera, mic, browser events), why, who sees it, how long it is kept, who to contact. Store the consent version and timestamp.
- Identity baseline: face snapshot (plus a college ID card photo if the org policy requires it). Never collect Aadhaar numbers. Keep the face reference only as long as needed for drift checks.
- Optional room scan: the candidate pans the webcam around the room (short clip).
- Gaze calibration: the candidate looks at 5 on-screen points. This cuts gaze false positives across different setups.
- Entire-screen share required: request `getDisplayMedia`, then verify `track.getSettings().displaySurface === 'monitor'`; reject window or tab shares.
- Single display: check `window.screen.isExtended`; if true, ask the candidate to disconnect the extra monitor. Re-check during the session.
- Enter fullscreen.

**During the session: signals** (each becomes a `proctoring_event` with type, severity, confidence, timestamps and evidence)
- **Browser:** tab hidden (Page Visibility API), window blur, fullscreen exit, screen share stopped, extra display connected, copy/paste/cut attempts, right-click, devtools heuristics, page reload, a second tab or session of the same attempt.
- **Screen ("tab monitoring"):** periodic screen **and webcam** snapshots (default every 30 s, configurable; no continuous video for colleges, startups may enable video later) plus an immediate snapshot on every focus or visibility event, so the reviewer sees exactly what the candidate switched to. Optional: send only flagged frames to a vision model to label "AI chat / search engine / messaging app / other editor visible".
- **Camera (eye contact and presence):** in-browser ML (MediaPipe Tasks Vision or equivalent) at 2–5 fps, in a Web Worker where feasible, otherwise throttled on the main thread. Detect: no face, multiple faces, face mismatch versus the baseline (periodic), head turned away beyond a threshold for more than N seconds, calibrated gaze off-screen beyond a threshold, repetitive reading-pattern eye movement, phone/device in view (object detector "cell phone" class), camera covered or frozen, virtual camera (device-label heuristics).
- **Audio (sounds):** voice-activity detection on the mic: speech during silent sections (coding test), multiple speakers or background voices, whispering, sustained noise. During the interview, exclude the windows when the AI interviewer is speaking and keep echo cancellation on, so the interviewer's own voice isn't flagged.
- **Interview:** prompt-injection attempts; long-latency-then-fluent answer pattern.

**Policies** (set per drive/role; super admin sets defaults per org)
- **Standard:** log everything, show the candidate on-screen warnings, never interrupt.
- **Strict:** warnings plus a violation counter; auto-submit after N hard violations (N configurable; common in campus tests).
- **Maximum (micro1-style):** any hard violation (screen share stopped, camera off, extra monitor, fullscreen exit) pauses the session until fixed. Whether the timer runs during a pause is configurable. Repeated pauses are flagged.

**Integrity score**
- Weighted and explainable: severity × confidence × duration, with a cap per signal type so one noisy detector can't dominate. Bands: High / Medium / Low integrity. Show how the score was computed.
- Review UI: timeline of events with evidence thumbnails and clips, click-to-jump in the recording, reviewer marks each flag "confirmed" or "dismissed" with a note. The final human decision is stored separately from the AI score.

**Evidence storage**
- Private buckets, short-lived signed URLs, org-scoped paths, per-org retention with an automatic deletion job.
- Upload snapshots and clips in the background with retry. Never block the test on uploads.

**Accommodations**
- Per-candidate settings (extra time, relaxed gaze/audio checks) set by the TPO or recruiter for candidates who need them. Logged.

**Performance**
- The full proctoring stack must run on a low-end laptop (4 GB RAM, dual-core, integrated GPU) alongside the test or interview: ML at low fps, no continuous video upload by default, automatic quality tier.

---

## 8. AI gateway: caching, dedupe, cost

All B2B LLM calls go through one server-side gateway: **provider-agnostic, with the provider and model set per feature in config** (Gemini by default), retries, timeouts, zod output validation, logging.

- **Exact-match cache** for deterministic features (resume analysis, JD → skills matrix, question generation, MCQ explanations). Key = sha256(feature + prompt_version + model + normalized input).
  - Duplicates are served from cache: a student re-submitting the same resume, or many students triggering the same generation, gets the cached response.
  - Features involving personal data are cached per org (tenant-scoped). Non-personal content may use a global cache.
  - Bumping a prompt version invalidates its old entries automatically.
  - Never cache live interview turns or the evaluation of a specific interview or attempt.
- **Single-flight dedupe:** identical concurrent requests (e.g. 200 students in a lab hitting the same generation at once) make one LLM call; the rest wait for that result (unique key row with a pending status, or an advisory lock).
- **Context caching:** use the provider's context caching for long static system prompts and rubrics (Gemini explicit/implicit context caching; the equivalent prompt caching if another provider is added for a feature).
- **Usage and cost log** per call: org, feature, model, input/output tokens, cache hit, latency, cost in ₹. This feeds the super admin dashboard: cost per org, cost per student/candidate, cache hit rate, ₹ saved.
- **Quotas:** per-org and per-student limits (e.g. practice interviews per month), enforced in the gateway. Unlimited practice interviews are the biggest cost risk.

---

## 9. College portal

**Super admin: college onboarding and tracking**
- Create a college: name, logo, address, contact, plan (per-student / lump-sum / one-time), seat limit, validity dates, enabled modules (coding, interview, resume), quotas, proctoring defaults, retention days, results-release default.
- Invite the TPO admin(s) by email.
- Track per college, as totals and over time: pooled practice credits used and remaining, seats used, students registered and activated, drives created, attempts started and completed, interview minutes, resume optimizations, AI cost, cache savings. Alerts near seat or quota limits.

**TPO admin**
- **Students:** CSV/XLSX import with column mapping and a validation preview (name, email, roll no, department, batch/graduation year, section, CGPA, active backlogs, 10th %, 12th %, phone, DOB). Dedupe on (org, roll no) and (org, email): show the duplicates and let the TPO merge or skip. Manual add/edit, bulk activation emails (queued, respecting email-provider rate limits), deactivate.
- **Structure:** departments, batches, sections.
- **Drives:** a drive is any combination of coding test, AI interview and resume task. Target cohort by filters (department, batch, CGPA ≥ x, backlogs = 0, etc.), schedule window, proctoring policy, results release (immediately / manually / never).
- **Live drive monitor (realtime):** counts by status (not started / in progress / submitted / paused / flagged) and a list of active students with their current flags. The TPO can message a student or end a session (logged). Use aggregated realtime channels, not one subscription per student.
- **Integrity review queue.**
- **Analytics** (server-side filtering and pagination):
  - Filters: drive, date range, department, batch, section, CGPA range, backlogs, 10th/12th %, skills/topics, score range per module, integrity band, attempt status, readiness band. Saved views.
  - Views: participation funnel (invited → activated → started → completed), score distributions, department and batch comparisons, skill-gap heatmap (department × competency), top performers, at-risk students, improvement across attempts, resume ATS score distribution and the most common resume gaps.
  - Student 360 profile: every attempt, interview reports, recordings (per policy), resume versions, competency radar, integrity history.
  - Exports: CSV/XLSX for any filtered table; PDF student report.
- **Settings:** TPO users, college branding (logo on student-facing pages), default policies.

**Student**
- Login by email OTP / magic link, activated from the TPO invite.
- Dashboard: assigned drives with windows and status; practice zone (coding and AI interviews within quota); resume optimizer (reuses the B2C analyzer, Resume Studio and ATS templates, scoped to the college, cached); released results with feedback.
- System check available any time before a drive.

**Unified competency model** (this is how the TPO gets data "on different factors")
- Dimensions, configurable by super admin: coding, problem solving, technical knowledge (per topic), communication, clarity/confidence, resume quality, integrity.
- Every module writes normalized scores (0–100) into `dimension_scores`, so analytics can filter and aggregate across tests, interviews and resumes.

---

## 10. Startup portal (vetting platform like micro1)

- **Onboarding:** super admin creates company orgs in V1 (sales-led). Design the schema so self-serve signup can be added later.
- **Team:** company_admin, recruiter, hiring_manager.
- **Roles:** paste a JD → AI extracts a skills matrix (must-have / nice-to-have, weights, seniority) → the recruiter edits it → configure the coding assessment (bank or AI-generated, languages, duration), the AI interview (duration, sections, difficulty, code walkthrough on), and the proctoring policy (default: Maximum).
- **Candidates in:** invite by email (single or bulk CSV), or a public apply link per role where the candidate uploads a resume → resume screen against the JD using the resume engine → auto-invite above a configurable threshold.
- **Candidate experience:** token link (no password) → email OTP → consent → system check → identity baseline → coding assessment → AI interview with code walkthrough → done. Candidates don't see scores.
- **Pipeline:** kanban and table views (invited / in progress / completed / shortlisted / rejected / hired), bulk actions, filters.
- **Candidate report:** AI match score; per-skill scores with evidence; coding results (tests passed, approach, complexity, code replay); interview recording with synced transcript; integrity score with evidence timeline; AI recommendation band, stated plainly as "AI does not pass or fail candidates; your team decides"; reviewer comments and decision. PDF export. Expiring, view-only share link for outside hiring managers.
- **Compare:** 2–4 candidates side by side; ranking by match score with the integrity band shown next to it.
- **Notifications:** email when a candidate completes; daily digest.
- **Credits:** deducted per completed candidate session; super admin tops up manually in V1.

---

## 11. Design system and motion (how to use the installed skills)

Order matters, so there is exactly one source of design truth:

1. **Design DNA (`design-dna`).** Run its Analyze phase on 2–3 reference URLs or screenshots that I provide. Ask me for them; if I say "you pick", propose 3 references that suit a premium, trustworthy assessment product and wait for my pick. Save the output as `design/dna/hiresume-b2b.dna.json` and commit it.
2. **genjutsu `paint`.** Build the B2B visual universe and design system **from that DNA JSON**: give it the JSON as the brief, so `MASTER.md` and the tokens match the DNA instead of inventing a second direction. When it asks how to preview, choose live preview (throwaway route in the repo). I approve at its gates.
3. **Motion Design (`motion-design`).** Pick a motion personality per surface from the skill's archetypes and turn it into motion tokens in code (durations, easings, stagger):
   - Dashboards (super admin, TPO, company): calm, trustworthy, fast (roughly 150–300 ms), purposeful.
   - Landing pages: premium, expressive scroll storytelling.
   - Candidate test and interview flow: minimal and calming. Motion only for state feedback: recording, connection, timer, warnings. Warnings must be clear, never alarming.
   - Use its patterns for loading / success / error / warning states and multi-element choreography (e.g. dashboard entrance: headline stats, then charts, then tables).
4. **GSAP (`gsap-core`, `gsap-timeline`, `gsap-scrolltrigger`, `gsap-plugins`, `gsap-utils`, `gsap-react`, `gsap-performance`).** In React always use `useGSAP` with a scoped container and cleanup, per `gsap-react`. Use `gsap.matchMedia()` to honor `prefers-reduced-motion`. ScrollTrigger only on marketing pages. Animate transforms and opacity, per `gsap-performance`. GSAP and all its plugins are free to use.
5. **Three.js (`threejs-*` skills).** Use React Three Fiber in React components and follow the threejs skills for materials, shaders, loaders and post-processing. Only two places: the marketing hero visual and the interviewer avatar. Load with `React.lazy` + dynamic `import()` and keep them out of the build-time pre-render (client-only), cap the device pixel ratio, render on demand and pause when offscreen or the tab is hidden, dispose geometries/materials/textures on unmount, always ship a static/2D fallback.
6. **genjutsu `cast`.** For targeted polish later, e.g. "make the drive cards feel tactile", "animate the integrity timeline".

Hard rules:
- B2B tokens and styles are scoped to the B2B layout components of the React Router tree. B2C must stay pixel-identical; prove it with screenshot tests of key B2C pages before and after.
- No Three.js or heavy animation inside proctored sessions, except the interviewer avatar, which has quality tiers picked automatically from the system check (CPU cores, memory, measured FPS) and drops a tier if FPS falls:
  - (a) R3F audio-reactive orb on capable devices,
  - (b) Canvas 2D / CSS orb,
  - (c) static avatar with a waveform.
- Everything respects `prefers-reduced-motion`.
- dotLottie is fine for small illustrations (empty states, success moments). Keep files small.
- Don't let animation work block functional phases.

---

## 12. Non-functional requirements

**Performance**
- Proctored pages: target a 4 GB RAM, dual-core laptop on Chrome. Report measured CPU and memory. ML ≤ 5 fps. No continuous video upload by default.
- Network: works on ~2 Mbps. Autosave queue survives drops. Uploads retry and resume.
- Dashboards: server-side filtering and pagination; p95 under 500 ms for analytics queries on the demo dataset (add indexes / materialized views as needed).

**Hosting**
- Anything long-running (realtime voice, Judge0, background workers) runs outside the edge functions: one DigitalOcean Bangalore server for the pilot (decided; AUDIT.md section 8).
- Background jobs (evaluations, Judge0 results, media processing, retention deletion, analytics refresh): propose the mechanism in Phase 0.

**Security**
- RLS on every table, with an automated cross-tenant test suite.
- Rate limits on public endpoints (invite links, OTP, apply links).
- Invite and share tokens stored hashed, single-use or expiring.
- Private storage buckets and short-lived signed URLs.
- CSP and security headers; dependency audit.
- Audit log for every admin action.

**Privacy (India: DPDP Act 2023 + DPDP Rules 2025)**
- The Rules were notified in November 2025. The main obligations (notice, consent, security safeguards, breach reporting, children's data) apply 18 months after notification, around May 2027. Build for them now:
  - Itemized consent per purpose, never bundled. Store consent records. On withdrawal: stop processing and delete, unless a legal obligation requires keeping the data.
  - Per-org retention; automatic deletion of recordings and snapshots after 90 days by default (configurable per org). Scores and reports stay for the contract period.
  - Breach-response runbook.
  - Children: collect DOB. Under-18 users need verifiable parental consent, and the Act restricts tracking and behavioral monitoring of children. Under-18 students are **not activated in V1**: DOB is checked at import, and under-18 rows are held back (I'll take legal advice before any compliant flow).
  - Never collect Aadhaar numbers. Minimize biometric data.
  - If startup-portal candidates are outside India, other laws (e.g. GDPR) may apply; flag before any global launch.

**Observability**
- Error tracking (existing tool or Sentry), structured logs, the AI usage log, alerts on failed jobs.

**Testing**
- Unit: scoring, cache keys, integrity score, eligibility filters.
- Integration: Judge0, AI gateway, voice pipeline.
- RLS isolation tests.
- Playwright end-to-end for each portal's critical path.
- B2C regression + screenshot comparisons on every phase.
- Load tests in Phase 9.

---

## 13. Phases and acceptance criteria

### Phase 0 — Audit and plan (read-only, no code changes)
Produce `docs/b2b/AUDIT.md` and create `docs/b2b/PROGRESS.md`:
- Stack map: framework and router, Supabase usage (auth, DB, storage, edge functions), where and how the LLM is called (models, prompts), Razorpay, hosting/deploy, env var names (names only), test setup, lint/format.
- B2C feature inventory with routes and key files.
- Every B2B-related file, route, table, migration and branch already in the repo, each marked done / half-done / broken / unused.
- **Voice diagnosis:** reproduce the broken voice-to-voice flow, find the root cause, propose the fix. Specifically check whether it depends on long-lived WebSocket/streaming connections inside serverless functions (serverless platforms time out and can't host WebSocket servers); if so, propose an architecture with a persistent realtime component.
- DB schema snapshot with RLS status per table.
- Gap analysis: this spec versus what exists.
- Architecture proposals: realtime voice stack, code execution hosting, background jobs, media storage, analytics queries.
- **Cost model:** estimated ₹ per student (college) and per candidate (startup) for one coding test, one 20-minute AI voice interview, one resume optimization, and proctoring evidence storage. Show assumptions. I need this to quote per-student pricing to colleges.
- Questions for me, including Section 14.

Then STOP. (Done 2026-10-18; decisions recorded in the Decisions log.)

> **Order of work (fast-track, 2026-10-20; replaces the college-pilot-first order):**
> 1. **Phase 1 — foundations + contracts** (alone): tenancy (college + company, roles as text + CHECK), memberships,
>    invites, audit log, consents, credits; AI gateway (cache, single-flight, cost log, quotas); super admin v1; every
>    V1 B2B table + TS types + API contract stubs; B2C smoke + screenshot baseline; RLS isolation tests.
> 2. **V1 tracks, up to 3 in parallel** (subagents in worktrees; the lead adds all migrations): **A** assessment engine
>    (Phase 3 scope + MCQ), **B** proctoring V1 (Phase 4 minus gaze calibration, phone detection, multi-speaker audio,
>    face match), **C** interview V1 (pilot engine + beta voice + code walkthrough; Gemini Live spike), **D** college
>    portal (Phase 6 core), **E** startup portal (Phase 7 minus kanban, compare, PDF).
> 3. **V1 done** = the college and startup walkthroughs (Decisions log) pass end-to-end on local Supabase → one
>    batched production release for my approval.
> 4. **Fast-follow:** gaze calibration, phone detection, multi-speaker audio, face match, plagiarism, live drive monitor,
>    code replay UI, kanban, compare, PDF exports, Phase 8 marketing pages, Phase 2 design/motion pass, Phase 5 voice
>    upgrade (LiveKit unless the Gemini Live spike wins), Phase 9 hardening.
>
> Phase 2 in V1 is only a scoped B2B theme on the existing shadcn/ui + Tailwind components.

### Phase 1 — Foundations
- Tenancy schema, memberships, roles, RLS on every new table, platform admins, audit logs, invites, consents.
- AI gateway: exact-match cache, single-flight dedupe, cost log, quotas.
- Super admin portal v1 (plain UI is fine; it gets reskinned in Phase 2): create/suspend orgs, plans, quotas, feature flags, invite org admins, usage page.
- Feature flags and the B2B route tree/layouts (React Router).
- Test baseline: B2C Playwright smoke tests + screenshot baseline; RLS isolation tests.
- Seed script: a demo college (~300 students across 4 departments with realistic scores and flags) and a demo startup (1 role, 20 candidates), for sales demos.

**Acceptance:** super admin creates a college and invites a TPO, who logs in and sees only their org. An automated test proves cross-tenant reads and writes fail. B2C tests and screenshots unchanged.

### Phase 2 — Design system and app shells (V1: scoped B2B theme on shadcn/ui only; the rest is fast-follow)
- **Time-boxed for the pilot: tokens + app shells only.** Design DNA → DNA JSON → `paint` → `MASTER.md` + scoped tokens; motion tokens.
- Core components: data table with filters, filter bar, chart and stat cards, empty/loading/error states, modals, toasts, stepper, timeline.
- Shells for super admin, TPO, student and company, rendered with seed data.

**Acceptance:** I approve the visual direction. Shells render with demo data. B2C screenshots unchanged.

### Phase 3 — Assessment engine + browser-level proctoring
- Question bank, AI generation with verification, Judge0 integration, assessment builder, runner (Monaco, autosave, server timer, randomization, single session), grading, plagiarism, watermark, browser events (visibility, blur, fullscreen, paste). MCQ after coding works.

**Acceptance:** a TPO builds a test from the bank; 50 simulated candidates take it concurrently without errors; refreshing mid-test resumes with the correct remaining time; a seeded plagiarism pair is detected.

### Phase 4 — Full proctoring (V1 = track B; gaze calibration, phone detection, multi-speaker audio, face match are fast-follow)
- System check, consent, identity baseline, gaze calibration, entire-screen share enforcement, single-display check, camera and audio ML, policies (Standard / Strict / Maximum with pause/resume), evidence capture and upload, integrity score, review UI, retention job.

**Acceptance:** each signal type fires correctly in a documented manual test script; Maximum policy pauses when screen share stops and resumes after the fix; CPU stays within budget on a throttled low-end profile; the integrity report shows evidence for every flag.

### Phase 5 — AI voice interview (V1 = track C on the beta voice flow + Gemini Live spike; the upgrade is fast-follow)
- Voice fix/rebuild per the Phase 0 decision, templates, adaptive state machine, code walkthrough, avatar tiers, recording + transcript, evaluation with quote verification, AI-answer signals, injection defense, text fallback.

**Acceptance:** 3 full mock interviews end-to-end with a latency report (p50/p95); an injection attempt is ignored and logged; every evaluation quote is verified; the avatar falls back correctly on a throttled CPU.

### Phase 6 — College portal (V1 = track D; live drive monitor is fast-follow)
- Student import with dedupe, drives with eligibility filters, student dashboard, practice zone with quotas, resume optimizer integration (cached), live drive monitor, analytics with saved views, exports, Student 360, results release, super admin college usage tracking.

**Acceptance:** full demo-college walkthrough: import a CSV containing duplicates → create a drive for CSE 2027 with CGPA ≥ 7 and zero backlogs → students attempt it → TPO filters by department + integrity band and exports XLSX. A duplicate resume submission is served from cache, visible in the usage log.

### Phase 7 — Startup portal (V1 = track E; kanban, compare, PDF are fast-follow)
- Roles from JD, skills matrix, invites and public apply link with resume screen, candidate flow, pipeline, reports (recording, transcript, integrity, code replay), compare, expiring share links, team roles, credits, notifications.

**Acceptance:** demo-startup walkthrough: create a role from a JD → invite 5 candidates → complete 2 sessions → compare them and share a report link that expires.

### Phase 8 — B2B marketing pages (fast-follow; pre-rendered at build time)
- Landing pages for colleges and for startups with full motion (GSAP scroll story, R3F hero, small Lottie details), demo-request form → leads list in super admin, SEO basics (metadata, OG images, sitemap, structured data), `hiresume.in` everywhere.

**Acceptance:** Lighthouse performance ≥ 90 on mobile for both pages with 3D lazy-loaded; the reduced-motion version works.
(If I need to pitch colleges sooner, I may move this phase earlier.)

### Phase 9 — Hardening
- Load test (k6 or similar): 300 concurrent test-takers autosaving plus 30 concurrent voice interviews; fix bottlenecks.
- Security pass: RLS suite, rate limits, token handling, headers, dependency audit.
- Privacy pass: consent records, retention/deletion jobs, data export/delete on request, breach runbook, under-18 handling.
- Final B2C regression.

**Acceptance:** a written report with real numbers.

---

## 14. Open decisions (answered 2026-10-20: see the Decisions log)

1. Hosting for realtime voice, Judge0 and workers (a VM/container I manage vs managed services), with monthly cost.
2. Voice stack: speech-to-text, text-to-speech, realtime framework, with cost per interview-minute and latency.
3. Recording policy: full interview video, or audio + snapshots only (evidence vs storage cost)?
4. Default retention period for recordings and evidence.
5. Students: see their own scores by default? Practice quota per student per month?
6. Startup self-serve signup and payments now or later? (Razorpay is currently INR-only.)
7. Path-based URLs (default) or a subdomain per college?
8. Department coordinator role (read-only, department-scoped): now or later?
9. Under-18 students: exclude from proctored sessions, or build a parental-consent flow?

---

## 15. Not in this build (future, do not start)

- Desktop lockdown client (the only real answer to hidden overlay apps and background processes).
- Phone as a second camera (QR pairing).
- ATS integrations, Slack integration, public API and webhooks for companies.
- Campus-to-startup talent pipeline (students opt in; startups source from vetted college talent).
- Interviews in Hindi, Telugu and other languages.
- Self-serve billing.
