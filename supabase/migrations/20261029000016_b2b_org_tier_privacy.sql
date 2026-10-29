-- R3.1 pricing secrecy, part 2 (Phase 0 P0-2). Plan tiers ("pilot", "basic", "pro", "college_starter" ...) are
-- commercial information: only super admins may see them. Two leaks are closed here:
--  1. organizations.plan_id was readable through the REST API by every member of the org (students included),
--     because the "Members read own org" RLS policy returns whole rows. RLS can't hide one column, so column
--     privileges do: signed-in users may read every column except plan_id. Super admins read full rows through
--     super_orgs() (below). Writes are unchanged (super admins still set plan_id through INSERT/UPDATE).
--  2. org_usage_summary() returned the plan's id and name to org staff; they now come back only for super admins.
-- Rollback: GRANT SELECT ON public.organizations TO authenticated; restore org_usage_summary from
-- 20260923000002_b2b_plans.sql; DROP FUNCTION public.super_orgs().

REVOKE SELECT ON public.organizations FROM authenticated, anon;
GRANT SELECT (id, name, slug, type, logo_url, is_demo, created_by, created_at, updated_at, plan_starts_at, plan_ends_at,
              public_test_enabled, public_test_monthly_cap, public_test_cta_label, public_test_cta_url, status, seat_limit,
              contact_name, contact_email, contact_phone, address, settings, credits_balance)
  ON public.organizations TO authenticated, anon;   -- anon: RLS still returns no rows

-- Full organisation rows (incl. plan_id) for super-admin screens.
CREATE OR REPLACE FUNCTION public.super_orgs()
RETURNS SETOF public.organizations LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'insufficient_privilege'; END IF;
  RETURN QUERY SELECT * FROM public.organizations ORDER BY created_at DESC;
END;
$$;
REVOKE ALL ON FUNCTION public.super_orgs() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.super_orgs() TO authenticated;

CREATE OR REPLACE FUNCTION public.org_usage_summary(_org_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v JSONB;
  v_super BOOLEAN := public.is_super_admin();
BEGIN
  IF NOT (v_super OR public.is_org_staff(_org_id)) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT jsonb_build_object(
    'org_id', o.id,
    -- Limits and features only; the tier id/name is added for super admins.
    'plan', jsonb_build_object(
      'interviews_per_student', p.interviews_per_student,
      'company_packs_enabled', p.company_packs_enabled, 'dashboard_enabled', p.dashboard_enabled,
      'max_students', p.max_students)
      || CASE WHEN v_super THEN jsonb_build_object('id', p.id, 'name', p.name) ELSE '{}'::jsonb END,
    'plan_starts_at', o.plan_starts_at,
    'plan_ends_at', o.plan_ends_at,
    'students', (SELECT count(*) FROM public.org_memberships m WHERE m.org_id = o.id AND m.role = 'student'),
    'interviews_used', (SELECT COALESCE(sum(u.interviews_used), 0) FROM public.org_student_usage u WHERE u.org_id = o.id),
    'students_exhausted', (SELECT count(*) FROM public.org_student_usage u
                            WHERE u.org_id = o.id AND u.interviews_used >= p.interviews_per_student)
  ) INTO v
  FROM public.organizations o JOIN public.plans p ON p.id = o.plan_id
  WHERE o.id = _org_id;
  RETURN v;
END;
$$;
