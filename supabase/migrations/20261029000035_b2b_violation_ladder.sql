-- R2.6 warning ladder for strict proctoring: warn (violation n of max) -> final warning (one before the limit) ->
-- auto-submit at the limit (unchanged). The reply now carries max_violations so the student sees "2 of 3".
-- Regenerated from 20261021000007; only the strict branch and the reply changed.
CREATE OR REPLACE FUNCTION public.b2b_proctor_log_events(_actor UUID, _session_id UUID, _events JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  s public.proctoring_sessions;
  t JSONB;
  v_prefix TEXT;
  v_accepted INTEGER;
  v_hard INTEGER;
  v_flagged INTEGER;
  v_last_pause TIMESTAMPTZ;
  v_pause_type TEXT;
  v_last_resume TIMESTAMPTZ;
  v_pauses INTEGER;
  v_action TEXT := 'none';
  v_max INTEGER;
  v_status TEXT;
BEGIN
  SELECT * INTO s FROM public.proctoring_sessions WHERE id = _session_id FOR UPDATE;
  IF NOT FOUND OR _actor IS NULL OR s.subject_user_id <> _actor THEN RETURN jsonb_build_object('ok', false, 'reason', 'NOT_FOUND'); END IF;
  IF s.status = 'ended' THEN RETURN jsonb_build_object('ok', false, 'reason', 'SESSION_ENDED'); END IF;
  PERFORM set_config('b2b.actor', _actor::text, true);
  v_prefix := 'org/' || s.org_id || '/sessions/' || s.id || '/';
  v_status := s.status;

  WITH src AS (
    SELECT e->>'type' AS type, e->>'severity' AS severity,
           LEAST(1, GREATEST(0, COALESCE((e->>'confidence')::numeric, 1))) AS confidence,
           (e->>'startedAt')::timestamptz AS started_at, (e->>'endedAt')::timestamptz AS ended_at,
           e->>'evidencePath' AS evidence_path, e->'meta' AS meta, (e->>'clientEventId')::uuid AS client_event_id
    FROM jsonb_array_elements(COALESCE(_events, '[]'::jsonb)) e
  ), ins AS (
    INSERT INTO public.proctoring_events (session_id, org_id, type, severity, confidence, started_at, ended_at, evidence_path, meta, client_event_id)
    SELECT s.id, s.org_id, src.type, src.severity, src.confidence, src.started_at,
           CASE WHEN src.ended_at >= src.started_at THEN src.ended_at END,
           -- evidence only from this session's own folder
           CASE WHEN left(src.evidence_path, length(v_prefix)) = v_prefix AND position('..' IN src.evidence_path) = 0
                     AND length(src.evidence_path) <= 300 THEN src.evidence_path END,
           CASE WHEN jsonb_typeof(src.meta) = 'object' THEN src.meta ELSE '{}'::jsonb END,
           src.client_event_id
    FROM src
    -- lifecycle events are written by the server only
    WHERE src.type NOT IN ('session_paused', 'auto_submitted') AND src.client_event_id IS NOT NULL
    ON CONFLICT (session_id, client_event_id) WHERE client_event_id IS NOT NULL DO NOTHING
    RETURNING type, severity, started_at
  )
  SELECT count(*),
         count(*) FILTER (WHERE type = ANY (public.b2b_proctor_hard_types())),
         count(*) FILTER (WHERE severity <> 'info'),
         max(started_at) FILTER (WHERE type = ANY (public.b2b_proctor_pause_types())),
         (array_agg(type ORDER BY started_at DESC) FILTER (WHERE type = ANY (public.b2b_proctor_pause_types())))[1],
         max(started_at) FILTER (WHERE type = 'session_resumed')
    INTO v_accepted, v_hard, v_flagged, v_last_pause, v_pause_type, v_last_resume
    FROM ins;

  s.violations := s.violations + v_hard;
  IF v_flagged > 0 THEN v_action := 'warn'; END IF;

  IF s.policy = 'strict' THEN
    t := public.b2b_proctor_target(_actor, s.attempt_id, CASE WHEN s.attempt_id IS NULL THEN s.interview_id END);
    v_max := COALESCE((t->>'strict_max')::integer, 3);
    -- R2.6 ladder: each new serious violation is a numbered warning, the one before the limit a final warning,
    -- and reaching the limit submits the test.
    IF v_hard > 0 AND s.violations < v_max THEN
      v_action := CASE WHEN s.violations = v_max - 1 THEN 'final_warning' ELSE 'warn' END;
    END IF;
    IF s.violations >= v_max THEN
      v_action := 'submit';
      IF NOT EXISTS (SELECT 1 FROM public.proctoring_events WHERE session_id = s.id AND type = 'auto_submitted') THEN
        INSERT INTO public.proctoring_events (session_id, org_id, type, severity, started_at, meta)
          VALUES (s.id, s.org_id, 'auto_submitted', 'info', now(), jsonb_build_object('violations', s.violations));
        PERFORM public.b2b_audit(s.org_id, 'proctor.auto_submit', 'proctoring_session', s.id::text,
                                 jsonb_build_object('violations', s.violations));
      END IF;
    END IF;
  ELSIF s.policy = 'maximum' THEN
    IF v_last_pause IS NOT NULL AND (v_last_resume IS NULL OR v_last_pause > v_last_resume) THEN
      v_action := 'pause';
      IF v_status = 'active' THEN
        v_status := 'paused';
        SELECT count(*) + 1 INTO v_pauses FROM public.proctoring_events WHERE session_id = s.id AND type = 'session_paused';
        -- Repeated pauses are flagged more strongly.
        INSERT INTO public.proctoring_events (session_id, org_id, type, severity, started_at, meta)
          VALUES (s.id, s.org_id, 'session_paused', CASE WHEN v_pauses >= 3 THEN 'high' ELSE 'medium' END, now(),
                  jsonb_build_object('cause', v_pause_type, 'pause_no', v_pauses));
        IF s.attempt_id IS NOT NULL THEN
          t := public.b2b_proctor_target(_actor, s.attempt_id, NULL);
          IF COALESCE((t->>'pause_timer')::boolean, false) THEN
            UPDATE public.attempts SET paused_at = COALESCE(paused_at, now()) WHERE id = s.attempt_id;
          END IF;
        END IF;
      END IF;
    ELSIF v_last_resume IS NOT NULL AND v_status = 'paused' THEN
      v_action := 'resume';
      v_status := 'active';
      IF s.attempt_id IS NOT NULL THEN
        UPDATE public.attempts
          SET paused_ms = paused_ms + GREATEST(0, (extract(epoch FROM now() - paused_at) * 1000)::bigint), paused_at = NULL
          WHERE id = s.attempt_id AND paused_at IS NOT NULL;
      END IF;
    ELSIF v_status = 'paused' THEN
      v_action := 'pause';
    END IF;
  END IF;

  UPDATE public.proctoring_sessions SET violations = s.violations, status = v_status WHERE id = s.id;
  RETURN jsonb_build_object('ok', true, 'accepted', v_accepted, 'violations', s.violations, 'action', v_action, 'max_violations', v_max);
END;
$$;
