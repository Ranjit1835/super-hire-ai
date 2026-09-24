-- Allow Resume Studio payment types.
-- 20260522000001_resume_studio.sql extended this CHECK, but production was set up by hand
-- without that part, so Studio purchases (STUDIO_SINGLE/WEEKLY/YEARLY) failed the constraint.
-- Idempotent: same final constraint as resume_studio.sql.
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_payment_type_check;
ALTER TABLE public.payments ADD CONSTRAINT payments_payment_type_check
  CHECK (payment_type IN (
    'ONE_TIME_FIX', 'EARLY_BIRD_ACCESS', 'RESUME_BUILDER', 'MOCK_INTERVIEW',
    'RESUME_FIX', 'RESUME_BUILD', 'AI_INTERVIEW', 'COMBO_PLAN', 'UNLIMITED_PLAN',
    'STUDIO_SINGLE', 'STUDIO_WEEKLY', 'STUDIO_YEARLY'
  ));
