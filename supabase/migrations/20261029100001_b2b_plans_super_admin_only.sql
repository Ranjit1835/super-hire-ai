-- Pricing secrecy (R3.1). The "Read plans" policy let org staff read their plan row, including
-- price_inr_per_student, through the REST API. Plans (names, prices, limits) are now readable by super admins only.
-- Staff and students already get what they need without reading this table: my_interview_quota() and
-- org_usage_summary() (SECURITY DEFINER) return limits and usage with no price or tier fields.
-- Rollback: re-create the previous policy (20260923000002_b2b_plans.sql:51-55).
DROP POLICY IF EXISTS "Read plans" ON public.plans;
CREATE POLICY "Read plans" ON public.plans
  FOR SELECT TO authenticated USING (public.is_super_admin());
