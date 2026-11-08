-- B2C purchases that took the money but never delivered:
--  * AI_INTERVIEW / MOCK_INTERVIEW: verify-payment granted nothing, and mock-interview only let
--    Unlimited / Early Bird users start, so the buyer got "Payment required to start interview".
--  * COMBO_PLAN: only set plan_type = 'COMBO', which nothing reads, so neither the fix nor the
--    interview was unlocked.
-- An interview purchase is now one credit on the profile, used when the interview starts.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS interview_credits INTEGER NOT NULL DEFAULT 0 CHECK (interview_credits >= 0);

-- Set by the first of verify-payment / razorpay-webhook to grant the purchase (see fulfil-payment.ts).
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS fulfilled_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.add_b2c_interview_credit(p_user_id UUID)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.profiles SET interview_credits = interview_credits + 1 WHERE user_id = p_user_id;
$$;

-- True when a credit was taken. Atomic, so two tabs can't spend one credit twice.
CREATE OR REPLACE FUNCTION public.use_b2c_interview_credit(p_user_id UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH used AS (
    UPDATE public.profiles SET interview_credits = interview_credits - 1
    WHERE user_id = p_user_id AND interview_credits > 0
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM used);
$$;

REVOKE EXECUTE ON FUNCTION public.add_b2c_interview_credit(UUID), public.use_b2c_interview_credit(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.add_b2c_interview_credit(UUID), public.use_b2c_interview_credit(UUID)
  TO service_role;

-- Paid columns are server-only: the app never writes to profiles from the browser.
REVOKE UPDATE ON public.profiles FROM anon, authenticated;
GRANT UPDATE (display_name, avatar_url) ON public.profiles TO authenticated;

-- Deliver what earlier buyers already paid for: the code they paid under gave them no interview.
-- If an older version did serve someone, the extra credit costs one interview.
UPDATE public.profiles p
SET interview_credits = p.interview_credits + paid.purchases
FROM (
  SELECT user_id, count(*)::INTEGER AS purchases
  FROM public.payments
  WHERE status = 'SUCCESS' AND payment_type IN ('AI_INTERVIEW', 'MOCK_INTERVIEW', 'COMBO_PLAN')
  GROUP BY user_id
) paid
WHERE p.user_id = paid.user_id;

-- Combo payments weren't linked to a resume, so unlock the buyer's latest one.
UPDATE public.resume_analyses
SET is_paid_fix_unlocked = true, paid_fix_unlocked_at = now()
WHERE id IN (
  SELECT DISTINCT ON (a.user_id) a.id
  FROM public.resume_analyses a
  WHERE a.user_id IN (SELECT user_id FROM public.payments WHERE status = 'SUCCESS' AND payment_type = 'COMBO_PLAN')
  ORDER BY a.user_id, a.created_at DESC
);

-- Everything paid before this point has been handled; don't let a retry grant it again.
UPDATE public.payments SET fulfilled_at = now() WHERE status = 'SUCCESS' AND fulfilled_at IS NULL;
