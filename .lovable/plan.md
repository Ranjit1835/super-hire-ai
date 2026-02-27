

# Implementation Plan: HireResume Enhancements (Round 2)

## Stack Clarification

This is a React + Supabase Edge Functions project. References to `AuthController`, `GuestAnalysisController`, `GuestAnalysisService`, Spring entities, and `application.yml` do not apply. All backend logic lives in edge functions and database tables.

---

## 1. Analyze Without Login + Blurred Result Flow

### Current behavior
Guest uploads on Landing → stores text in `sessionStorage` → redirects to `/auth` → after login, auto-analyzes on Dashboard.

### New behavior
Guest uploads on Landing → calls `analyze-resume` edge function **without auth** → navigates to `/analysis/guest/:token` → shows blurred results → login/signup overlay → after auth, binds analysis to user → reveals full results.

### Database changes
New `guest_analyses` table:
```sql
CREATE TABLE public.guest_analyses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_token text NOT NULL UNIQUE,
  analysis_result jsonb NOT NULL,
  resume_text text,
  file_name text NOT NULL,
  content_hash text NOT NULL,
  ats_score integer,
  resume_type text DEFAULT 'PROFESSIONAL',
  created_at timestamptz DEFAULT now(),
  expires_at timestamptz DEFAULT (now() + interval '30 minutes'),
  claimed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
-- RLS: deny all direct user access (edge functions use service role)
ALTER TABLE public.guest_analyses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Deny all" ON public.guest_analyses FOR ALL USING (false);
```

### Edge function changes
- `analyze-resume/index.ts`: If no auth header, generate a `session_token` (UUID), store result in `guest_analyses` instead of `resume_analyses`, return `{ guestToken, atsScore, resumeType }`.
- New `claim-guest-analysis/index.ts`: Authenticated endpoint that takes `guestToken`, validates it exists and isn't expired/claimed, copies data to `resume_analyses` for the authenticated user, marks `claimed_by`, returns the new analysis ID.

### Frontend changes
- `Landing.tsx`: On guest upload, call `analyze-resume` without auth token. On success, navigate to `/analysis/guest/${guestToken}`.
- New route `/analysis/guest/:token` in `App.tsx`.
- `Analysis.tsx`: Add guest mode. If route is `/analysis/guest/:token`, fetch guest analysis data from a new `get-guest-analysis` edge function (returns analysis with scores partially). Show blurred overlay on all sections below the performance header. Overlay contains "Sign in to unlock full analysis" + Sign In / Create Account buttons.
- After login (from overlay), call `claim-guest-analysis` with the token, then redirect to `/analysis/:newId`.
- Blur implementation: CSS `filter: blur(8px)` + `user-select: none` on content sections. Overlay uses `position: absolute` over the blurred content. Content IS in DOM but blurred — for extra security, the guest edge function returns truncated data (scores only, no detailed issues/recommendations).

### Cleanup
- Add a scheduled cleanup: use `pg_cron` to delete expired guest analyses every 15 minutes:
```sql
SELECT cron.schedule('cleanup-guest-analyses', '*/15 * * * *', $$
  DELETE FROM public.guest_analyses WHERE expires_at < now();
$$);
```

---

## 2. Proper Error Messages for Login

### Current behavior
`send-otp/index.ts` uses `signInWithPassword` which returns generic "Invalid login credentials" from Supabase Auth for both wrong email and wrong password.

### Fix
Supabase Auth intentionally does NOT distinguish between "wrong email" and "wrong password" for security (prevents email enumeration). This is an industry-standard security practice.

**Recommendation:** Keep the current generic message but improve the UX:
- Change error text to: "Invalid email or password. Please check your credentials and try again."
- Add a "Forgot Password?" link below the error message.
- This is the secure approach — exposing whether an email exists is a vulnerability.

If the user explicitly wants to distinguish (against security best practice), we can use the admin API to check if the email exists first, but this is NOT recommended.

### Changes
- `send-otp/index.ts`: Update error message text to be more helpful.
- `Auth.tsx`: Show error inline (not just toast) with a "Forgot Password?" link.

---

## 3. Forgot Password Flow

Supabase Auth has built-in password reset via `resetPasswordForEmail()`. No need for custom token tables — Supabase handles token generation, expiry, and validation.

### Flow
1. Auth page → "Forgot Password?" link → shows email input form
2. Calls `supabase.auth.resetPasswordForEmail(email, { redirectTo: origin + '/reset-password' })`
3. User receives email with magic link
4. Link redirects to `/reset-password` page
5. Page detects `type=recovery` in URL hash, shows new password form
6. Calls `supabase.auth.updateUser({ password: newPassword })`

### Changes
- `Auth.tsx`: Add "Forgot Password?" link on sign-in tab. When clicked, show email-only form that calls `resetPasswordForEmail`.
- New `src/pages/ResetPassword.tsx`: Form with "New Password" + "Confirm Password". Validates match, min 8 chars, 1 uppercase, 1 number. Calls `updateUser`.
- `App.tsx`: Add route `/reset-password` (public, not protected).

### Email
Password reset emails are sent by the built-in auth system. For custom branding, we can use Lovable auth email templates later.

---

## 4. Signup Password Validation

### Changes
- `Auth.tsx` signup form: Add "Confirm Password" field. Add client-side validation:
  - Min 8 characters (up from 6)
  - At least 1 uppercase letter
  - At least 1 number
  - Passwords must match
  - Show inline validation errors with specific messages
