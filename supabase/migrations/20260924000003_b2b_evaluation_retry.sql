-- Evaluation retry policy for the scheduled sweep (see 20260924000004).
-- A failed evaluation (e.g. the AI provider returned 503 for longer than the in-call retries) is
-- picked up again, but:
--   * not before 5 minutes after the last failure (lets a provider outage pass), and
--   * never after 5 recorded attempts (a transcript that always fails can't burn model cost).
-- In-flight evaluations (pending, updated < 3 min ago) are skipped; b2b_claim_evaluation already
-- re-claims ones whose worker died.
CREATE OR REPLACE FUNCTION public.b2b_interviews_needing_evaluation(_version TEXT, _org_id UUID DEFAULT NULL, _limit INTEGER DEFAULT 50)
RETURNS TABLE (interview_id UUID) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT i.id FROM public.b2b_interviews i
  JOIN public.organizations o ON o.id = i.org_id
  LEFT JOIN public.b2b_evaluations e ON e.interview_id = i.id AND e.evaluator_version = _version
  WHERE i.status IN ('completed', 'abandoned')
    AND NOT o.is_demo
    AND (_org_id IS NULL OR i.org_id = _org_id)
    AND EXISTS (SELECT 1 FROM public.b2b_interview_turns t WHERE t.interview_id = i.id AND t.role = 'student')
    AND (e.id IS NULL
         OR (e.status = 'failed' AND e.attempts < 5 AND e.updated_at < now() - interval '5 minutes')
         OR (e.status = 'pending' AND e.updated_at < now() - interval '3 minutes'))
  ORDER BY i.completed_at NULLS LAST
  LIMIT greatest(1, least(_limit, 500))
$$;

REVOKE EXECUTE ON FUNCTION public.b2b_interviews_needing_evaluation(TEXT, UUID, INTEGER) FROM PUBLIC, anon, authenticated;
