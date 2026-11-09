-- R2.4 one question at a time. A test can be set to 'linear' navigation: the student sees only the current
-- question, answers it, and moves on; earlier questions can't be reopened or changed, later ones aren't sent to the
-- browser until reached. Enforced here (the runner guard), not in the browser.

ALTER TABLE public.assessments ADD COLUMN navigation TEXT NOT NULL DEFAULT 'free' CHECK (navigation IN ('free', 'linear'));
ALTER TABLE public.attempts ADD COLUMN current_index INTEGER NOT NULL DEFAULT 0 CHECK (current_index >= 0);

/** Whether the attempt's test is answered one question at a time. */
CREATE OR REPLACE FUNCTION public._b2b_attempt_linear(a public.attempts)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE((SELECT asm.navigation = 'linear' FROM public.assessments asm WHERE asm.id = a.assessment_id), false)
$$;

-- Regenerated from 20261021000006: refuses questions other than the current one in linear mode.
CREATE OR REPLACE FUNCTION public._b2b_runner_guard(_actor UUID, _attempt_id UUID, _session UUID, _question UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE a public.attempts;
BEGIN
  a := public._b2b_subject_attempt(_actor, _attempt_id);
  PERFORM public._b2b_expire_if_due(a.id);
  SELECT * INTO a FROM public.attempts WHERE id = _attempt_id;
  IF a.status <> 'in_progress' THEN RETURN jsonb_build_object('ok', false, 'reason', 'ENDED'); END IF;
  IF a.active_session_id IS DISTINCT FROM _session THEN RETURN jsonb_build_object('ok', false, 'reason', 'OTHER_SESSION'); END IF;
  IF now() > a.deadline_at + public._b2b_deadline_grace() THEN RETURN jsonb_build_object('ok', false, 'reason', 'DEADLINE_PASSED'); END IF;
  IF a.paused_at IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'PAUSED'); END IF;
  IF _question IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(a.question_set) e WHERE e->>'question_id' = _question::text
  ) THEN RETURN jsonb_build_object('ok', false, 'reason', 'NOT_IN_ATTEMPT'); END IF;
  -- R2.4: one question at a time. Only the current question can be saved, run or submitted.
  IF _question IS NOT NULL AND public._b2b_attempt_linear(a) AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(a.question_set) WITH ORDINALITY AS e(v, ord)
    WHERE e.v->>'question_id' = _question::text AND e.ord - 1 = a.current_index
  ) THEN RETURN jsonb_build_object('ok', false, 'reason', 'LOCKED'); END IF;
  UPDATE public.attempts SET active_session_seen_at = now() WHERE id = a.id;
  RETURN jsonb_build_object('ok', true, 'org_id', a.org_id, 'deadline_at', a.deadline_at, 'started_at', a.started_at);
END;
$$;

