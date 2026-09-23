-- B2B dashboard read model (Step 7).
-- One compact row per interview with a completed evaluation (latest evaluator version):
-- scores only — evidence and reasons stay in b2b_evaluations for the drill-down.
-- Staff of the org (or super-admin) only, and only on plans with dashboard_enabled.

CREATE OR REPLACE FUNCTION public.org_dashboard_evaluations(_org_id UUID)
RETURNS TABLE (
  interview_id UUID, user_id UUID, module_id UUID, module_name TEXT, module_type TEXT,
  pass_threshold NUMERIC, started_at TIMESTAMPTZ, completed_at TIMESTAMPTZ,
  overall_score NUMERIC, readiness_level TEXT, primary_gap TEXT,
  dimensions JSONB, per_topic JSONB
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT (public.is_super_admin() OR public.is_org_staff(_org_id)) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT public.is_super_admin() AND NOT coalesce((
    SELECT p.dashboard_enabled FROM public.organizations o JOIN public.plans p ON p.id = o.plan_id WHERE o.id = _org_id
  ), false) THEN
    RAISE EXCEPTION 'PLAN_FEATURE: the batch dashboard is not included in this plan' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  WITH latest AS (
    SELECT DISTINCT ON (e.interview_id) e.*
    FROM public.b2b_evaluations e
    WHERE e.org_id = _org_id AND e.status = 'completed'
    ORDER BY e.interview_id, e.completed_at DESC
  )
  SELECT
    l.interview_id, l.user_id, l.module_id,
    i.module_spec->>'name', i.module_spec->>'type', (i.module_spec->>'pass_threshold')::numeric,
    i.started_at, l.completed_at, l.overall_score, l.readiness_level, l.primary_gap,
    coalesce((SELECT jsonb_object_agg(d.key, CASE WHEN jsonb_typeof(d.value->'score') = 'number' THEN d.value->'score' ELSE 'null'::jsonb END)
              FROM jsonb_each(l.result->'dimensions') d), '{}'::jsonb),
    coalesce((SELECT jsonb_object_agg(t.key, CASE WHEN jsonb_typeof(t.value->'score') = 'number' THEN t.value->'score' ELSE 'null'::jsonb END)
              FROM jsonb_each(l.result->'per_topic') t), '{}'::jsonb)
  FROM latest l
  JOIN public.b2b_interviews i ON i.id = l.interview_id
  ORDER BY i.started_at;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.org_dashboard_evaluations(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.org_dashboard_evaluations(UUID) TO authenticated;
