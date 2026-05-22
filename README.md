# HireResume.in — AI-Powered Resume Platform

Built by **Ranjit Perumala** ([@Ranjit1835](https://github.com/Ranjit1835))

HireResume is a full-stack AI resume platform that helps job seekers analyze, optimize, and build professional resumes. Deployed at [hiresume.in](https://hiresume.in).

## Features

### Resume Analysis (Core)
- Upload PDF → instant ATS score with 5-layer AI analysis
- Recruiter psychology simulation (6-second scan)
- ATS compatibility testing (Workday, Greenhouse, Lever, Taleo)
- Student vs. professional auto-detection with tailored scoring
- Guest analysis with sign-up-to-unlock flow

### Resume Studio (NEW)
- Conversational AI resume editor with split-screen experience
- Chat with AI in natural language → resume updates in real-time
- Hybrid LLM: Groq LLaMA 3.3 70B (free) / Claude Haiku & Sonnet (paid)
- 5 persona modes (Big Tech, Startup, Enterprise, AI/ML, Career Switcher)
- Version history with one-click revert
- Smart suggestions engine (weak bullets, filler words, missing sections)
- 5 premium templates with live preview
- Share via unique read-only links

### Resume Fix (Paid)
- AI-powered resume rewriting based on analysis results
- 5 downloadable PDF templates with inline editing

### Resume Builder
- Multi-step wizard with 50 templates across 5 categories
- AI enhancement of user content

### AI Mock Interview
- Text-based and full voice-to-voice interview modes
- 12 tech roles, 3 experience levels
- Real-time scoring and detailed reports

### Additional Features
- Razorpay payment integration (multiple plan tiers)
- Referral system with credits
- Public leaderboard (opt-in)
- College placement partnership (B2B)
- Weekly analytics dashboard

## Tech Stack

- **Frontend:** React 18 + TypeScript + Vite + Tailwind CSS + shadcn/ui + Framer Motion
- **Backend:** Supabase (PostgreSQL + 23 Edge Functions + Auth + RLS)
- **AI:** Groq LLaMA 3.3 70B, Claude Haiku 4.5, Claude Sonnet 4.6
- **Payments:** Razorpay
- **Deployment:** Netlify
- **PDF:** Client-side generation with pdf-lib + pdfjs-dist

## Getting Started

```sh
# Clone the repository
git clone https://github.com/Ranjit1835/super-hire-ai.git
cd super-hire-ai

# Install dependencies
npm install

# Start development server
npm run dev
```

Requires environment variables for Supabase and API keys (see Supabase Edge Function configs).

## Project Structure

```
src/
  components/       # Shared UI components (shadcn/ui, landing sections)
  contexts/         # Auth context
  features/
    studio/         # Resume Studio feature module
      components/   # ChatPanel, PreviewPanel, VersionHistory, Suggestions
      hooks/        # useStudioSession, useChatStream, useVersionHistory
      lib/          # claudeStream, jsonPatch, resumeDiff
      pages/        # StudioPage, StudioPaywallPage, StudioSharedPage
      types/        # TypeScript interfaces
  hooks/            # Shared hooks
  integrations/     # Supabase client
  lib/              # PDF generators, parsers, utilities
  pages/            # Route-level page components

supabase/
  functions/        # 23 Supabase Edge Functions
  migrations/       # Database migrations
```

## License

All rights reserved. This project is proprietary software built by Ranjit Perumala.
