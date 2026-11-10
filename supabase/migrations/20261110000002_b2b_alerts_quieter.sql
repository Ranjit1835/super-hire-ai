-- Quieter organisation alerts (production test 2026-11-10).
--  * Deactivated organisations are never alerted: nobody can use them until they are reactivated.
--  * low_credits also needs the balance to be under a quarter of everything the org has been given (grants and
--    top-ups), so a new college sitting on its full opening credits isn't flagged. With no grants yet, the old rule holds.
-- Same shape and order as 20261029000025_b2b_org_alerts.sql otherwise.
-- Rollback: re-run b2b_org_alerts() from 20261029000025_b2b_org_alerts.sql.

CREATE OR REPLACE FUNCTION public.b2b_org_alerts()
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH o AS (
    SELECT o.id, o.name, o.type, o.credits_balance, o.plan_ends_at, o.seat_limit,
           COALESCE(NULLIF(o.settings->>'low_credit_alert', '')::numeric, 50) AS low_at,
           COALESCE(NULLIF(o.settings->>'expiry_alert_days', '')::int, 14) AS expiry_days,
           CASE WHEN o.type = 'company' THEN NULL ELSE public.b2b_seats_used(o.id) END AS seats_used,
           (SELECT COALESCE(sum(l.delta), 0) FROM public.org_credit_ledger l
             WHERE l.org_id = o.id AND l.reason IN ('grant', 'top_up') AND l.delta > 0) AS granted
    FROM public.organizations o
    WHERE o.status = 'active' AND NOT o.is_demo AND o.deactivated_at IS NULL
  ), a AS (
    SELECT id, name, 'low_credits' AS kind, jsonb_build_object('credits', credits_balance, 'threshold', low_at) AS detail
      FROM o WHERE credits_balance < low_at AND (granted = 0 OR credits_balance < granted * 0.25)
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