- The backend (Supabase Auth) already enforces minimum password length. Update the Supabase auth config to require 8 chars minimum.

---

## 5. Blurred Optimized Resume Preview (Pre-Payment)

### Current behavior
Analysis page has "Fix My Resume" button → checks payment → if unpaid, shows PaymentDialog.

### New behavior
On the Analysis page, add a "Preview: Your Optimized Resume" section at the bottom. Show first 3 lines of the rewritten summary visible, rest blurred. This uses data already in the analysis result (`rewrittenSummary`, `rewrittenStrongBullets`).

### Changes
- `Analysis.tsx`: Add a new section after "Improved Version Preview" showing a mock resume preview card with:
  - First ~100 chars of `rewrittenSummary` visible
  - Rest blurred with CSS `filter: blur(6px)` + `user-select: none`
  - Watermark overlay: "Upgrade to unlock full optimized resume"
  - CTA button: "Unlock Resume Fix – ₹299" (or discounted price)
- Content protection: The full fixed resume content is NOT loaded until payment. The preview uses only the already-available `rewrittenSummary` and `rewrittenStrongBullets` from the analysis result, so there's nothing extra to protect via inspect element.
- Only show this section if `is_paid_fix_unlocked` is false.

---

## 6. UI Polish

### Changes
- `src/index.css`: Add page transition animation utility
- Button hover: Already have `hover:scale-[1.02]` on some buttons — standardize across all CTAs
- Modal animations: Already using Framer Motion `AnimatePresence` — ensure PaymentDialog and auth modals use entry/exit animations
- Blur overlay animation: Use `motion.div` with `initial={{ opacity: 0 }}` for the guest analysis overlay
- Success animation after login: Add a brief checkmark animation on OTP verification success before redirect
- Premium gradient accents: Add subtle gradient borders to key cards on Analysis page

---

## 7. Conversion Optimization — Sticky Bottom Bar

### Changes
- `Analysis.tsx`: Add a sticky bottom bar (`fixed bottom-0`) that appears after scrolling past the header:
  - If guest (on guest analysis page): "Sign up to unlock full recruiter-grade analysis" + [Create Account] button
  - If logged-in but fix not purchased: "Ready to fix your resume?" + [Fix My Resume – ₹299] button
  - If fix already purchased: Don't show bar
- Use `IntersectionObserver` or scroll position to show/hide

---

## 8. Security Hardening

### Already implemented
- OTP single-use ✓
- Payment idempotency ✓ 
- Resume ownership validation ✓

### Additional changes
- `analyze-resume/index.ts`: Rate limit guest analyses by IP (add `X-Forwarded-For` header check, max 5 per hour per IP — store in a simple in-memory map or check recent `guest_analyses` count by content hash)
- `claim-guest-analysis/index.ts`: Validate token not already claimed, not expired
- Guest analysis: Return only scores + performance tag in guest mode, NOT full issues/recommendations (prevents data leak via network tab)
- `get-guest-analysis/index.ts`: Return truncated data — scores, performance tag, section counts, but NOT full issue text or fix recommendations

---

## 9. Email Templates

The OTP email is already sent via Resend API directly in `send-otp/index.ts`. Password reset emails use Supabase's built-in auth emails.

### Changes
- `send-otp/index.ts`: Already has a professional HTML template — no changes needed
- Password reset: Uses Supabase default email. Can be customized later with Lovable auth email templates if desired
- Payment confirmation: Not an auth email, so NOT supported by Lovable's email system. Would require Resend integration in `verify-payment` edge function. Will add a simple HTML confirmation email sent via the existing Resend API key.

---

## Summary of All Changes

### Database Migration
- New `guest_analyses` table with RLS
- `pg_cron` job for cleanup

### New Files
| File | Purpose |
|------|---------|
| `supabase/functions/claim-guest-analysis/index.ts` | Bind guest analysis to authenticated user |
| `supabase/functions/get-guest-analysis/index.ts` | Return truncated guest analysis data |
| `src/pages/ResetPassword.tsx` | Password reset form |
| `src/pages/GuestAnalysis.tsx` | Guest analysis view with blur overlay |

### Modified Files
| File | Changes |
|------|---------|
| `src/App.tsx` | Add `/reset-password` and `/analysis/guest/:token` routes |
| `src/pages/Landing.tsx` | Guest upload calls analyze-resume without auth, navigates to guest analysis |
| `src/pages/Auth.tsx` | Forgot password link/form, confirm password field, stronger validation, inline errors |
| `src/pages/Analysis.tsx` | Blurred resume preview section, sticky bottom conversion bar |
| `supabase/functions/analyze-resume/index.ts` | Support unauthenticated calls, store in guest_analyses |
| `supabase/functions/send-otp/index.ts` | Improved error message text |
| `supabase/functions/verify-payment/index.ts` | Send payment confirmation email via Resend |
| `src/index.css` | Page transition utilities, blur overlay styles |
| `supabase/config.toml` | Add new edge functions config |

### Not Changed
- Payment system (Razorpay flow untouched)
- AI analysis logic (same prompts, same scoring)
- Fix resume flow (unchanged)
- Student discount logic (already implemented)

### Items Deferred
- `GuestAnalysisEntity`, `GuestAnalysisService`, `GuestAnalysisController` — Spring concepts; equivalent is the `guest_analyses` table + edge functions
- `PasswordResetTokenEntity` — handled by Supabase Auth natively
- `ForgotPasswordController` — handled by `resetPasswordForEmail` client method
- Custom email templates for password reset — can be added later via Lovable auth email templates

