

# SUPER HIRE AI – Resume Intelligence Platform

## Overview
A premium, dark-themed AI-powered Resume Intelligence System that analyzes resumes through 5 layers (structural, keyword, quantification, recruiter psychology, ATS simulation), provides detailed scored feedback, and offers automated resume fixing with downloadable PDF templates.

---

## Pages & Navigation

### 1. Landing Page
- Hero section with bold headline, animated gradient accents, and CTA to get started
- Feature highlights: ATS Score, Recruiter Scan, Fix My Resume, PDF Export
- Social proof section and pricing teaser
- Dark premium aesthetic (Vercel-inspired) with glassmorphism cards

### 2. Auth Pages (Login / Sign Up)
- Email + password authentication via Supabase
- Clean dark-themed auth forms
- Redirect to dashboard after login

### 3. Dashboard
- Overview of past analyses with scores at a glance
- Quick upload area for new resume analysis
- Resume history list with timestamps and scores
- User greeting and stats summary

### 4. Resume Analysis Page
- **Upload Section**: Drag-and-drop PDF upload with file parsing
- **Score Overview**: Animated circular/radial score meters for:
  - ATS Score
  - Recruiter Scan Score
  - Keyword Strength Score
  - Quantification Score
  - Structure Score
  - Interview Probability
- **Market Competitiveness Badge**: Below Average / Competitive / Strong / Elite
- **Categorized Feedback Panels** (card-based, color-coded):
  - 🔴 Critical Issues (with impact level, why it matters, fix recommendation)
  - 🟡 Strategic Warnings
  - 💡 Impact Optimizations
  - ✅ Advanced Refinements
- **AI-Rewritten Summary** and **Strong Bullets** preview
- **Missing High-Impact Keywords** list
- **Recruiter Psychology Insight** narrative
- **Final Verdict** with clear actionable statement

### 5. Fix My Resume Page
- Triggered from analysis results via "Fix My Resume" button
- AI auto-generates improved resume content based on analysis
- **Template Selection**: 3 ATS-friendly templates
  - Classic ATS (clean, traditional)
  - Modern Tech ATS (developer/tech focused)
  - Executive Professional (senior/leadership)
- Live preview of selected template with improved content
- Download as PDF button

### 6. Profile / Settings
- User profile management
- Analysis history with ability to revisit past results

---

## Backend Architecture

### Supabase Database
- **profiles** table: user info, linked to auth.users
- **user_roles** table: role management
- **resume_analyses** table: stored analysis results (JSON), file reference, scores, timestamps, content hash for caching
- **resumes** table: uploaded resume metadata and storage references

### Supabase Storage
- **resumes** bucket: uploaded PDF files

### Edge Functions
- **analyze-resume**: Receives parsed resume text, sends to Lovable AI (Gemini) with multi-layer prompt engineering, returns structured JSON scores and feedback. Includes:
  - SHA-256 hash-based deduplication (check DB before calling AI)
  - Only cache successful, validated JSON responses
  - Retry logic on AI failures
  - Rate limit (429) and payment (402) error handling
- **fix-resume**: Takes analysis results + original content, generates improved resume content via AI with template-specific formatting

### AI Prompt Engineering
- System role: "Senior Technical Recruiter + ATS Evaluation Engine"
- Forces internal multi-layer reasoning before scoring
- Explicit instruction: no generic advice
- Structured JSON output via tool calling
- Temperature 0.2 for consistency

---

## Key Features

### Resume Parsing
- Client-side PDF text extraction from uploaded files
- Text sent to edge function for analysis

### Caching & Deduplication
- SHA-256 hash of resume content
- Check database before calling AI
- Only store validated successful responses
- Error responses never cached

### Premium UI Elements
- Dark theme with subtle gradients and glassmorphism
- Animated score meters (circular progress indicators)
- Card-based categorized feedback with color-coded severity
- Smooth transitions and micro-animations
- Fully mobile responsive
- Clean typography with proper spacing

### PDF Generation
- Client-side PDF generation for fixed resumes
- 3 template layouts with proper formatting
- ATS-compatible output (clean structure, standard fonts)

---

## User Flow
1. User signs up / logs in
2. Uploads resume PDF on dashboard
3. System parses PDF → sends to AI analysis engine
4. Receives detailed multi-layer scores and feedback
5. Views animated score dashboard with categorized issues
6. Clicks "Fix My Resume" → AI generates improved content
7. Selects template → previews → downloads PDF
8. Analysis saved to history for future reference

