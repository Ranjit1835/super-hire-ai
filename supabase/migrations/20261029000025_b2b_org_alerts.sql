-- R1.9 alerts for super admins: organisations that are about to stop working. Shown on the super-admin organisations
-- page and sent as a daily email digest (b2b-alerts edge function, 20261029000026_schedule_alerts_cron.sql).
--  * low_credits: credits_balance below settings.low_credit_alert (default 50).
--  * plan_expiring / plan_expired: plan_ends_at within settings.expiry_alert_days (default 14) / already passed.
--  * seats_full: seats used at 90% or more of seat_limit.
-- Active, non-demo organisations only. TPOs never see these (R1.9: they see seats and activity, not money or plans).
-- Rollback: DROP FUNCTION public.b2b_org_alerts(), public.super_org_alerts().

CREATE OR REPLACE FUNCTION public.b2b_org_alerts()
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH o AS (
    SELECT o.id, o.name, o.type, o.credits_balance, o.plan_ends_at, o.seat_limit,
           COALESCE(NULLIF(o.settings->>'low_credit_alert', '')::numeric, 50) AS low_at,
           COALESCE(NULLIF(o.settings->>'expiry_alert_days', '')::int, 14) AS expiry_days,
           CASE WHEN o.type = 'company' THEN NULL ELSE public.b2b_seats_used(o.id) END AS seats_used
    FROM public.organizations o
    WHERE o.status = 'active' AND NOT o.is_demo
  ), a AS (
    SELECT id, name, 'low_credits' AS kind, jsonb_build_object('credits', credits_balance, 'threshold', low_at) AS detail
      FROM o WHERE credits_balance < low_at
    UNION ALL
    SELECT id, name, 'plan_expired', jsonb_build_object('ends_at', plan_ends_at)
      FROM o WHERE plan_ends_at IS NOT NULL AND plan_ends_at <= now()
    UNION ALL
    SELECT id, name, 'plan_expiring', jsonb_build_object('ends_at', plan_ends_at,
             'days_left', GREATEST(0, ceil(extract(epoch FROM plan_ends_at - now()) / 86400)::int))
      FROM o WHERE plan_ends_at IS NOT NULL AND plan_ends_at > now() AND plan_ends_at <= now() + make_interval(days => expiry_days)
    UNION ALL
    SELECT id, name, 'seats_full', jsonb_build_object('seats_used', seats_used, 'seat_limit', seat_limit)
      FROM o WHERE seat_limit IS NOT NULL AND seats_used IS NOT NULL AND seats_used >= ceil(seat_limit * 0.9)
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('org_id', id, 'org_name', name, 'kind', kind, 'detail', detail)
                            ORDER BY CASE kind WHEN 'plan_expired' THEN 0 WHEN 'low_credits' THEN 1 WHEN 'plan_expiring' THEN 2 ELSE 3 END, name),
                  '[]'::jsonb)
  FROM a
$$;
REVOKE ALL ON FUNCTION public.b2b_org_alerts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.b2b_org_alerts() TO service_role;

-- The same list for the super-admin screen (MFA-verified, through is_super_admin).
CREATE OR REPLACE FUNCTION public.super_org_alerts()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'insufficient_privilege'; END IF;
  RETURN public.b2b_org_alerts();
END;
$$;
REVOKE ALL ON FUNCTION public.super_org_alerts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.super_org_alerts() TO authenticated;
