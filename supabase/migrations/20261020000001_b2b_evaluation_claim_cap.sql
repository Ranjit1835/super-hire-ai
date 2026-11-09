-- Cap evaluation retries on every path, not only the scheduled sweep.
--
-- Before: b2b_claim_evaluation re-claimed a FAILED evaluation immediately and without limit, so the
-- interview's owner could call b2b-evaluate { action: "evaluate" } in a loop on a transcript that
-- always fails, and every call cost up to two model calls. The sweep (20260924000003) already waited
-- 5 minutes between retries and stopped after 5 attempts; the user-triggered path did not.
--
-- After: a failed evaluation is re-claimed only after 5 minutes and while attempts < 5, the same
-- policy as the sweep. Otherwise the claim returns { claimed: false, status: 'failed' }.
-- A pending claim abandoned by a dead worker (3 minutes) can still be taken over, as before.
-- Signature, grants and the other return shapes are unchanged.

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
  IF ev.status = 'failed' THEN
    IF ev.attempts < 5 AND ev.updated_at < now() - interval '5 minutes' THEN
      UPDATE public.b2b_evaluations SET status = 'pending', error = NULL, updated_at = now() WHERE id = ev.id;
      RETURN jsonb_build_object('claimed', true, 'status', 'pending', 'evaluation_id', ev.id);
    END IF;
    RETURN jsonb_build_object('claimed', false, 'status', 'failed', 'evaluation_id', ev.id);
  END IF;
  -- A pending claim that was abandoned (worker died): take it over.
  IF ev.updated_at < now() - interval '3 minutes' THEN
    UPDATE public.b2b_evaluations SET status = 'pending', error = NULL, updated_at = now() WHERE id = ev.id;
    RETURN jsonb_build_object('claimed', true, 'status', 'pending', 'evaluation_id', ev.id);
  END IF;
  RETURN jsonb_build_object('claimed', false, 'status', 'pending', 'evaluation_id', ev.id);
END;
$$;
