-- A candidate link was linked to whatever anonymous session opened it. On a shared computer (a college lab, a
-- family laptop) the next candidate's link opened in the same browser reused the previous candidate's session,
-- and _b2b_rc_sync then attached the previous candidate's interview and match score to the new candidate.
-- An anonymous session now belongs to one candidate: a different candidate's link refuses with SESSION_IN_USE,
-- and the candidate page starts a fresh anonymous session and retries. The same person's links for other roles
-- (same candidate_id) still share the session. Body otherwise unchanged from 20261021000010.

CREATE OR REPLACE FUNCTION public.b2b_claim_candidate_token(_token_hash TEXT, _user_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  r JSONB := public.b2b_resolve_candidate_token(_token_hash);
  rc public.role_candidates;
  v_prev UUID;
BEGIN
  IF r->>'status' <> 'valid' THEN RETURN jsonb_build_object('ok', false, 'reason', upper(r->>'status')); END IF;
  IF NOT COALESCE((SELECT is_anonymous FROM auth.users WHERE id = _user_id), false) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NOT_ANONYMOUS');
  END IF;
  SELECT * INTO rc FROM public.role_candidates WHERE invite_token_hash = _token_hash FOR UPDATE;
  IF rc.session_user_id IS NOT NULL AND rc.session_user_id <> _user_id THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'OTHER_DEVICE');
  END IF;
  IF EXISTS (SELECT 1 FROM public.role_candidates o WHERE o.session_user_id = _user_id AND o.candidate_id <> rc.candidate_id)
     OR EXISTS (SELECT 1 FROM public.candidates c WHERE c.user_id = _user_id AND c.id <> rc.candidate_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'SESSION_IN_USE');
  END IF;
  PERFORM set_config('b2b.actor', _user_id::text, true);
  IF rc.session_user_id IS NULL THEN
    SELECT user_id INTO v_prev FROM public.candidates WHERE id = rc.candidate_id;
    UPDATE public.role_candidates SET session_user_id = _user_id, linked_at = now() WHERE id = rc.id;
    UPDATE public.candidates SET user_id = _user_id WHERE id = rc.candidate_id;
    -- Re-issued link: the work done so far for this role moves to the new session.
    UPDATE public.attempts SET subject_user_id = _user_id, active_session_id = NULL
      WHERE context_type = 'job_role' AND context_id = rc.job_role_id AND candidate_id = rc.candidate_id
        AND subject_user_id <> _user_id;
    UPDATE public.b2b_interviews SET user_id = _user_id
      WHERE kind = 'job_role' AND context_id = rc.job_role_id AND user_id <> _user_id
        AND (candidate_id = rc.candidate_id OR id = rc.interview_id OR (v_prev IS NOT NULL AND user_id = v_prev));
    UPDATE public.proctoring_sessions SET subject_user_id = _user_id
      WHERE context_type = 'job_role' AND context_id = rc.job_role_id AND subject_user_id <> _user_id
        AND (attempt_id IN (SELECT id FROM public.attempts WHERE context_type = 'job_role' AND context_id = rc.job_role_id
                                                              AND candidate_id = rc.candidate_id)
             OR interview_id IN (SELECT id FROM public.b2b_interviews WHERE kind = 'job_role' AND context_id = rc.job_role_id
                                                                         AND user_id = _user_id));
  END IF;
  RETURN jsonb_build_object('ok', true) || public._b2b_rc_sync(rc.id);
END;
$$;
