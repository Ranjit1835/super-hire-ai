

# Plan: Rebrand to HireResume, Student Detection, and Coming Soon Cards

## 1. Complete Rebranding — "Super Hire AI" to "HireResume"

All occurrences of "Super Hire AI" will be replaced with "HireResume" across the following files:

| File | Changes |
|------|---------|
| `index.html` | Title, meta descriptions (og, twitter), replace "Super Hire AI" and tagline |
| `src/pages/Landing.tsx` | Navbar brand text (line 81), footer copyright (line 208) |
| `src/pages/Dashboard.tsx` | Header brand text in both uploading state (line 160) and main view (line 177) |
| `src/pages/Auth.tsx` | CardTitle (line 114) |
| `supabase/functions/send-otp/index.ts` | Email "from" field (line 38), subject line (line 40) |
| `supabase/functions/analyze-resume/index.ts` | No brand references found in system prompt -- no changes needed |

No other files contain old brand references.

---

## 2. Student Resume Detection + Special Analysis Mode

### Backend Changes (`supabase/functions/analyze-resume/index.ts`)

**Add student detection function** that checks the resume text for:
- Keywords: "student", "fresher", "undergraduate", "b.tech", "b.e", "final year", "internship" (case-insensitive)
- Absence of "experience" section with substantial content
- Total experience mentions < 1 year

**Modify the system prompt** to include a conditional section when `resumeType === "STUDENT"`:
- Instruct the AI not to penalize for lack of work experience
- Focus scoring on projects, technical skills, internships, certifications, GitHub/portfolio
- Replace "Professional Experience Impact" with "Project & Skill Strength Analysis" in output
- Add "Student Growth Recommendations" section
- Use encouraging, actionable tone

**Add to the AI function call schema:**
- `resumeType`: string enum `["STUDENT", "PROFESSIONAL"]`
- `studentGrowthRecommendations`: optional array of strings (only for student resumes)

**Store `resume_type`** in both `resume_analyses` and `resume_score_cache` tables (new column via migration).

### Frontend Changes (`src/pages/Analysis.tsx`)

- Conditionally render "Project & Skill Strength Analysis" instead of section titles when `resumeType === "STUDENT"`
- Show "Student Growth Recommendations" section with encouraging styling when present in the analysis result

### Type Updates (`src/lib/analysis-types.ts`)

- Add `resumeType?: "STUDENT" | "PROFESSIONAL"` to `AnalysisResult`
- Add `studentGrowthRecommendations?: string[]` to `AnalysisResult`

---

## 3. Dashboard Coming Soon Feature Cards

### Changes (`src/pages/Dashboard.tsx`)

Add two large feature cards below the analysis history section:

**Card 1 — "Create Resume From Scratch With HireResume"**
- Description: "Build a recruiter-ready resume step-by-step using AI guidance."
- Button: "Create Resume From Scratch" (disabled)
- Badge: "Coming Soon"

**Card 2 — "Get Interview Training With AI"**
- Description: "Practice real interview questions powered by AI simulation."
- Button: "Get Interview With AI" (disabled)
- Badge: "Coming Soon"

UI: Large cards, center-aligned content, soft shadow, premium spacing, smooth hover animation (scale + shadow), pointer-events disabled on buttons, glass styling consistent with existing design.

---

## Database Migration

New migration to add `resume_type` column:

```sql
ALTER TABLE public.resume_analyses ADD COLUMN IF NOT EXISTS resume_type text DEFAULT 'PROFESSIONAL';
ALTER TABLE public.resume_score_cache ADD COLUMN IF NOT EXISTS resume_type text DEFAULT 'PROFESSIONAL';
```

---

## Files Modified

| File | Change Type |
|------|-------------|
| `index.html` | Edit — rebrand |
| `src/pages/Landing.tsx` | Edit — rebrand |
| `src/pages/Dashboard.tsx` | Edit — rebrand + Coming Soon cards |
| `src/pages/Auth.tsx` | Edit — rebrand |
| `src/pages/Analysis.tsx` | Edit — student mode UI |
| `src/lib/analysis-types.ts` | Edit — new types |
| `supabase/functions/send-otp/index.ts` | Edit — rebrand email |
| `supabase/functions/analyze-resume/index.ts` | Edit — student detection + prompt |
| New migration | Create — add resume_type column |

