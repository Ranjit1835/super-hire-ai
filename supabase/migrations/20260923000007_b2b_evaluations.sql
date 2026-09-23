-- B2B interview evaluations (Step 6).
-- One row per (interview, evaluator_version): re-running after a rubric change adds a
-- new version instead of overwriting history. b2b_latest_evaluations exposes the newest
-- completed evaluation per interview (security_invoker → callers' RLS applies).

CREATE TABLE public.b2b_evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  interview_id UUID NOT NULL,
  org_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  module_id UUID NOT NULL,
  evaluator_version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
  model TEXT,
  result JSONB,                 -- EvaluationResult (dimensions, per_topic, primary_gap, readiness_level, …)
  audio_metrics JSONB,
  overall_score NUMERIC(4, 1) CHECK (overall_score IS NULL OR overall_score BETWEEN 0 AND 10),
  readiness_level TEXT CHECK (readiness_level IN ('not_ready', 'developing', 'ready')),
  primary_gap TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  llm_usage JSONB NOT NULL DEFAULT '[]'::jsonb,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  FOREIGN KEY (interview_id, org_id) REFERENCES public.b2b_interviews(id, org_id) ON DELETE CASCADE,
  UNIQUE (interview_id, evaluator_version)
);
CREATE INDEX idx_b2b_evaluations_org ON public.b2b_evaluations(org_id, completed_at DESC);
CREATE INDEX idx_b2b_evaluations_user ON public.b2b_evaluations(user_id, completed_at DESC);

ALTER TABLE public.b2b_evaluations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read evaluations" ON public.b2b_evaluations
  FOR SELECT TO authenticated USING (
    user_id = auth.uid() OR public.is_org_staff(org_id) OR public.is_super_admin()
  );

CREATE VIEW public.b2b_latest_evaluations WITH (security_invoker = true) AS
  SELECT DISTINCT ON (interview_id) *
  FROM public.b2b_evaluations
  WHERE status = 'completed'
  ORDER BY interview_id, completed_at DESC;

-- Claim the right to evaluate (prevents two concurrent evaluator calls for one interview).
-- Returns { claimed, status, evaluation_id, reason? }.
CREATE OR REPLACE FUNCTION public.b2b_claim_evaluation(_interview_id UUID, _version TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  iv public.b2b_interviews;
  ev public.b2b_evaluations;
BEGIN
  SELECT * INTO iv FROM public.b2b_interviews WHERE id = _interview_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('claimed', false, 'reason', 'NOT_FOUND'); END IF;
  IF iv.status NOT IN ('completed', 'abandoned') THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'NOT_FINISHED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.b2b_interview_turns WHERE interview_id = iv.id AND role = 'student') THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'NO_ANSWERS');
  END IF;

  SELECT * INTO ev FROM public.b2b_evaluations WHERE interview_id = iv.id AND evaluator_version = _version FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.b2b_evaluations (interview_id, org_id, user_id, module_id, evaluator_version)
      VALUES (iv.id, iv.org_id, iv.user_id, iv.module_id, _version)
      RETURNING * INTO ev;
    RETURN jsonb_build_object('claimed', true, 'status', 'pending', 'evaluation_id', ev.id);
  END IF;
  IF ev.status = 'completed' THEN
    RETURN jsonb_build_object('claimed', false, 'status', 'completed', 'evaluation_id', ev.id);
  END IF;
  -- Failed, or a pending claim that was abandoned (worker died): take it over.
  IF ev.status = 'failed' OR ev.updated_at < now() - interval '3 minutes' THEN
    UPDATE public.b2b_evaluations SET status = 'pending', error = NULL, updated_at = now() WHERE id = ev.id;
    RETURN jsonb_build_object('claimed', true, 'status', 'pending', 'evaluation_id', ev.id);
  END IF;
  RETURN jsonb_build_object('claimed', false, 'status', 'pending', 'evaluation_id', ev.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.b2b_save_evaluation(
  _evaluation_id UUID, _status TEXT, _model TEXT, _result JSONB, _audio_metrics JSONB,
  _overall NUMERIC, _readiness TEXT, _primary_gap TEXT, _attempts INTEGER, _llm_usage JSONB, _error TEXT
) RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  UPDATE public.b2b_evaluations SET
    status = _status, model = _model, result = _result, audio_metrics = _audio_metrics,
    overall_score = _overall, readiness_level = _readiness, primary_gap = _primary_gap,
    attempts = attempts + coalesce(_attempts, 0), llm_usage = llm_usage || coalesce(_llm_usage, '[]'::jsonb),
    error = _error, updated_at = now(),
    completed_at = CASE WHEN _status = 'completed' THEN now() ELSE completed_at END
  WHERE id = _evaluation_id
$$;

-- Interviews that still need an evaluation at a given version (sweep / re-run after rubric change).
CREATE OR REPLACE FUNCTION public.b2b_interviews_needing_evaluation(_version TEXT, _org_id UUID DEFAULT NULL, _limit INTEGER DEFAULT 50)
RETURNS TABLE (interview_id UUID) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT i.id FROM public.b2b_interviews i
  WHERE i.status IN ('completed', 'abandoned')
    AND (_org_id IS NULL OR i.org_id = _org_id)
    AND EXISTS (SELECT 1 FROM public.b2b_interview_turns t WHERE t.interview_id = i.id AND t.role = 'student')
    AND NOT EXISTS (SELECT 1 FROM public.b2b_evaluations e
                    WHERE e.interview_id = i.id AND e.evaluator_version = _version AND e.status = 'completed')
  ORDER BY i.completed_at NULLS LAST
  LIMIT greatest(1, least(_limit, 500))
$$;

REVOKE EXECUTE ON FUNCTION
  public.b2b_claim_evaluation(UUID, TEXT),
  public.b2b_save_evaluation(UUID, TEXT, TEXT, JSONB, JSONB, NUMERIC, TEXT, TEXT, INTEGER, JSONB, TEXT),
  public.b2b_interviews_needing_evaluation(TEXT, UUID, INTEGER)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.b2b_claim_evaluation(UUID, TEXT),
  public.b2b_save_evaluation(UUID, TEXT, TEXT, JSONB, JSONB, NUMERIC, TEXT, TEXT, INTEGER, JSONB, TEXT),
  public.b2b_interviews_needing_evaluation(TEXT, UUID, INTEGER)
TO service_role;
