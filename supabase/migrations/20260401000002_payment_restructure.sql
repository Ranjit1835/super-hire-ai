-- Extend payment_type constraint to include new plan types
-- Old types kept for backward compatibility with existing payment records
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_payment_type_check;
ALTER TABLE public.payments ADD CONSTRAINT payments_payment_type_check
  CHECK (payment_type = ANY (ARRAY[
    'ONE_TIME_FIX', 'EARLY_BIRD_ACCESS', 'RESUME_BUILDER', 'MOCK_INTERVIEW',
    'RESUME_FIX', 'RESUME_BUILD', 'AI_INTERVIEW', 'COMBO_PLAN', 'UNLIMITED_PLAN'
  ]));

-- Add new plan tracking columns to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS plan_type TEXT DEFAULT 'FREE'
    CHECK (plan_type IN ('FREE', 'COMBO', 'UNLIMITED')),
  ADD COLUMN IF NOT EXISTS plan_expiry_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS monthly_resume_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_resume_reset_date TIMESTAMPTZ DEFAULT now();

-- Backfill existing early bird users to UNLIMITED plan_type
UPDATE public.profiles
  SET plan_type = 'UNLIMITED',
      plan_expiry_date = early_bird_expiry_date
  WHERE early_bird_active = true
    AND early_bird_expiry_date IS NOT NULL
    AND early_bird_expiry_date > now();

-- Function to reset monthly resume builder count
CREATE OR REPLACE FUNCTION public.reset_monthly_resume_counts()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.profiles
    SET monthly_resume_count = 0,
        last_resume_reset_date = now()
    WHERE DATE_TRUNC('month', last_resume_reset_date) < DATE_TRUNC('month', now());
END;
$$;

-- Schedule monthly reset on 1st of each month at midnight UTC
SELECT cron.schedule(
  'reset-monthly-resume-counts',
  '0 0 1 * *',
  $$SELECT public.reset_monthly_resume_counts()$$
);
