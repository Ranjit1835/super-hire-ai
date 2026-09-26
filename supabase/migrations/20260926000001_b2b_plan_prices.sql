-- Launch prices for institution plans (per enrolled student, for the plan period — typically a year).
-- Cost basis: ~₹3–4 of AI/speech usage per interview (see /admin/costs), so Basic (4 interviews)
-- and Pro (10 interviews) keep a healthy margin. Pilot is a free 30-day trial for up to 150 students.
-- Adjust any time from Admin → Costs → Plan prices.
UPDATE public.plans SET price_inr_per_student = 0   WHERE id = 'pilot';
UPDATE public.plans SET price_inr_per_student = 149 WHERE id = 'basic';
UPDATE public.plans SET price_inr_per_student = 299 WHERE id = 'pro';
