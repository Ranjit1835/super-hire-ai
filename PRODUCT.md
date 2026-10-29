# Product

<!-- impeccable:product-schema 1 -->

Scope of this record: the **HiResume B2B app** (college placement portal, startup hiring portal, student and
candidate flows, super admin). The consumer site (hiresume.in resume checker, Studio, B2C mock interviews) is
out of scope for the B2B redesign and keeps its own look.

## Platform

web

## Users

- **TPO admins and trainers** at Indian engineering colleges (placement officers). They import the student list
  from Excel/CSV, run placement drives for a batch (eligibility by branch, batch, CGPA, backlogs, 10th/12th %),
  build coding and MCQ tests, review proctoring flags, release results, and export analytics for management.
  Work happens in long sessions on mid-range Windows laptops (8 GB RAM, short screens; 1366x577 usable seen).
- **Recruiters, company admins and hiring managers** at startups. They create a role from a job description,
  invite candidates, read candidate reports (match score, code, voice-interview transcript, integrity
  timeline), decide, and share reports through expiring links. Hiring managers see only roles assigned to them.
- **Students** (freshers, 18-22): accept an invite, see their drives, run a system check, take a proctored
  test and a voice interview; see scores only when the college releases them.
- **Candidates**: arrive through a link with no password, consent, system check, test, interview; never see scores.
- **Super admin**: the owner only. Creates colleges and companies, plans, seats, credits; watches usage and AI cost.

## Product Purpose

Let a college or a startup assess many people fairly with a coding/MCQ test, proctoring and an AI voice interview,
then decide from evidence (code, transcript, integrity timeline), at a per-student or per-candidate price.
Success: a TPO runs a whole drive and exports results without help; a recruiter reads a report and decides in
minutes; a test-taker finishes calmly and trusts the process.

## Positioning

One flow from roster to decision: eligibility-filtered drives for an Indian college batch, a proctored test, and a
voice interview that asks the candidate to explain the code they just submitted, with every score tied to evidence
and flags kept as evidence for human review, never automatic fails.

## Operating Context

- Rosters arrive as Excel/CSV from the college; invites go out as links (WhatsApp, college email) because email
  delivery is not set up yet.
- Drives have a window (opens/closes) and a results-release rule (manual, immediate, never).
- Proctoring levels: Standard (flags only), Strict (violations end the test), Maximum (pauses on violations).
  Requires desktop Chrome/Edge, webcam, microphone, entire-screen share, a single display.
- Interviews are **voice only** (owner decision): no typed mode.
- Pooled credits per organisation; plans priced per student per year (Starter ₹399).
- Credit top-ups (owner, 2026-10-24): no pack size is promised anywhere. Copy: "Need more credits? Contact HiResume
  for a top-up." with a "Contact HiResume" button that mails ranjitperumala@gmail.com (the owner's own address, by
  the owner's choice, until a support address exists).
- No "beta" label anywhere in the product, for candidates or staff (owner, 2026-10-24).

## Capabilities and Constraints

- Stack: React 18, Vite, React Router, Tailwind 3, shadcn/ui (Radix), framer-motion 12, Supabase. three.js +
  @react-three/fiber approved for the redesign (owner, 2026-10-23).
- B2B theme is scoped to B2B screens (`src/b2b/theme.css`, applied by the B2B shells); B2C pages must not change.
- 760+ Vitest tests address the UI by accessible labels, roles and visible text: those strings are a contract.
- Code runner (Judge0) is not deployed yet; coding questions can be unverified drafts.
- Email sending is not configured; every invite screen must show copyable links.
- Undecided: B2C/B2B brand alignment (logo is blue→orange; consumer site is violet).

## Brand Commitments

- Name: **HiResume** (never HireResume or HireSume).
- Logo: rounded square, 135° gradient #1565ff → #ff5a0f, white "H" in Space Grotesk and a white bar (`public/logo.svg`).
  **Open to redesign** (owner, 2026-10-23: "change logo according to your planned theme"): the new mark is drawn
  with the chosen B2B direction and ships as separate B2B files first; `public/logo.svg` / favicon (also used by the
  live consumer site) change only on the owner's later approval. The name HiResume is fixed.
- Voice: plain, direct, specific; Indian English context (TPO, CGPA, backlogs, batch, drive).
- Owner's brief for the B2B look (verbatim, 2026-10-23): "Go check for different websites out there, some motion
  animations, 3D blocks and extreme futuristic style for all the sub pages. current theme looks like AI built. it
  shouldn't be like that."

## Evidence on Hand

- Logo and favicon (`public/logo.svg`, `public/favicon.svg`), OG image.
- The working product itself (all B2B flows run locally).
- **None of these exist and must never be invented:** customer names or logos, testimonials, usage or placement
  numbers, ratings, press. Test fixtures (demo students s1-s9, demo candidates) are not customers.

## Product Principles

1. Evidence over verdicts: every score sits next to what produced it; AI suggests, people decide.
2. Calm for the person being assessed: nothing on a test or interview screen competes with the task.
3. Fast for the person doing the work: tables, filters and forms stay dense, legible and keyboard-friendly.
4. Fair by construction: eligibility rules, proctoring flags and results release are explicit and reviewable.
5. Honest copy: no invented proof, no claims the product cannot keep.

## Accessibility & Inclusion

- Honour `prefers-reduced-motion` everywhere; WebGL scenes must have a static fallback and pause off-screen.
- Keyboard paths and visible focus on every control; contrast ≥ 4.5:1 for body text.
- Works on low-end GPUs and 8 GB laptops; no 3D or heavy motion inside test-taking or data-entry areas.