-- Regenerated from 20261021000006: linear mode sends only the current question, plus the position.
CREATE OR REPLACE FUNCTION public.b2b_attempt_state(_actor UUID, _attempt_id UUID, _session UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a public.attempts;
  asm public.assessments;
  v_claim JSONB;
  v_questions JSONB := '[]'::jsonb;
  v_result JSONB;
  v_watermark TEXT;
BEGIN
  a := public._b2b_subject_attempt(_actor, _attempt_id);
  PERFORM public._b2b_expire_if_due(a.id);
  v_claim := public._b2b_claim_session(a.id, _session);
  IF NOT (v_claim->>'ok')::boolean THEN RETURN v_claim; END IF;
  SELECT * INTO a FROM public.attempts WHERE id = _attempt_id;
  SELECT * INTO asm FROM public.assessments WHERE id = a.assessment_id;

  IF a.status = 'in_progress' THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', q.id, 'type', q.type, 'title', q.title, 'statement', q.statement, 'difficulty', q.difficulty,
      'points', q.points, 'section', COALESCE(asm.sections->((qs.e->>'section')::integer)->>'title', ''),
      'languages', CASE WHEN q.type = 'coding' THEN to_jsonb(ARRAY(SELECT l FROM unnest(q.languages) l WHERE l = ANY (asm.languages))) END,
      'starter_code', CASE WHEN q.type = 'coding' THEN q.starter_code END,
      'constraints', q.constraints,
      'samples', CASE WHEN q.type = 'coding' THEN COALESCE((
          SELECT jsonb_agg(jsonb_build_object('input', t.input, 'output', t.expected_output) ORDER BY t.ordinal)
          FROM public.test_cases t WHERE t.question_id = q.id AND t.is_sample), '[]'::jsonb) END,
      'options', CASE WHEN q.type = 'mcq' THEN (
          SELECT jsonb_agg(jsonb_build_object('id', o->>'id', 'text', o->>'text') ORDER BY oo.ord)
          FROM jsonb_array_elements_text(qs.e->'option_order') WITH ORDINALITY AS oo(opt_id, ord)
          JOIN LATERAL (SELECT x AS o FROM jsonb_array_elements(q.options) x WHERE x->>'id' = oo.opt_id) j ON true) END,
      'multi_select', CASE WHEN q.type = 'mcq' THEN q.multi_select END,
      'saved', (SELECT jsonb_build_object('language', aa.language, 'code', aa.code, 'mcq_choice', aa.mcq_choice, 'seq', aa.seq)
                FROM public.attempt_answers aa WHERE aa.attempt_id = a.id AND aa.question_id = q.id)
    ) ORDER BY qs.ord), '[]'::jsonb) INTO v_questions
    FROM jsonb_array_elements(a.question_set) WITH ORDINALITY AS qs(e, ord)
    JOIN public.questions q ON q.id = (qs.e->>'question_id')::uuid
    -- R2.4: one question at a time sends only the current question (later ones stay on the server).
    WHERE NOT public._b2b_attempt_linear(a) OR qs.ord - 1 = a.current_index;
  END IF;

  IF a.status IN ('submitted', 'expired', 'terminated') AND public.b2b_results_visible(a.context_type, a.context_id) THEN
    v_result := jsonb_build_object('score', a.score, 'max_score', a.max_score, 'section_scores', a.section_scores,
                                   'grading', COALESCE(a.grading_status, 'pending'));
  END IF;

  v_watermark := COALESCE((SELECT email FROM public.students WHERE id = a.student_id),
                          (SELECT email FROM public.candidates WHERE id = a.candidate_id),
                          (SELECT email FROM auth.users WHERE id = a.subject_user_id), a.subject_user_id::text);

  RETURN jsonb_build_object('ok', true, 'attempt_id', a.id, 'status', a.status, 'title', asm.title,
    'deadline_at', a.deadline_at, 'server_now', now(), 'paused', a.paused_at IS NOT NULL,
    'session_id', v_claim->>'session_id', 'questions', v_questions, 'result', v_result, 'watermark', v_watermark,
    'policy', public._b2b_attempt_policy(a),
    'navigation', jsonb_build_object('mode', CASE WHEN public._b2b_attempt_linear(a) THEN 'linear' ELSE 'free' END,
                                     'index', a.current_index, 'total', jsonb_array_length(a.question_set)),
    'proctoring_session_id', (SELECT ps.id FROM public.proctoring_sessions ps WHERE ps.attempt_id = a.id
                              ORDER BY ps.started_at DESC LIMIT 1));
END;
$$;

-- Linear mode: leave question _from_index for the next one. Idempotent: a repeated call for a question already
-- left (a retry after a dropped response) returns the current position without moving again.
CREATE OR REPLACE FUNCTION public.b2b_advance_question(_actor UUID, _attempt_id UUID, _session UUID, _from_index INTEGER)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE g JSONB; a public.attempts; v_total INTEGER;
BEGIN
  g := public._b2b_runner_guard(_actor, _attempt_id, _session, NULL);
  IF NOT (g->>'ok')::boolean THEN RETURN g; END IF;
  SELECT * INTO a FROM public.attempts WHERE id = _attempt_id FOR UPDATE;
  IF NOT public._b2b_attempt_linear(a) THEN RETURN jsonb_build_object('ok', false, 'reason', 'NOT_LINEAR'); END IF;
  v_total := jsonb_array_length(a.question_set);
  IF _from_index = a.current_index AND a.current_index < v_total - 1 THEN
    UPDATE public.attempts SET current_index = current_index + 1, updated_at = now() WHERE id = a.id
      RETURNING current_index INTO a.current_index;
  ELSIF _from_index IS DISTINCT FROM a.current_index AND _from_index IS DISTINCT FROM a.current_index - 1 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'LOCKED');
  END IF;
  RETURN jsonb_build_object('ok', true, 'index', a.current_index, 'total', v_total);
END;
$$;

REVOKE ALL ON FUNCTION public.b2b_advance_question(UUID, UUID, UUID, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.b2b_advance_question(UUID, UUID, UUID, INTEGER) TO service_role;
REVOKE ALL ON FUNCTION public._b2b_attempt_linear(public.attempts) FROM PUBLIC, anon, authenticated;
