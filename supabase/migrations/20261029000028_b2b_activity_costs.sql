-- R1.8 activity costs set by super admins per organisation (organizations.settings, edited through updateOrg):
--  * practice_credits: credits per self-serve practice run (default 0.25; 0 = free). Read by b2b_start_attempt.
--  * candidate_session_credits: credits per company candidate session (already read by _b2b_candidate_cost).
-- No credits are charged for logging in or for TPO-assigned drives (owner decision 2026-10-29). Per-student quotas
-- follow the same decision: one attempt per assigned drive, one practice run per test (migration 0020).
-- b2b_start_attempt is regenerated from 20261029000020 with only the practice charge changed; b2b_my_practice
-- also returns practice_cost so the student home shows the real price in credits.
-- Rollback: restore b2b_start_attempt from 20261029000020_b2b_practice_once.sql; DROP FUNCTION public.b2b_practice_cost(uuid).

CREATE OR REPLACE FUNCTION public.b2b_practice_cost(_org_id UUID)
RETURNS NUMERIC LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT LEAST(GREATEST(COALESCE(NULLIF(public.b2b_org_settings(_org_id)->>'practice_credits', '')::numeric, 0.25), 0), 100)
$$;
REVOKE ALL ON FUNCTION public.b2b_practice_cost(UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.b2b_start_attempt(
  _actor UUID, _context TEXT, _context_id UUID, _assessment_id UUID, _session UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a public.assessments;
  d public.drives;
  jr public.job_roles;
  rc public.role_candidates;
  da public.drive_assignments;
  v_org UUID;
  v_student UUID;
  v_candidate UUID;
  v_attempt public.attempts;
  v_id UUID;
  v_set JSONB;
  v_minutes NUMERIC;
  v_deadline TIMESTAMPTZ;
  v_charge JSONB;
  v_claim JSONB;
  v_org_status TEXT;
BEGIN
  IF _actor IS NULL THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'insufficient_privilege'; END IF;
  PERFORM set_config('b2b.actor', _actor::text, true);

  IF _context = 'practice' THEN
    SELECT * INTO a FROM public.assessments WHERE id = _assessment_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'NOT_FOUND'); END IF;
    v_org := a.org_id;
    SELECT s.student_id INTO v_student FROM public._b2b_subject_ids(_actor, v_org) s;
    IF v_student IS NULL OR COALESCE(public.actor_org_role(_actor, v_org), '') <> 'student'
       OR NOT EXISTS (SELECT 1 FROM public.students WHERE id = v_student AND status = 'active') THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'NOT_ELIGIBLE');
    END IF;
    IF NOT a.practice_enabled OR a.status <> 'ready' THEN RETURN jsonb_build_object('ok', false, 'reason', 'NOT_AVAILABLE'); END IF;
    -- One practice run per student per test (owner decision 2026-10-29): resume it, never start a second one.
    -- The lock makes a double click or two tabs start at most one.
    PERFORM pg_advisory_xact_lock(hashtextextended('b2b_practice:' || _actor::text || ':' || a.id::text, 0));
    SELECT * INTO v_attempt FROM public.attempts
      WHERE subject_user_id = _actor AND context_type = 'practice' AND assessment_id = a.id AND status IN ('not_started', 'in_progress')
      ORDER BY created_at DESC LIMIT 1;
    IF v_attempt.id IS NULL AND EXISTS (
      SELECT 1 FROM public.attempts WHERE subject_user_id = _actor AND context_type = 'practice' AND assessment_id = a.id
    ) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'PRACTICE_USED');
    END IF;
  ELSIF _context = 'drive' THEN
    SELECT * INTO d FROM public.drives WHERE id = _context_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'NOT_FOUND'); END IF;
    v_org := d.org_id;
    SELECT s.student_id INTO v_student FROM public._b2b_subject_ids(_actor, v_org) s;
    SELECT * INTO da FROM public.drive_assignments WHERE drive_id = d.id AND student_id = v_student;
    IF v_student IS NULL OR NOT FOUND OR da.status IN ('removed', 'absent') THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'NOT_ELIGIBLE');
    END IF;
    SELECT * INTO v_attempt FROM public.attempts
      WHERE subject_user_id = _actor AND context_type = 'drive' AND context_id = d.id;
    IF v_attempt.id IS NULL THEN
      IF d.assessment_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'NO_ASSESSMENT'); END IF;
      IF d.status NOT IN ('scheduled', 'live') THEN RETURN jsonb_build_object('ok', false, 'reason', 'NOT_OPEN'); END IF;
      IF d.window_start IS NOT NULL AND now() < d.window_start THEN RETURN jsonb_build_object('ok', false, 'reason', 'NOT_OPEN_YET'); END IF;
      IF d.window_end IS NOT NULL AND now() >= d.window_end THEN RETURN jsonb_build_object('ok', false, 'reason', 'WINDOW_CLOSED'); END IF;
    END IF;
    SELECT * INTO a FROM public.assessments WHERE id = COALESCE(v_attempt.assessment_id, d.assessment_id);
    IF v_attempt.id IS NULL AND a.late_join_min IS NOT NULL AND d.window_start IS NOT NULL
       AND now() > d.window_start + make_interval(mins => a.late_join_min) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'TOO_LATE');
    END IF;
  ELSIF _context = 'job_role' THEN
    SELECT * INTO jr FROM public.job_roles WHERE id = _context_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'NOT_FOUND'); END IF;
    v_org := jr.org_id;
    SELECT s.candidate_id INTO v_candidate FROM public._b2b_subject_ids(_actor, v_org) s;
    SELECT * INTO rc FROM public.role_candidates WHERE job_role_id = jr.id AND candidate_id = v_candidate;
    IF v_candidate IS NULL OR NOT FOUND OR rc.stage IN ('rejected', 'withdrawn') THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'NOT_ELIGIBLE');
    END IF;
    SELECT * INTO v_attempt FROM public.attempts
      WHERE subject_user_id = _actor AND context_type = 'job_role' AND context_id = jr.id;
    IF v_attempt.id IS NULL THEN
      IF jr.assessment_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'NO_ASSESSMENT'); END IF;
      IF jr.status <> 'open' THEN RETURN jsonb_build_object('ok', false, 'reason', 'NOT_OPEN'); END IF;
      IF rc.invite_expires_at IS NOT NULL AND rc.invite_expires_at <= now() THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'INVITE_EXPIRED');
      END IF;
    END IF;
    SELECT * INTO a FROM public.assessments WHERE id = COALESCE(v_attempt.assessment_id, jr.assessment_id);
  ELSE
    RETURN jsonb_build_object('ok', false, 'reason', 'BAD_CONTEXT');
  END IF;

  SELECT status INTO v_org_status FROM public.organizations WHERE id = v_org;
  IF v_attempt.id IS NULL AND v_org_status <> 'active' THEN RETURN jsonb_build_object('ok', false, 'reason', 'ORG_SUSPENDED'); END IF;

  -- Resume.
  IF v_attempt.id IS NOT NULL THEN
    PERFORM public._b2b_expire_if_due(v_attempt.id);
    v_claim := public._b2b_claim_session(v_attempt.id, _session);
    IF NOT (v_claim->>'ok')::boolean THEN RETURN v_claim || jsonb_build_object('attempt_id', v_attempt.id); END IF;
    RETURN jsonb_build_object('ok', true, 'attempt_id', v_attempt.id, 'session_id', v_claim->>'session_id', 'resumed', true);
  END IF;

  -- New attempt.
  v_id := gen_random_uuid();
  v_set := public._b2b_build_question_set(a.id, v_id::text);
  IF jsonb_array_length(v_set) = 0 THEN RETURN jsonb_build_object('ok', false, 'reason', 'NO_QUESTIONS'); END IF;

  IF _context = 'practice' THEN
    -- R1.8: the per-org practice cost (settings.practice_credits, default 0.25); 0 means practice is free.
    IF public.b2b_practice_cost(v_org) > 0 THEN
      v_charge := public.b2b_consume_credits(v_org, public.b2b_practice_cost(v_org), 'practice_coding', 'attempt', v_id::text, _actor);
      IF NOT (v_charge->>'ok')::boolean THEN RETURN jsonb_build_object('ok', false, 'reason', v_charge->>'reason'); END IF;
    END IF;
  END IF;

  v_minutes := a.duration_min * (1 + COALESCE((da.accommodations->>'extra_time_pct')::numeric, 0) / 100.0);
  v_deadline := now() + make_interval(secs => (v_minutes * 60)::double precision);
  IF _context = 'drive' AND d.window_end IS NOT NULL AND d.window_end < v_deadline THEN v_deadline := d.window_end; END IF;

  INSERT INTO public.attempts (id, org_id, assessment_id, subject_user_id, student_id, candidate_id, context_type, context_id,
                               status, started_at, deadline_at, question_set, active_session_id, active_session_seen_at,
                               accommodations)
  VALUES (v_id, v_org, a.id, _actor, v_student, v_candidate, _context, CASE WHEN _context = 'practice' THEN NULL ELSE _context_id END,
          'in_progress', now(), v_deadline, v_set, COALESCE(_session, gen_random_uuid()), now(),
          COALESCE(da.accommodations, '{}'::jsonb))
  RETURNING * INTO v_attempt;

  IF _context = 'drive' THEN
    UPDATE public.drive_assignments SET attempt_id = v_id, status = 'in_progress' WHERE id = da.id;
  ELSIF _context = 'job_role' THEN
    UPDATE public.role_candidates SET attempt_id = v_id, started_at = COALESCE(started_at, now()),
      stage = CASE WHEN stage = 'invited' THEN 'in_progress' ELSE stage END WHERE id = rc.id;
  END IF;
  RETURN jsonb_build_object('ok', true, 'attempt_id', v_id, 'session_id', v_attempt.active_session_id, 'resumed', false);
