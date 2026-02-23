

# Refactor Plan: Guest Upload, Deterministic Scoring, and Cache Improvements

## Overview

This plan enhances three areas without rebuilding the project: (1) allow guests to upload before logging in, (2) make scoring identical for the same resume across all accounts, and (3) make caching fully invisible.

---

## 1. Guest Upload Flow (Login After Analysis Trigger)

**Current:** All upload functionality lives in `/dashboard`, which is behind `ProtectedRoute`. Users must log in first.

**New Flow:** Upload happens on the Landing page. Login is requested only when results are ready.

### Changes

**Landing.tsx** -- Add a resume upload zone (drag-and-drop + file picker) to the hero section. When a guest uploads a PDF:
- Extract text and compute SHA-256 hash client-side (using existing `pdf-parser` utilities)
- Store `{ resumeText, fileName, contentHash }` in `sessionStorage`
- Redirect to `/auth` with a query parameter `?returnTo=analyze`

**Auth.tsx** -- After successful OTP verification and login:
- Check `sessionStorage` for pending analysis data
- If found, automatically trigger the analysis flow (call the edge function, navigate to results)
- Clear `sessionStorage` after use

**OtpVerification.tsx** -- After successful OTP verification:
- Preserve the `returnTo=analyze` intent through the redirect to dashboard
- Navigate to `/dashboard?autoAnalyze=true` instead of plain `/dashboard`

**Dashboard.tsx** -- On mount:
- Check for `autoAnalyze=true` query param AND `sessionStorage` pending data
- If both present, automatically call `handleFile` logic with the stored data
- Clear the query param and sessionStorage after processing

**Security:**
- Resume data stays in browser `sessionStorage` only (never sent to server before auth)
- `sessionStorage` is cleared on tab close automatically
- No temporary DB entries needed -- simpler and more secure

---

## 2. Deterministic Cross-Account Scoring

**Root Cause:** The cache lookup filters by `user_id`, so the same resume analyzed by two different accounts runs through the AI twice and may get different scores due to LLM variance.

### Changes

**New DB table: `resume_score_cache`**
- `content_hash` (text, PRIMARY KEY) -- the SHA-256 hash
- `ats_score`, `recruiter_scan_score`, `keyword_strength_score`, `quantification_score`, `structure_score`, `interview_probability` (integer columns)
- `analysis_result` (jsonb) -- the full structured analysis
- `created_at` (timestamptz)

RLS: No user access needed. This table is only accessed by the edge function using the service role key.

**analyze-resume/index.ts** -- Updated flow:

```text
1. Validate input
2. Check user-specific cache (resume_analyses) -- if found, return silently
3. Check global score cache (resume_score_cache by content_hash)
   - If found: use those scores and analysis_result
   - Insert into resume_analyses for this user with the canonical scores
   - Return the new analysis ID
4. If no global cache: call AI, compute scores
5. Insert into resume_score_cache (global canonical record)
6. Insert into resume_analyses (user-specific record)
```

This guarantees: same hash = same scores, regardless of account, session, or date.

**Backend scoring formula** -- Add a deterministic scoring layer after AI returns raw metrics. The edge function already has `computeTextMetrics()`. Enhance it:

```text
finalAtsScore = round(
  0.30 * aiResult.keywordStrengthScore +
  0.25 * aiResult.quantificationScore +
  0.20 * aiResult.structureScore +
  0.15 * actionVerbScore (from computeTextMetrics) +
  0.10 * aiResult.recruiterScanScore
)
```

The deterministic formula blends AI judgment with measurable text metrics, reducing variance. The blended score is stored in the global cache.

---

## 3. Cache Disclosure Removal

**Backend (analyze-resume/index.ts):**
- Remove `cached: true` from the JSON response -- always return just `{ id: "..." }`
- The frontend already handles the delay (1.8s) for cached results from the user-specific check

**Frontend (Dashboard.tsx):**
- Already cleaned up in previous change (no toast, 1.8s delay). No further changes needed.

---

## 4. Fix-Cycle Score Regression Prevention

**Current:** Already partially implemented with `metricsImproved()` function and score floor logic.

**Enhancement in analyze-resume/index.ts:**
- When `previousAnalysisId` is provided, compare `computeTextMetrics()` of old vs new resume
- If metrics improved: scores must not decrease (already in place)
- If metrics declined: allow decrease capped at -2 (already in place)
- No changes needed here -- current logic is sound

---

## Technical Summary of File Changes

| File | Change |
|------|--------|
| `src/pages/Landing.tsx` | Add upload zone for guests, store data in sessionStorage, redirect to auth |
| `src/pages/Auth.tsx` | Pass `returnTo` intent through OTP flow |
| `src/pages/OtpVerification.tsx` | Redirect with `autoAnalyze` flag after verification |
| `src/pages/Dashboard.tsx` | Auto-trigger analysis from sessionStorage on mount |
| `supabase/functions/analyze-resume/index.ts` | Global score cache lookup, remove `cached: true` flag, deterministic scoring formula |
| New migration | Create `resume_score_cache` table (no RLS -- service role only) |

