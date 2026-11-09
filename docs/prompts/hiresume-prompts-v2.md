# HiResume — Claude Code prompt pack (v2, based on the actual repo)

Repo: super-hire-ai. Stack: React 18 + Vite SPA (react-router, react-helmet-async),
Supabase (Postgres, Auth, RLS, Edge Functions in supabase/functions on Deno),
Razorpay, Resend (OTP email), Anthropic API called with fetch.
Hosting: netlify.toml and vercel.json both exist. Confirm which one serves hiresume.in.

Run ONE session per Claude Code conversation. I will tell you which session to run.

## Ground rules (all sessions)
- Locate code with search first; open only the files a step needs.
- Never print, log, or commit secrets. Refer to env vars and secrets by name only.
- No deploys, no pushes, no payment-logic changes, no new dependencies without asking.
- Minimal diffs. Give me a plan first, then wait for my "go" before editing.
- Update docs/HIRESUME_STATUS.md at the end of every session.

---

## SESSION 1 — Fix the breakage + current-state audit

### Known facts (already verified by reading the repo)
- analyze-resume, fix-resume, enhance-resume, mock-interview and studio-parse-resume call
  claude-haiku-4-5-20251001; studio-chat also uses claude-sonnet-4-6. Both models are currently
  active. Model IDs are hardcoded in about 7 places.
- studio-parse-resume falls back to Gemini (gemini-2.0-flash) only when ANTHROPIC_API_KEY is missing.
- analyze-resume turns every non-429 Anthropic error into a generic "AI analysis failed",
  but it logs "AI error: <status> <text>" first.
- The College Placement form (src/pages/CollegePlacement.tsx) saves and sends nothing:
  it waits 800 ms and then shows "Request received".
- Guest analysis is limited only per content hash (5 per hour), so different files bypass it.
- weekly-stats runs with the service role and has no admin check.

### Step 1 — Diagnose (read-only)
a) Ask me to paste the recent Edge Function logs for analyze-resume and mock-interview from the
   Supabase dashboard. Report status codes and error types only.
b) If a local env with ANTHROPIC_API_KEY exists, send one tiny request (max_tokens 16) with
   claude-haiku-4-5-20251001 from a throwaway script outside the repo. Print only the HTTP status
   and error type/message. Delete the script afterwards.
c) Check that the Supabase project responds (one lightweight read).

Interpretation:
- Credit/billing error → I top up manually.
- 401 → the key is invalid or rotated; I replace the secret.
- Supabase unreachable or paused → I restore it in the dashboard.
- Missing secrets (ANTHROPIC_API_KEY, RESEND_API_KEY, RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET)
  → list the names only.

### Step 2 — Write docs/HIRESUME_STATUS.md (max ~120 lines), then STOP
1. Root cause with evidence.
2. Feature inventory: every route and every edge function → Working / Broken / Unknown.
3. Manual actions for me.

### After my "go"
1. Centralize models in supabase/functions/_shared/models.ts, reading HIRESUME_MODEL_FAST
   (default "claude-haiku-4-5-20251001") and HIRESUME_MODEL_SMART (default "claude-sonnet-4-6")
   with Deno.env.get. Replace every hardcoded model ID.
   Add a comment: Haiku 4.5 is not scheduled to retire before 15 Oct 2026, and switching is now
   a secret change, not a code change.
   If we later move to Claude 4.7+ models (e.g. "claude-sonnet-5"): remove `temperature`
   (used in analyze-resume, fix-resume, studio-parse-resume) because non-default values return
   HTTP 400 on those models, and re-check max_tokens (the newer tokenizer produces ~30% more tokens).
2. Error mapping: log the Anthropic error type and status (never resume content) and show users a
   clear message such as "Analysis is temporarily unavailable, please try again shortly".
3. College Placement leads: new edge function submit-partner-lead that validates input, rejects
   bots with a honeypot field, rate-limits per salted IP hash, inserts with the service role into a
   new partner_leads table (RLS enabled, no public policies), and emails me through the existing
   Resend setup (recipient from a PARTNER_LEADS_EMAIL secret). Show the success message only after
   the insert succeeds.
