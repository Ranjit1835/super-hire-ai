

# Super Hire AI -- Stability, Scoring, and UX Enhancement Plan

## Summary

This plan addresses 11 enhancement areas across scoring reliability, template bugs, editing, scanning animation, dashboard UX, UI polish, AI model flexibility, and production readiness -- all without rebuilding core architecture.

---

## 1. Score Regression Fix (Backend)

**File:** `supabase/functions/analyze-resume/index.ts`

**Problem:** The current regression prevention only constrains AI-returned scores to `prev - 2` floor. It still relies purely on the LLM for scoring, which is non-deterministic.

**Solution -- Backend Weighted Score Computation:**
- After receiving AI scores, compute a **deterministic measurable metrics delta** by analyzing the actual resume text:
  - Count quantified metrics (regex: numbers, percentages, dollar amounts)
  - Count strong action verbs vs weak verbs
  - Count keyword density
  - Count section headers
- Compare these counts against the previous analysis's resume text (fetch `resume_text` alongside scores from `previousAnalysisId`)
- If measurable metrics improved or stayed equal, enforce: `finalScore = max(aiScore, previousScore)`
- If measurable metrics declined, allow reduction
- This makes scoring **deterministic based on measurable content**, not just LLM output

**File:** `src/pages/Dashboard.tsx`
- When re-analyzing a fixed resume, pass the latest analysis ID as `previousAnalysisId` to the edge function (currently only passed from client but not wired from Dashboard upload flow)

---

## 2. Template Download Fix (Modern Tech and Impact Focused)

**File:** `src/lib/pdf-generator.ts`

**Problem:** The Modern Tech template uses special characters (triangle `▸`) and the Impact template uses a star (`★`) and rectangle backgrounds that can cause pdf-lib rendering failures when text metrics are miscalculated.

**Fixes:**
- **Modern Tech (`renderModern`):** Replace `▸` with standard ASCII dash `-` for bullet prefix since pdf-lib's Helvetica font may not support all Unicode glyphs. Validate tag grid rectangle positioning doesn't go negative on y-axis.
- **Impact (`renderImpact`):** Replace `★` with `*` and `▶` with `-`. Fix the key achievements background rectangle calculation -- currently it draws the rectangle *before* checking if there's enough space, potentially drawing off-page. Add `ensureSpace` check before the rectangle drawing.
- **All templates:** Wrap each template render call in a try-catch with console.error logging so failures are traceable.
- **Null safety:** Add defensive checks for empty/undefined arrays before iterating (e.g., `content.experience || []`)

---

## 3. Full Editable Preview Support

**File:** `src/components/fix-resume/ResumePreview.tsx`

**Current state:** Name, summary, experience titles, and bullets are editable. Education, skills, phone, email, company, and duration are NOT editable.

**Enhancement:**
- Make `email`, `phone` editable via `EditableText` inputs
- Make `education` fields (degree, school, year) editable
- Make `skills` individually editable with add/remove capability
- Make `company` and `duration` fields in experience editable
- Apply across all 5 template previews (ClassicPreview, ModernPreview, ExecutivePreview, MinimalPreview, ImpactPreview)
- Add helper methods to `useEditor`: `updateEdu`, `removeSkill`, `updateSkill`, `addSkill`

---

## 4. Dashboard UX -- Show Last 3 + View All

**File:** `src/pages/Dashboard.tsx`

**Changes:**
- Add state `showAll` (default false)
- When `showAll` is false, display only the first 3 analyses
- Add "View All (N)" button below the 3 items when more exist
- Add prominent "Analyze New Resume" button at the top of the page, above the upload zone
- Already sorted by `created_at DESC` -- no change needed there

---

## 5. Premium Scanning Animation

**File:** `src/components/ScanningAnimation.tsx` (rewrite)

**Current state:** Shows a fake document with scan line and stage dots. Decent but basic.

**Enhancement -- Multi-layer premium animation:**

1. **AI Scan Visualizer:** Keep the document outline but add:
   - Soft glow effect on the scan line (via box-shadow CSS)
   - Pulsing border around document (CSS animation)
   - Slightly blurred fake text lines that "resolve" as scan passes

