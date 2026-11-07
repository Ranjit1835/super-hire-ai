-- R6.1 AI cost per college, per student, per feature and per day, from b2b_usage_log (every gateway call is logged
-- with feature, tokens incl. cached input, speech units, cost, org and user). Super admins only (MFA-verified).
-- _by: 'org' | 'student' | 'feature' | 'day' (IST). _org_id narrows to one organisation. Rows sorted by cost.
-- Rollback: DROP FUNCTION public.super_cost_breakdown(text, timestamptz, timestamptz, uuid).

CREATE OR REPLACE FUNCTION public.super_cost_breakdown(
  _by TEXT, _from TIMESTAMPTZ DEFAULT now() - interval '30 days', _to TIMESTAMPTZ DEFAULT now(), _org_id UUID DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v JSONB;
BEGIN
  IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'insufficient_privilege'; END IF;
  IF _by NOT IN ('org', 'student', 'feature', 'day') THEN RAISE EXCEPTION 'INVALID_GROUP' USING ERRCODE = 'check_violation'; END IF;

  WITH u AS (
    SELECT l.*,
      CASE _by
        WHEN 'org' THEN l.org_id::text
        WHEN 'student' THEN l.user_id::text
        WHEN 'feature' THEN COALESCE(l.feature, l.purpose, l.kind)
        ELSE to_char(l.created_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD')
      END AS k
    FROM public.b2b_usage_log l
    LEFT JOIN public.organizations o ON o.id = l.org_id
    WHERE l.created_at >= _from AND l.created_at < _to
      AND (_org_id IS NULL OR l.org_id = _org_id)
      AND NOT COALESCE(o.is_demo, false)
  ), g AS (
    SELECT k, count(*) AS calls, COALESCE(sum(input_tokens), 0) AS input_tokens, COALESCE(sum(output_tokens), 0) AS output_tokens,
           COALESCE(sum(cached_input_tokens), 0) AS cached_input_tokens, count(*) FILTER (WHERE cache_hit) AS cache_hits,
           COALESCE(sum(stt_seconds), 0) AS stt_seconds, COALESCE(sum(tts_chars), 0) AS tts_chars,
           round(COALESCE(sum(cost_inr), 0), 4) AS cost_inr,
           (array_agg(org_id) FILTER (WHERE org_id IS NOT NULL))[1] AS any_org
    FROM u GROUP BY k
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'key', g.k,
      'label', CASE _by
        WHEN 'org' THEN COALESCE((SELECT o.name FROM public.organizations o WHERE o.id::text = g.k), 'No organisation')
        WHEN 'student' THEN COALESCE(
          (SELECT m.full_name FROM public.org_memberships m WHERE m.user_id::text = g.k AND m.full_name IS NOT NULL LIMIT 1),
          (SELECT s.full_name FROM public.students s WHERE s.user_id::text = g.k LIMIT 1),
          (SELECT c.full_name FROM public.candidates c WHERE c.user_id::text = g.k LIMIT 1),
          CASE WHEN g.k IS NULL THEN 'System / no user' ELSE 'User ' || left(g.k, 8) END)
        ELSE COALESCE(g.k, 'unknown') END,
      'org_name', CASE WHEN _by = 'student' THEN (SELECT o.name FROM public.organizations o WHERE o.id = g.any_org) END,
      'calls', g.calls, 'input_tokens', g.input_tokens, 'output_tokens', g.output_tokens,
      'cached_input_tokens', g.cached_input_tokens, 'cache_hits', g.cache_hits,
      'stt_seconds', g.stt_seconds, 'tts_chars', g.tts_chars, 'cost_inr', g.cost_inr
    ) ORDER BY CASE WHEN _by = 'day' THEN NULL ELSE g.cost_inr END DESC NULLS LAST, g.k DESC), '[]'::jsonb)
  INTO v FROM g;
  RETURN v;
END;
$$;
REVOKE ALL ON FUNCTION public.super_cost_breakdown(TEXT, TIMESTAMPTZ, TIMESTAMPTZ, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.super_cost_breakdown(TEXT, TIMESTAMPTZ, TIMESTAMPTZ, UUID) TO authenticated;
