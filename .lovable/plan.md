

# Plan: Razorpay Payment System for HireResume

## Important: Architecture Adaptation

Your request describes a Java/Spring Boot architecture, but this project runs on **React + Supabase Edge Functions (Deno)**. There is no Java backend. The plan below implements the exact same business logic and payment flow using the existing tech stack. The result is functionally identical.

---

## Database Changes (New Migration)

### New table: `payments`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid (PK) | `gen_random_uuid()` |
| `user_id` | uuid NOT NULL | |
| `resume_analysis_id` | uuid, nullable | FK to `resume_analyses` (for ONE_TIME_FIX) |
| `payment_type` | text NOT NULL | `ONE_TIME_FIX` or `EARLY_BIRD_ACCESS` |
| `amount` | integer NOT NULL | In paise (29900 or 149900) |
| `currency` | text NOT NULL DEFAULT 'INR' | |
| `razorpay_order_id` | text UNIQUE | |
| `razorpay_payment_id` | text | |
| `razorpay_signature` | text | |
| `status` | text NOT NULL DEFAULT 'INITIATED' | `INITIATED`, `SUCCESS`, `FAILED` |
| `created_at` | timestamptz | `now()` |
| `updated_at` | timestamptz | `now()` |

RLS: Users can SELECT their own payments. INSERT/UPDATE only via edge functions (service role).

### Alter `profiles` table

Add columns:
- `early_bird_active` boolean DEFAULT false
- `early_bird_expiry_date` timestamptz
- `total_payments` integer DEFAULT 0

### Alter `resume_analyses` table

Add columns:
- `is_paid_fix_unlocked` boolean DEFAULT false
- `paid_fix_unlocked_at` timestamptz

---

## New Edge Functions

### 1. `create-payment-order` (POST)

- Authenticates user
- Accepts `{ paymentType, resumeAnalysisId? }`
- Validates: if `ONE_TIME_FIX`, `resumeAnalysisId` is required and must belong to user
- Checks if already unlocked (idempotency)
- Creates Razorpay order via Razorpay API (`https://api.razorpay.com/v1/orders`) using `RAZORPAY_KEY_ID` + `RAZORPAY_KEY_SECRET`
- Inserts into `payments` table with `status = INITIATED`
- Returns `{ orderId, keyId, amount, currency, paymentId (internal) }`

### 2. `verify-payment` (POST)

- Authenticates user
- Accepts `{ razorpay_order_id, razorpay_payment_id, razorpay_signature }`
- Fetches payment record by `razorpay_order_id`, validates it belongs to the user
- Prevents double verification (if already SUCCESS, return success)
- Computes HMAC-SHA256 signature: `razorpay_order_id|razorpay_payment_id` with `RAZORPAY_KEY_SECRET`
- Compares signatures
- If mismatch: mark `FAILED`, return error
- If match: mark `SUCCESS`, then unlock:
  - **ONE_TIME_FIX**: Set `resume_analyses.is_paid_fix_unlocked = true`, `paid_fix_unlocked_at = now()`
  - **EARLY_BIRD_ACCESS**: Set `profiles.early_bird_active = true`, `early_bird_expiry_date = now + 365 days`
- Increment `profiles.total_payments`

### 3. `check-fix-access` (GET)

- Authenticates user
- Accepts `{ resumeAnalysisId }`
- Returns `{ canAccess: boolean, reason: string }`
- Logic:
  1. If `profiles.early_bird_active = true` AND `early_bird_expiry_date > now` → true
  2. If `resume_analyses.is_paid_fix_unlocked = true` → true
  3. Else → false

### 4. `razorpay-webhook` (POST, no auth)

- Verifies webhook signature using `X-Razorpay-Signature` header
- Handles `payment.captured` → mark SUCCESS + unlock
- Handles `payment.failed` → mark FAILED
- Idempotent (checks current status before updating)

---

## Secrets Required

- `RAZORPAY_KEY_ID` — Razorpay test/live key ID
- `RAZORPAY_KEY_SECRET` — Razorpay test/live key secret

User will be prompted to add these.

---

## Frontend Changes

### `src/pages/Analysis.tsx`

- The "Fix My Resume" button checks access before navigating
- Calls `check-fix-access` edge function
- If `canAccess = true` → navigate to `/fix/:id` as before
- If `canAccess = false` → show a payment modal/dialog

### New component: `src/components/PaymentDialog.tsx`

- Dialog with two pricing options:
  - **Unlock This Resume Fix — ₹299** (ONE_TIME_FIX)
  - **Upgrade to Early Bird — ₹1,499/year** (EARLY_BIRD_ACCESS, unlimited fixes + premium)
- On selection:
  1. Calls `create-payment-order`
  2. Opens Razorpay Checkout (loads script dynamically)
  3. On success callback → calls `verify-payment`
  4. Shows receipt: Order ID, Payment ID, Plan purchased
  5. Navigates to `/fix/:id`

### `src/pages/FixResume.tsx`

- Before calling `fix-resume` edge function, check access via `check-fix-access`
- If not authorized, redirect back to analysis page with a toast

### `src/pages/Dashboard.tsx`

- Show Early Bird badge on header if user has active subscription
- No other changes needed

### `index.html`

- Add Razorpay checkout script: `<script src="https://checkout.razorpay.com/v1/checkout.js"></script>`

---

## Scheduled Expiry (Early Bird)

Since this project uses Supabase, implement using `pg_cron`:
- Daily job checks: `WHERE early_bird_active = true AND early_bird_expiry_date < now()`
- Sets `early_bird_active = false`

---

## Security Measures

- Signature verification on every payment (HMAC-SHA256)
- Razorpay secret key only in edge functions (never in frontend)
- Frontend only receives `keyId` (publishable)
- Double-verification prevention (idempotent verify endpoint)
- Resume ownership validation before creating ONE_TIME_FIX orders
- Webhook signature verification for server-to-server events
- RLS on payments table (users can only read own records)

---

## File Summary

| File | Change |
|------|--------|
| New migration | Create `payments` table, alter `profiles` + `resume_analyses` |
| `supabase/functions/create-payment-order/index.ts` | New — create Razorpay order |
| `supabase/functions/verify-payment/index.ts` | New — verify signature + unlock |
| `supabase/functions/check-fix-access/index.ts` | New — access check |
| `supabase/functions/razorpay-webhook/index.ts` | New — webhook handler |
| `src/components/PaymentDialog.tsx` | New — pricing UI + Razorpay checkout |
| `src/pages/Analysis.tsx` | Edit — gate "Fix My Resume" behind access check |
| `src/pages/FixResume.tsx` | Edit — verify access on load |
| `src/pages/Dashboard.tsx` | Edit — show Early Bird badge |
| `index.html` | Edit — add Razorpay checkout script |
| pg_cron job | Scheduled early bird expiry |