2. **Live Phase Indicator:** Expand the stages list:
   - "Parsing document structure..."
   - "Extracting measurable impact metrics..."
   - "Evaluating keyword density..."
   - "Simulating ATS parsing behavior..."
   - "Running recruiter 6-second scan..."
   - "Calculating interview probability..."
   - "Optimizing scoring model..."
   - Add blinking cursor character after each message

3. **Real-time Metric Counters:** Below the stage text, show 4 animated counters that increment from 0 to random target values using CSS/requestAnimationFrame:
   - Structure Score: 0 -> ~75
   - Keyword Strength: 0 -> ~68
   - Impact Density: 0 -> ~72
   - ATS Probability: "Calculating..."

4. **AI Engine Badge:** Small pulsing badge "AI Engine Running" with subtle gradient shimmer

All animations use CSS keyframes and Framer Motion (already installed). No new libraries.

---

## 6. UI Polish

**Files:** `src/pages/Landing.tsx`, `src/pages/Dashboard.tsx`, `src/pages/Analysis.tsx`, `src/pages/FixResume.tsx`, `src/index.css`

**Enhancements:**
- Add consistent `animate-fade-in` class usage for page entry transitions
- Add hover scale effects on interactive cards (`.hover-scale` already defined in tailwind config)
- Ensure consistent spacing (py-8 for main sections, gap-6 for grids)
- Verify mobile responsiveness -- ensure template selection grid collapses properly on small screens
- Add subtle card hover border transitions
- Clean up any visual clutter in the Analysis page

---

## 7. Response Optimization -- Impact Mode

**File:** `supabase/functions/analyze-resume/index.ts`

**Current state:** Prompt already says "Top 3-5 critical issues" and "2-3 strategic improvements." But the AI may still return more.

**Enhancement:**
- Add hard enforcement in the backend: after parsing AI response, truncate arrays:
  - `criticalIssues`: max 5
  - `warnings`: max 3
  - `optimizationOpportunities`: max 3
  - `advancedRefinements`: max 2
- This ensures output is always concise regardless of AI behavior

---

## 8. Production Readiness

**Current state:** No localhost hardcoding found. CORS is configured with `*`. Environment variables use `import.meta.env`.

**Checks and fixes:**
- Verify no `localhost` references exist in edge functions or client code (none found)
- CORS already uses `Access-Control-Allow-Origin: *` -- acceptable for this app type
- Ensure all API calls use `import.meta.env.VITE_SUPABASE_URL` (already the case)
- No changes needed -- the app is already production-configuration ready

---

## 9. AI Model Flexibility

**File:** `supabase/functions/analyze-resume/index.ts` and `supabase/functions/fix-resume/index.ts`

**Enhancement:**
- Extract model selection to a constant at the top of each function: `const AI_MODEL = Deno.env.get("AI_MODEL") || "google/gemini-2.5-flash";`
- Use this constant in the fetch body instead of hardcoded model string
- This allows switching models via environment variable without code changes
- Both edge functions get this treatment

Note: Since the Lovable AI Gateway abstracts providers, switching between Gemini and OpenAI models only requires changing the model string. No provider strategy pattern needed -- the gateway handles it.

---

## 10. Performance Optimization

**Current state:** SHA-256 caching already prevents duplicate AI calls for identical content.

**Enhancements:**
- Already implemented: content hash check before AI call
- Add token usage logging in edge functions: log `aiData.usage` (tokens used) after AI response for cost monitoring
- No other changes needed -- the caching system is solid

---

## 11. Files Changed Summary

| File | Changes |
|------|---------|
| `supabase/functions/analyze-resume/index.ts` | Deterministic scoring engine, model flexibility, response truncation, token logging |
| `supabase/functions/fix-resume/index.ts` | Model flexibility, token logging |
| `src/lib/pdf-generator.ts` | Fix Unicode characters, null safety, rectangle positioning, try-catch per template |
| `src/components/fix-resume/ResumePreview.tsx` | Full section editability (education, skills, contact, company, duration) |
| `src/components/ScanningAnimation.tsx` | Premium multi-layer animation with counters and phase indicators |
| `src/pages/Dashboard.tsx` | Show last 3 + View All, prominent Analyze New button |
| `src/pages/Landing.tsx` | Minor UI polish |
| `src/pages/Analysis.tsx` | Minor UI polish |

No database schema changes. No new dependencies. No core logic disruption.

