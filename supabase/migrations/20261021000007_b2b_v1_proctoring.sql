-- Track B — proctoring V1 (proposed migration; applies after 20261021000005).
-- Write paths for proctoring_sessions / proctoring_events / integrity_reviews, called by the b2b-proctor edge
-- function with the service role. Every function takes the acting user (_actor), re-checks it inside, and
-- records it for the audit triggers. Reads by staff keep using the RLS policies from 20261021000004.
--
--   1. helpers: hard / pause signal lists, actor-based context visibility, target resolution
--   2. subject: preflight, start (with itemised consent), batched idempotent events (+ policy actions), end
--   3. staff: timeline, review one event, final human decision
--   4. storage: private bucket b2b-evidence with org-scoped paths (guarded: only where the storage schema exists)
--
-- Flags are evidence for human review. The integrity score is computed by the edge function
-- (_shared/contracts/proctor-rules.ts) and stored with an explanation; the human decision is separate.

-- =============================================
-- 1. Helpers
-- =============================================
-- Kept in sync with HARD_TYPES / PAUSE_TYPES in supabase/functions/_shared/contracts/proctor-rules.ts (a test checks).
CREATE OR REPLACE FUNCTION public.b2b_proctor_hard_types()
RETURNS TEXT[] LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT ARRAY['tab_hidden', 'fullscreen_exit', 'screen_share_stopped', 'extra_display', 'camera_off', 'second_session']
$$;

CREATE OR REPLACE FUNCTION public.b2b_proctor_pause_types()
RETURNS TEXT[] LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT ARRAY['screen_share_stopped', 'camera_off', 'extra_display', 'fullscreen_exit']
$$;