4. Guest abuse guard: add a per-IP daily limit (store a salted hash, never the raw IP).
   Before calling the LLM, reuse an existing analysis for the same content hash.
5. weekly-stats: make it admin-only (compare the caller's email to an ADMIN_EMAILS secret).
6. Keep-alive: a lightweight function doing one real DB read, pinged every 3 days by the host's
   scheduler (confirm the host) or GitHub Actions (note: scheduled workflows can be auto-disabled
   in inactive repos).
7. Add .env to .gitignore. The current .env only holds public Supabase values; keep it that way.

Run lint, build and tests. List changed files, new secrets I must set, and a one-line commit message.

---

## SESSION 2 — SEO + brand consistency (read docs/HIRESUME_STATUS.md first)

### Known facts
- The app is a client-rendered Vite SPA. Crawlers that don't run JavaScript see only the
  index.html meta tags; SEOHead (react-helmet-async) sets per-route tags only after JS runs.
- netlify.toml and vercel.json rewrite every path to index.html with status 200, so unknown URLs
  become soft 404s.
- The brand is inconsistent: "HireResume" appears ~96 times, the Dashboard shows "HireSume",
  and the Razorpay checkout name is "HireResume.in". The domain is hiresume.in.
- /ats-checker is a marketing page whose buttons navigate to "/"; it is not a working tool.
- /blog shows 8 excerpt-only cards with no article pages.

### Tasks (plan first, then wait for "go")
1. Brand: use "HiResume" everywhere (titles, meta, OG, JSON-LD, UI copy, emails, the Razorpay
   checkout name, README). Keep "Resume Studio" as a feature name. Report before/after counts.
2. Prerender public routes at build time so each one ships real HTML and its own meta tags:
   /, /ats-checker, /pricing, /about, /blog, /blog/:slug, /college-placement.
   Propose the lightest approach for Vite (plugin or post-build script) and ask before adding a
   dependency. App behavior must not change.
3. Real 404s: once prerendering exists, unknown paths must return a 404 page with a 404 status
   instead of the SPA with 200.
4. /ats-checker: make the upload work on this page by reusing the existing upload and guest
   analysis flow.
5. Blog: add /blog/:slug pages. Publish 3 genuinely useful articles first (ATS-friendly format,
   fresher resume for Indian IT roles, how to read your score). Remove or properly source
   unsourced stats such as "75% of resumes are rejected by ATS". Keep the other 5 unpublished.
6. Metadata for every public route: unique title (max 60 chars), description (max 155 chars),
   canonical URL that exactly matches og:url, exactly one H1.
   noindex on auth, dashboard, studio, analysis and other private routes.
7. public/sitemap.xml and public/robots.txt (disallow private routes, reference the sitemap).
8. JSON-LD: Organization + WebSite on the home page; WebApplication (free offer) on /ats-checker.
   No invented ratings, reviews or user counts.
9. Claims: fix the mismatches — the "Free AI Resume Builder" title vs the paid builder (₹299),
   the Reels page's "fix worth ₹299" vs ₹99 in the pricing table, and any copy implying mock
   interviews are free (they are paid-only).

### Output
Lint and build pass. List changed files, give a one-line commit message, and end with this
manual checklist for me:
- Google Search Console: verify the domain, submit the sitemap, request indexing for the home and
  tool pages, then watch the Generative AI performance report.
- Bing Webmaster Tools: add the site and submit the sitemap.
- If I own hireresume.in, 301-redirect it to hiresume.in.
- Edit old LinkedIn posts that carry the wrong domain.
- Enable international payments in the Razorpay dashboard (the code already supports USD).

---

## SESSION 3 — ATS preview + Master Profile grounded tailoring (read docs/HIRESUME_STATUS.md first)

Principle: deterministic checks decide; the LLM only writes. The generator is never the judge.
Positioning: "Tailored, never invented." Do not modify the mock interview agent.
Plan first (files, dependencies, schema changes, RLS policies), then wait for my "go".

### Reuse what already exists
- Client-side PDF text extraction (pdfjs-dist) → Feature A.
- studio-parse-resume already turns a resume into structured JSON and is told not to add
  information → Master Profile import (B1).
- Resume Studio sessions, version history and share links → tailoring UI (B3) and share card (C).

### Feature A — "What the ATS sees" (build first)
- New public page /ats-parse-preview: prerendered explainer + the tool. No login, no LLM calls.
- Upload PDF/DOCX and extract text in the browser.
- Show: extracted plain text in reading order, detected sections, contact info found
  (email, +91 phone, LinkedIn URL), dates found.
- Red flags with severity:
  - critical: no text layer (scanned/image-only PDF); no email or phone found
  - high: multi-column text interleaving; tables; key text only in header/footer
  - medium: icons/graphics replacing words; non-standard section headings; odd characters
  - low: more than 2 pages with under 5 years of experience
- Do not upload or store the file or its text.
- Tests: fixtures for a clean single-column PDF, a two-column PDF and an image-only PDF, each with
  expected flags (generate fixtures if possible, otherwise ask me).
- Link the page from the home page and /ats-checker.

### Feature B — Master Profile + grounded tailoring (core feature)

B1. Master Profile
- Per-user structured profile in Supabase (JSONB) with stable fact IDs: roles (employer, title,
  start/end), achievements (text + metrics), skills (each linked to evidence fact IDs), projects,
  education, certifications.
- Onboarding: import through studio-parse-resume, then the user reviews and confirms each fact.
  "Verified" in the UI means user-confirmed. Never claim external verification.
- RLS: users can read/write only their own profile. Provide "delete my profile".

B2. JD fit + skill gap
- Paste a job description (e.g. from Naukri or LinkedIn) → deterministic skill/keyword extraction
  with a synonym map (e.g. JS → JavaScript, k8s → Kubernetes).
- Deterministic "JD fit score" against the Master Profile. Label it "JD fit score", not "ATS score".
- Skill gap in two buckets:
  - "You have evidence but didn't mention it" → safe to surface in the resume.
  - "Genuinely missing" → suggest learning it; never add it to the resume.

B3. Grounded tailoring
- One LLM call (HIRESUME_MODEL_FAST from _shared/models.ts) returns structured JSON: each tailored
  bullet plus the fact IDs it is based on.
- Independent verifier in a separate module, never the generator call: every number, date,
  employer, title and skill/tool in a bullet must appear in its cited facts after normalization
  and synonyms. Uncited or unmatched content is rejected.
- UI (inside Resume Studio): show only verified bullets by default. Rejected ones appear as
  "Needs your confirmation"; if the user confirms it is true, add it to the Master Profile first,
  then re-verify the bullet.
- Keep this behind the Session 1 rate limits and cache.

B4. Verifier evals (must pass)
Fixtures: one Master Profile + one JD + generator outputs that invent a metric, add an employer or
title not in the profile, add a skill with no evidence, or stretch a date range, plus clean
outputs. The verifier must reject every bad case and pass every clean one.

### Feature C — Share card (only if budget remains)
- Extend the existing Studio share links with a 1200x630 OG image: score, user-typed target role,
  and "hiresume.in" clearly visible. No PII (no name, email, phone or resume text).
- LinkedIn and WhatsApp crawlers do not run JavaScript, so share URLs need server-generated HTML
  meta tags (host function or Supabase function), not SPA meta.
- Share pages are noindex with one CTA: "Check your resume free". The user can delete a share.

### Out of scope
Auto-apply or auto-submit, scraping any job board, recruiter email finding, auto-sending messages,
the Kanban tracker (next phase), B2B dashboards (after paid pilots), new paid services.

### Output
Lint, build and tests (including B4) pass. List changed files per feature, give a one-line commit
message per feature, and append a "Session 3" section to docs/HIRESUME_STATUS.md.
