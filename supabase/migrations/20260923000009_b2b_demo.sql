-- B2B demo org support (Step 8).
-- Demo institutions are ordinary orgs with is_demo = true, so every screen and RLS rule
-- is exercised exactly as for a real college. This migration adds:
--   • b2b_demo_reset(org): deletes a demo org and all its data — refuses anything not is_demo
--   • demo orgs excluded from the evaluation sweep (never spend LLM calls on fictional data)

CREATE OR REPLACE FUNCTION public.b2b_demo_reset(_org_id UUID)
RETURNS UUID[] LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_demo BOOLEAN;
  v_users UUID[];
BEGIN
  SELECT is_demo INTO v_demo FROM public.organizations WHERE id = _org_id FOR UPDATE;
  IF NOT FOUND THEN RETURN '{}'::uuid[]; END IF;
  IF NOT v_demo THEN
    RAISE EXCEPTION 'REFUSED: % is not a demo organization', _org_id USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Generated demo accounts only: @demo.hiresume.invalid AND no membership in any real org.
  -- A real person attached to the demo (e.g. the founder as demo admin) is never returned.
  SELECT coalesce(array_agg(m.user_id), '{}') INTO v_users
  FROM public.org_memberships m
  JOIN auth.users u ON u.id = m.user_id
  WHERE m.org_id = _org_id
    AND lower(u.email) LIKE '%@demo.hiresume.invalid'
    AND NOT EXISTS (
      SELECT 1 FROM public.org_memberships o JOIN public.organizations oo ON oo.id = o.org_id
      WHERE o.user_id = m.user_id AND NOT oo.is_demo
    );

  -- Children first: interviews reference modules with ON DELETE RESTRICT.
  DELETE FROM public.b2b_evaluations WHERE org_id = _org_id;
  DELETE FROM public.b2b_interview_turns WHERE org_id = _org_id;
  DELETE FROM public.b2b_interviews WHERE org_id = _org_id;
  DELETE FROM public.organizations WHERE id = _org_id; -- cascades batches, memberships, invites, modules, usage, consents
  RETURN v_users;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.b2b_demo_reset(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.b2b_demo_reset(UUID) TO service_role;

-- Demo orgs never need (paid) evaluations.
CREATE OR REPLACE FUNCTION public.b2b_interviews_needing_evaluation(_version TEXT, _org_id UUID DEFAULT NULL, _limit INTEGER DEFAULT 50)
RETURNS TABLE (interview_id UUID) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT i.id FROM public.b2b_interviews i
  JOIN public.organizations o ON o.id = i.org_id
  WHERE i.status IN ('completed', 'abandoned')
    AND NOT o.is_demo
    AND (_org_id IS NULL OR i.org_id = _org_id)
    AND EXISTS (SELECT 1 FROM public.b2b_interview_turns t WHERE t.interview_id = i.id AND t.role = 'student')
    AND NOT EXISTS (SELECT 1 FROM public.b2b_evaluations e
                    WHERE e.interview_id = i.id AND e.evaluator_version = _version AND e.status = 'completed')
  ORDER BY i.completed_at NULLS LAST
  LIMIT greatest(1, least(_limit, 500))
$$;