END;
$$;

CREATE OR REPLACE FUNCTION public.b2b_my_practice()
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'org_id', o.id, 'org_name', o.name, 'credits_balance', o.credits_balance, 'practice_cost', public.b2b_practice_cost(o.id),
      'assessments', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', x.id, 'title', x.title, 'duration_min', x.duration_min,
                                  'state', CASE
                                    WHEN EXISTS (SELECT 1 FROM public.attempts t WHERE t.subject_user_id = auth.uid() AND t.context_type = 'practice'
                                                   AND t.assessment_id = x.id AND t.status IN ('not_started', 'in_progress')) THEN 'in_progress'
                                    WHEN EXISTS (SELECT 1 FROM public.attempts t WHERE t.subject_user_id = auth.uid() AND t.context_type = 'practice'
                                                   AND t.assessment_id = x.id) THEN 'done'
                                    ELSE 'available' END)
                                ORDER BY x.title)
                               FROM public.assessments x
                               WHERE x.org_id = o.id AND x.practice_enabled AND x.status = 'ready'), '[]'::jsonb)
    ) ORDER BY o.name), '[]'::jsonb)
  FROM public.students s JOIN public.organizations o ON o.id = s.org_id
  WHERE s.user_id = auth.uid() AND s.status = 'active' AND o.status = 'active'
$$;