-- b2b_can_view_context for service-role callers (actor passed explicitly instead of auth.uid()).
CREATE OR REPLACE FUNCTION public.b2b_actor_can_view_context(_actor UUID, _org_id UUID, _context_type TEXT, _context_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT _actor IS NOT NULL AND (public.actor_is_super_admin(_actor) OR CASE
    WHEN _context_type = 'job_role' THEN EXISTS (
      SELECT 1 FROM public.job_roles r
      WHERE r.id = _context_id AND r.org_id = _org_id
        AND (COALESCE(public.actor_org_role(_actor, r.org_id) IN ('org_admin', 'recruiter'), false)
             OR (COALESCE(public.actor_org_role(_actor, r.org_id) = 'hiring_manager', false) AND _actor = ANY (r.hiring_manager_ids))))
    ELSE COALESCE(public.actor_org_role(_actor, _org_id) IN ('org_admin', 'trainer', 'recruiter'), false)
  END)
$$;

-- What is being proctored, for its subject: org, context, effective policy, strict limit.
-- { ok, reason?, org_id, context_type, context_id, policy, strict_max, pause_timer }
CREATE OR REPLACE FUNCTION public.b2b_proctor_target(_actor UUID, _attempt_id UUID, _interview_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a public.attempts;
  i public.b2b_interviews;
  v_policy TEXT;
  v_ctx TEXT;
  v_strict INTEGER := 3;
  v_pause_timer BOOLEAN := false;
BEGIN
  IF _actor IS NULL OR (_attempt_id IS NULL) = (_interview_id IS NULL) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'BAD_TARGET');
  END IF;
  IF _attempt_id IS NOT NULL THEN
    SELECT * INTO a FROM public.attempts WHERE id = _attempt_id;
    IF NOT FOUND OR a.subject_user_id <> _actor THEN RETURN jsonb_build_object('ok', false, 'reason', 'NOT_FOUND'); END IF;
    IF a.status NOT IN ('not_started', 'in_progress') THEN RETURN jsonb_build_object('ok', false, 'reason', 'CLOSED'); END IF;
    SELECT s.strict_max_violations, s.pause_timer_on_violation,
           CASE a.context_type
             WHEN 'drive' THEN (SELECT d.proctoring_policy FROM public.drives d WHERE d.id = a.context_id)
             WHEN 'job_role' THEN (SELECT r.proctoring_policy FROM public.job_roles r WHERE r.id = a.context_id)
             ELSE s.proctoring_policy END
      INTO v_strict, v_pause_timer, v_policy
      FROM public.assessments s WHERE s.id = a.assessment_id;
    RETURN jsonb_build_object('ok', true, 'org_id', a.org_id, 'context_type', a.context_type, 'context_id', a.context_id,
                              'policy', COALESCE(v_policy, 'standard'), 'strict_max', COALESCE(v_strict, 3),
                              'pause_timer', COALESCE(v_pause_timer, false));
  END IF;

  SELECT * INTO i FROM public.b2b_interviews WHERE id = _interview_id;
  IF NOT FOUND OR i.user_id <> _actor THEN RETURN jsonb_build_object('ok', false, 'reason', 'NOT_FOUND'); END IF;
  IF i.status::text <> 'in_progress' THEN RETURN jsonb_build_object('ok', false, 'reason', 'CLOSED'); END IF;
  v_ctx := CASE WHEN i.kind IN ('drive', 'job_role') THEN i.kind ELSE 'practice' END;
  v_policy := CASE v_ctx
    WHEN 'drive' THEN (SELECT d.proctoring_policy FROM public.drives d WHERE d.id = i.context_id)
    WHEN 'job_role' THEN (SELECT r.proctoring_policy FROM public.job_roles r WHERE r.id = i.context_id)
    ELSE public.b2b_org_settings(i.org_id)->>'proctoring_default' END;
  RETURN jsonb_build_object('ok', true, 'org_id', i.org_id, 'context_type', v_ctx, 'context_id', i.context_id,
                            'policy', COALESCE(v_policy, 'standard'), 'strict_max', v_strict, 'pause_timer', false);
END;
$$;

-- =============================================
-- 2. Subject (student / candidate) paths
-- =============================================
-- Before the system check: effective policy + what the consent screen must say.
CREATE OR REPLACE FUNCTION public.b2b_proctor_preflight(_actor UUID, _attempt_id UUID, _interview_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  t JSONB := public.b2b_proctor_target(_actor, _attempt_id, _interview_id);
  o public.organizations;
  st JSONB;
BEGIN
  IF NOT (t->>'ok')::boolean THEN RETURN t; END IF;
  SELECT * INTO o FROM public.organizations WHERE id = (t->>'org_id')::uuid;
  st := public.b2b_org_settings(o.id);
  RETURN jsonb_build_object('ok', true, 'policy', t->>'policy', 'org_name', o.name,
    'retention_days', COALESCE((st->>'retention_days')::integer, 90), 'contact_email', o.contact_email,
    'strict_max', (t->>'strict_max')::integer, 'snapshot_interval_s', COALESCE((st->>'snapshot_interval_s')::integer, 30));
END;
$$;

-- Start (or resume after a reload) the proctoring session. Records the itemised consent shown to the subject
-- (_consents: [{ purpose, version, text }]) and refuses to start without every required purpose.
CREATE OR REPLACE FUNCTION public.b2b_proctor_start(
  _actor UUID, _attempt_id UUID, _interview_id UUID, _kind TEXT, _system_check JSONB, _consents JSONB
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  t JSONB := public.b2b_proctor_target(_actor, _attempt_id, _interview_id);
  v_org UUID;
  v_required TEXT[];
  v_purpose TEXT;
  c JSONB;
  s public.proctoring_sessions;
  v_resumed BOOLEAN := false;
BEGIN
  IF NOT (t->>'ok')::boolean THEN RETURN t; END IF;
  IF t->>'policy' = 'off' THEN RETURN jsonb_build_object('ok', false, 'reason', 'POLICY_OFF'); END IF;
  v_org := (t->>'org_id')::uuid;
  PERFORM set_config('b2b.actor', _actor::text, true);

  -- The server re-checks what the client's system check claims (and stores it for the reviewer).
  IF _system_check IS NULL
     OR NOT COALESCE((_system_check->>'chromium')::boolean, false)
     OR COALESCE((_system_check->>'mobile')::boolean, true)
     OR COALESCE(_system_check->>'screen', 'none') <> 'monitor'
     OR COALESCE((_system_check->>'displays')::integer, 1) > 1
     OR NOT COALESCE((_system_check->>'camera')::boolean, false) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'SYSTEM_CHECK_FAILED');
  END IF;

  FOR c IN SELECT * FROM jsonb_array_elements(COALESCE(_consents, '[]'::jsonb)) LOOP
    IF c->>'purpose' IN ('assessment', 'proctoring_screen', 'proctoring_camera', 'proctoring_audio') THEN
      PERFORM public.b2b_record_consent(v_org, _actor, c->>'purpose', c->>'version', c->>'text');
    END IF;
  END LOOP;
  v_required := ARRAY['proctoring_screen', 'proctoring_camera']
    || CASE WHEN _attempt_id IS NOT NULL THEN ARRAY['assessment'] ELSE ARRAY[]::text[] END
    || CASE WHEN COALESCE(_kind, 'assessment') = 'assessment' THEN ARRAY['proctoring_audio'] ELSE ARRAY[]::text[] END;
  FOREACH v_purpose IN ARRAY v_required LOOP
    IF NOT public.b2b_has_consent(v_org, _actor, v_purpose) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'CONSENT_REQUIRED', 'purpose', v_purpose);
    END IF;
  END LOOP;

  SELECT * INTO s FROM public.proctoring_sessions
    WHERE subject_user_id = _actor AND status <> 'ended'
      AND ((_attempt_id IS NOT NULL AND attempt_id = _attempt_id) OR (_interview_id IS NOT NULL AND interview_id = _interview_id))
    ORDER BY started_at DESC LIMIT 1 FOR UPDATE;
  IF FOUND THEN
    -- Resume (reload / reconnect): the client has just re-done screen share and full screen.
    v_resumed := true;
    IF s.status = 'paused' THEN
      INSERT INTO public.proctoring_events (session_id, org_id, type, severity, started_at, meta)
        VALUES (s.id, s.org_id, 'session_resumed', 'info', now(), '{"by":"restart"}');
    END IF;
    UPDATE public.proctoring_sessions SET status = 'active', system_check = _system_check WHERE id = s.id RETURNING * INTO s;
  ELSE
    INSERT INTO public.proctoring_sessions (org_id, subject_user_id, context_type, context_id, attempt_id, interview_id, policy, system_check)
      VALUES (v_org, _actor, t->>'context_type', (t->>'context_id')::uuid, _attempt_id, _interview_id, t->>'policy', _system_check)
      RETURNING * INTO s;
    PERFORM public.b2b_audit(v_org, 'proctor.start', 'proctoring_session', s.id::text,
                             jsonb_build_object('policy', s.policy, 'tier', _system_check->>'tier'));
  END IF;
  RETURN jsonb_build_object('ok', true, 'session_id', s.id, 'org_id', s.org_id, 'policy', s.policy, 'status', s.status,
    'resumed', v_resumed, 'strict_max', (t->>'strict_max')::integer,
    'snapshot_interval_s', COALESCE((public.b2b_org_settings(v_org)->>'snapshot_interval_s')::integer, 30));
END;
$$;

-- The subject's own live session (for snapshot upload URLs and end). { ok, org_id, status, policy, ... }
CREATE OR REPLACE FUNCTION public.b2b_proctor_subject_session(_actor UUID, _session_id UUID)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(
    (SELECT jsonb_build_object('ok', true, 'org_id', s.org_id, 'status', s.status, 'policy', s.policy,
                               'integrity_score', s.integrity_score, 'integrity_band', s.integrity_band)
       FROM public.proctoring_sessions s WHERE s.id = _session_id AND s.subject_user_id = _actor AND _actor IS NOT NULL),
    jsonb_build_object('ok', false, 'reason', 'NOT_FOUND'))
$$;

-- Batched, idempotent event insert (by client_event_id) + the policy decision.
-- _events: [{ clientEventId, type, severity, confidence, startedAt, endedAt?, evidencePath?, meta? }] (validated by the contract).
-- Returns { ok, accepted, violations, action: none | warn | pause | resume | submit }.
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
    IF s.violations >= COALESCE((t->>'strict_max')::integer, 3) THEN
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
  RETURN jsonb_build_object('ok', true, 'accepted', v_accepted, 'violations', s.violations, 'action', v_action);
END;
$$;

-- End the session and store the AI integrity score (computed by the edge function from the events, with
-- its explanation). Idempotent: a second end returns the stored score.
CREATE OR REPLACE FUNCTION public.b2b_proctor_end(_actor UUID, _session_id UUID, _score NUMERIC, _band TEXT, _detail JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE s public.proctoring_sessions;
BEGIN
  SELECT * INTO s FROM public.proctoring_sessions WHERE id = _session_id FOR UPDATE;
  IF NOT FOUND OR _actor IS NULL OR s.subject_user_id <> _actor THEN RETURN jsonb_build_object('ok', false, 'reason', 'NOT_FOUND'); END IF;
  IF s.status = 'ended' AND s.integrity_score IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'integrity_score', s.integrity_score, 'integrity_band', s.integrity_band);
  END IF;
  PERFORM set_config('b2b.actor', _actor::text, true);
  UPDATE public.proctoring_sessions
    SET status = 'ended', ended_at = COALESCE(ended_at, now()),
        integrity_score = LEAST(100, GREATEST(0, _score)), integrity_band = _band, score_detail = _detail
    WHERE id = s.id RETURNING * INTO s;
  IF s.attempt_id IS NOT NULL THEN
    UPDATE public.attempts
      SET paused_ms = paused_ms + GREATEST(0, (extract(epoch FROM now() - paused_at) * 1000)::bigint), paused_at = NULL
      WHERE id = s.attempt_id AND paused_at IS NOT NULL;
  END IF;
  RETURN jsonb_build_object('ok', true, 'integrity_score', s.integrity_score, 'integrity_band', s.integrity_band);
END;
$$;

-- =============================================
-- 3. Staff review
-- =============================================
-- Everything the review page needs, if the actor may view the session's context; else { ok: false }.
CREATE OR REPLACE FUNCTION public.b2b_proctor_timeline(_actor UUID, _session_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  s public.proctoring_sessions;
  v_name TEXT;
BEGIN
  SELECT * INTO s FROM public.proctoring_sessions WHERE id = _session_id;
  IF NOT FOUND OR NOT public.b2b_actor_can_view_context(_actor, s.org_id, s.context_type, s.context_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NOT_FOUND');
  END IF;
  SELECT COALESCE(st.full_name, c.full_name) INTO v_name
    FROM (SELECT 1) one
    LEFT JOIN public.attempts a ON a.id = s.attempt_id
    LEFT JOIN public.b2b_interviews i ON i.id = s.interview_id
    LEFT JOIN public.students st ON st.id = COALESCE(a.student_id, i.student_id)
    LEFT JOIN public.candidates c ON c.id = COALESCE(a.candidate_id, i.candidate_id);
  RETURN jsonb_build_object(
    'ok', true,
    'session', jsonb_build_object('id', s.id, 'org_id', s.org_id, 'policy', s.policy, 'status', s.status, 'violations', s.violations,
      'context_type', s.context_type, 'integrity_score', s.integrity_score, 'integrity_band', s.integrity_band,
      'score_detail', s.score_detail, 'started_at', s.started_at, 'ended_at', s.ended_at, 'subject_name', v_name,
      'system_check', s.system_check),
    'events', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', e.id, 'type', e.type, 'severity', e.severity,
        'confidence', e.confidence, 'started_at', e.started_at, 'ended_at', e.ended_at, 'evidence_path', e.evidence_path,
        'review_status', e.review_status, 'review_note', e.review_note, 'meta', e.meta) ORDER BY e.started_at, e.id)
      FROM public.proctoring_events e WHERE e.session_id = s.id), '[]'::jsonb),
    'reviews', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'decision', r.decision, 'note', r.note,
        'reviewer_name', u.email, 'created_at', r.created_at) ORDER BY r.created_at DESC)
      FROM public.integrity_reviews r LEFT JOIN auth.users u ON u.id = r.reviewer_id WHERE r.session_id = s.id), '[]'::jsonb)
  );
END;
$$;

-- Mark one flag confirmed / dismissed with a note.
CREATE OR REPLACE FUNCTION public.b2b_proctor_review_event(_actor UUID, _event_id BIGINT, _status TEXT, _note TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  e public.proctoring_events;
  s public.proctoring_sessions;
BEGIN
  IF _status NOT IN ('confirmed', 'dismissed') THEN RETURN jsonb_build_object('ok', false, 'reason', 'BAD_STATUS'); END IF;
  SELECT * INTO e FROM public.proctoring_events WHERE id = _event_id;
  IF FOUND THEN SELECT * INTO s FROM public.proctoring_sessions WHERE id = e.session_id; END IF;
  IF e.id IS NULL OR NOT public.b2b_actor_can_view_context(_actor, s.org_id, s.context_type, s.context_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NOT_FOUND');
  END IF;
  PERFORM set_config('b2b.actor', _actor::text, true);
  UPDATE public.proctoring_events
    SET review_status = _status, reviewed_by = _actor, reviewed_at = now(), review_note = NULLIF(btrim(_note), '')
    WHERE id = e.id;
  PERFORM public.b2b_audit(s.org_id, 'proctor.review_event', 'proctoring_event', e.id::text,
                           jsonb_build_object('status', _status, 'type', e.type));
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- The final human decision (separate from the AI score). Each call adds a row; the newest one counts.
CREATE OR REPLACE FUNCTION public.b2b_proctor_decide(_actor UUID, _session_id UUID, _decision TEXT, _note TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE s public.proctoring_sessions;
BEGIN
  SELECT * INTO s FROM public.proctoring_sessions WHERE id = _session_id;
  IF NOT FOUND OR NOT public.b2b_actor_can_view_context(_actor, s.org_id, s.context_type, s.context_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NOT_FOUND');
  END IF;
  IF _decision NOT IN ('no_concern', 'minor_concern', 'serious_concern') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'BAD_DECISION');
  END IF;
  PERFORM set_config('b2b.actor', _actor::text, true);
  INSERT INTO public.integrity_reviews (session_id, org_id, reviewer_id, decision, note)
    VALUES (s.id, s.org_id, _actor, _decision, NULLIF(btrim(_note), ''));
  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION
  public.b2b_actor_can_view_context(UUID, UUID, TEXT, UUID), public.b2b_proctor_target(UUID, UUID, UUID),
  public.b2b_proctor_preflight(UUID, UUID, UUID), public.b2b_proctor_start(UUID, UUID, UUID, TEXT, JSONB, JSONB),
  public.b2b_proctor_subject_session(UUID, UUID), public.b2b_proctor_log_events(UUID, UUID, JSONB),
  public.b2b_proctor_end(UUID, UUID, NUMERIC, TEXT, JSONB), public.b2b_proctor_timeline(UUID, UUID),
  public.b2b_proctor_review_event(UUID, BIGINT, TEXT, TEXT), public.b2b_proctor_decide(UUID, UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.b2b_actor_can_view_context(UUID, UUID, TEXT, UUID), public.b2b_proctor_target(UUID, UUID, UUID),
  public.b2b_proctor_preflight(UUID, UUID, UUID), public.b2b_proctor_start(UUID, UUID, UUID, TEXT, JSONB, JSONB),
  public.b2b_proctor_subject_session(UUID, UUID), public.b2b_proctor_log_events(UUID, UUID, JSONB),
  public.b2b_proctor_end(UUID, UUID, NUMERIC, TEXT, JSONB), public.b2b_proctor_timeline(UUID, UUID),
  public.b2b_proctor_review_event(UUID, BIGINT, TEXT, TEXT), public.b2b_proctor_decide(UUID, UUID, TEXT, TEXT)
  TO service_role;

-- =============================================
-- 4. Storage: private evidence bucket (snapshots), org-scoped paths
--    org/{org_id}/sessions/{session_id}/{screen|camera}-{ts}-{rand}.{jpg|webp}
-- Uploads normally go through signed upload URLs minted by b2b-proctor (service role); these policies are the
-- direct-access rules: staff who may view the session's context read; the subject uploads only into their own
-- live session's folder. Nobody updates or deletes from the browser (the retention job uses the service role).
-- Guarded so the embedded test database (no storage schema) can apply this file.
-- =============================================
DO $storage$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'storage') THEN
    EXECUTE $q$
      INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      VALUES ('b2b-evidence', 'b2b-evidence', false, 2097152, ARRAY['image/jpeg', 'image/webp'])
      ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit,
                                     allowed_mime_types = EXCLUDED.allowed_mime_types
    $q$;
    EXECUTE $q$
      CREATE POLICY "B2B evidence: staff read" ON storage.objects FOR SELECT TO authenticated USING (
        bucket_id = 'b2b-evidence'
        AND (storage.foldername(name))[1] = 'org' AND (storage.foldername(name))[3] = 'sessions'
        AND EXISTS (
          SELECT 1 FROM public.proctoring_sessions s
          WHERE s.id::text = (storage.foldername(name))[4] AND s.org_id::text = (storage.foldername(name))[2]
            AND public.b2b_can_view_context(s.org_id, s.context_type, s.context_id)))
    $q$;
    EXECUTE $q$
      CREATE POLICY "B2B evidence: subject uploads to own live session" ON storage.objects FOR INSERT TO authenticated WITH CHECK (
        bucket_id = 'b2b-evidence'
        AND (storage.foldername(name))[1] = 'org' AND (storage.foldername(name))[3] = 'sessions'
        AND array_length(storage.foldername(name), 1) = 4
        AND EXISTS (
          SELECT 1 FROM public.proctoring_sessions s
          WHERE s.id::text = (storage.foldername(name))[4] AND s.org_id::text = (storage.foldername(name))[2]
            AND s.subject_user_id = auth.uid() AND s.status <> 'ended'))
    $q$;
  END IF;
END
$storage$;
