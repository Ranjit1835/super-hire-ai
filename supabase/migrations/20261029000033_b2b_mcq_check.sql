-- R2.3 independent MCQ check. An MCQ's answer key is checked by a separate model call that solves the question
-- without seeing the key (b2b-assess, feature "mcq.validate"). The result is stored per question version in
-- questions.mcq_check:
--   { version, answer: [ids], agrees, ambiguous, confidence, note, model, checked_at, override?: { by, note, at } }
-- An MCQ becomes 'verified' only when that check agrees (confident, not ambiguous) or an editor overrides it with a
-- note (audited). Changing a verified MCQ's content sends it back to draft.

ALTER TABLE public.questions ADD COLUMN mcq_check JSONB;

/** Whether the stored check clears this MCQ at its current version. */
CREATE OR REPLACE FUNCTION public._b2b_mcq_check_ok(q public.questions)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT q.mcq_check IS NOT NULL
     AND (q.mcq_check->>'version')::integer IS NOT DISTINCT FROM q.version
     AND ((COALESCE((q.mcq_check->>'agrees')::boolean, false) AND NOT COALESCE((q.mcq_check->>'ambiguous')::boolean, false)
           AND COALESCE((q.mcq_check->>'confidence')::numeric, 0) >= 0.8)
          OR q.mcq_check ? 'override')
$$;

-- Browser writes (RLS lets editors update their questions): an MCQ can't be switched to 'verified' without a
-- clearing check, and editing a verified MCQ's content drops it to draft. Server paths go through the functions below.
CREATE OR REPLACE FUNCTION public.questions_mcq_guard()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF current_user <> 'authenticated' OR NEW.type <> 'mcq' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'verified'
     AND (NEW.statement IS DISTINCT FROM OLD.statement OR NEW.options IS DISTINCT FROM OLD.options
          OR NEW.answer IS DISTINCT FROM OLD.answer OR NEW.multi_select IS DISTINCT FROM OLD.multi_select) THEN
    NEW.status := 'draft';
  ELSIF NEW.status = 'verified' AND (TG_OP = 'INSERT' OR OLD.status <> 'verified') AND NOT public._b2b_mcq_check_ok(NEW) THEN
    RAISE EXCEPTION 'CHECK_REQUIRED: an MCQ is verified by the independent answer check' USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- The check itself is written only by the server.
  IF NEW.mcq_check IS DISTINCT FROM (CASE WHEN TG_OP = 'UPDATE' THEN OLD.mcq_check END) THEN
    RAISE EXCEPTION 'CHECK_REQUIRED: the answer check is recorded by the server' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER questions_mcq_guard BEFORE INSERT OR UPDATE ON public.questions
  FOR EACH ROW EXECUTE FUNCTION public.questions_mcq_guard();

-- Regenerated from 20261021000006: MCQs no longer saved 'verified' directly.
CREATE OR REPLACE FUNCTION public._b2b_save_question(_actor UUID, _q JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_id UUID := NULLIF(_q->>'id', '')::uuid;
  v_org UUID := NULLIF(_q->>'org_id', '')::uuid;
  v_existing public.questions;
  v_type TEXT := _q->>'type';
  v_status TEXT;
  v_tests JSONB := COALESCE(_q->'tests', '[]'::jsonb);
  v_samples INTEGER;
BEGIN
  IF _actor IS NULL THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'insufficient_privilege'; END IF;
  IF v_id IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.questions WHERE id = v_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'NOT_FOUND'); END IF;
    v_org := v_existing.org_id;          -- a question never moves between orgs
    v_type := v_existing.type;
  END IF;
  -- Global bank: super admin only. Org bank: org editors.
  IF NOT COALESCE(CASE WHEN v_org IS NULL THEN public.actor_is_super_admin(_actor)
                       ELSE public.actor_is_org_editor(_actor, v_org) END, false) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM set_config('b2b.actor', _actor::text, true);

  IF v_type NOT IN ('coding', 'mcq') THEN RETURN jsonb_build_object('ok', false, 'reason', 'BAD_TYPE'); END IF;
  IF v_type = 'coding' THEN
    SELECT count(*) FILTER (WHERE COALESCE((t->>'is_sample')::boolean, false)) INTO v_samples
      FROM jsonb_array_elements(v_tests) t;
    IF jsonb_array_length(v_tests) < 2 OR v_samples < 1 THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'NEED_TESTS');
    END IF;
    IF _q->'reference' IS NULL OR COALESCE(_q->'reference'->>'code', '') = '' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'NEED_REFERENCE');
    END IF;
    v_status := CASE WHEN _q->>'status' = 'retired' THEN 'retired' ELSE 'draft' END;
  ELSE
    v_status := COALESCE(NULLIF(_q->>'status', ''), 'draft');
    IF v_status NOT IN ('draft', 'verified', 'retired') THEN v_status := 'draft'; END IF;
    -- R2.3: an MCQ is verified only by the independent check (or an override with a note). Saving keeps an
    -- already-verified MCQ verified when its content is unchanged; otherwise it goes back to draft for checking.
    IF v_status = 'verified' AND NOT (
         v_id IS NOT NULL AND v_existing.status = 'verified'
         AND v_existing.statement IS NOT DISTINCT FROM _q->>'statement'
         AND v_existing.options IS NOT DISTINCT FROM _q->'options'
         AND v_existing.answer IS NOT DISTINCT FROM _q->'answer'
         AND v_existing.multi_select IS NOT DISTINCT FROM COALESCE((_q->>'multi_select')::boolean, false)) THEN
      v_status := 'draft';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(_q->'options', '[]'::jsonb)) o
                   WHERE o->>'id' IN (SELECT jsonb_array_elements_text(COALESCE(_q->'answer', '[]'::jsonb)))) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'ANSWER_NOT_AN_OPTION');
    END IF;
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO public.questions (org_id, type, title, statement, difficulty, topics, category, languages, starter_code,
      constraints, time_limit_ms, memory_limit_kb, options, answer, multi_select, explanation, points, status, source,
      family_id, params, created_by)
    VALUES (v_org, v_type, _q->>'title', _q->>'statement', _q->>'difficulty',
      COALESCE(ARRAY(SELECT jsonb_array_elements_text(_q->'topics')), '{}'), NULLIF(_q->>'category', ''),
      COALESCE(ARRAY(SELECT jsonb_array_elements_text(_q->'languages')), '{}'), COALESCE(_q->'starter_code', '{}'::jsonb),
      NULLIF(_q->>'constraints', ''), (_q->>'time_limit_ms')::integer, (_q->>'memory_limit_kb')::integer,
      CASE WHEN v_type = 'mcq' THEN _q->'options' END, CASE WHEN v_type = 'mcq' THEN _q->'answer' END,
      COALESCE((_q->>'multi_select')::boolean, false), NULLIF(_q->>'explanation', ''),
      COALESCE((_q->>'points')::numeric, 1), v_status, COALESCE(NULLIF(_q->>'source', ''), 'manual'),
      NULLIF(_q->>'family_id', '')::uuid, _q->'params', _actor)
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.questions SET
      title = _q->>'title', statement = _q->>'statement', difficulty = _q->>'difficulty',
      topics = COALESCE(ARRAY(SELECT jsonb_array_elements_text(_q->'topics')), '{}'), category = NULLIF(_q->>'category', ''),
      languages = COALESCE(ARRAY(SELECT jsonb_array_elements_text(_q->'languages')), '{}'),
      starter_code = COALESCE(_q->'starter_code', '{}'::jsonb), constraints = NULLIF(_q->>'constraints', ''),
      time_limit_ms = (_q->>'time_limit_ms')::integer, memory_limit_kb = (_q->>'memory_limit_kb')::integer,
      options = CASE WHEN v_type = 'mcq' THEN _q->'options' END, answer = CASE WHEN v_type = 'mcq' THEN _q->'answer' END,
      multi_select = COALESCE((_q->>'multi_select')::boolean, false), explanation = NULLIF(_q->>'explanation', ''),
      points = COALESCE((_q->>'points')::numeric, 1), status = v_status
    WHERE id = v_id;
  END IF;

  IF v_type = 'coding' THEN
    DELETE FROM public.test_cases WHERE question_id = v_id;
    INSERT INTO public.test_cases (question_id, ordinal, input, expected_output, is_sample, weight)
      SELECT v_id, (t.ord - 1)::integer, COALESCE(t.v->>'input', ''), COALESCE(t.v->>'expected_output', ''),
             COALESCE((t.v->>'is_sample')::boolean, false), COALESCE((t.v->>'weight')::numeric, 1)
      FROM jsonb_array_elements(v_tests) WITH ORDINALITY AS t(v, ord);
    DELETE FROM public.reference_solutions WHERE question_id = v_id;
    INSERT INTO public.reference_solutions (question_id, language, code)
      VALUES (v_id, _q->'reference'->>'language', _q->'reference'->>'code');
  END IF;
  RETURN jsonb_build_object('ok', true, 'question_id', v_id, 'status', v_status);
END;
$$;

-- Regenerated from 20261021000006: the MCQ's text, options, key and last check, for the independent check.
CREATE OR REPLACE FUNCTION public.b2b_question_for_verify(_actor UUID, _question_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE q public.questions;
BEGIN
  SELECT * INTO q FROM public.questions WHERE id = _question_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'NOT_FOUND'); END IF;
  IF NOT COALESCE(CASE WHEN q.org_id IS NULL THEN public.actor_is_super_admin(_actor)
                       ELSE public.actor_is_org_editor(_actor, q.org_id) END, false) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN jsonb_build_object('ok', true, 'type', q.type, 'version', q.version, 'org_id', q.org_id,
    'statement', CASE WHEN q.type = 'mcq' THEN q.statement END, 'options', CASE WHEN q.type = 'mcq' THEN q.options END,
    'answer', CASE WHEN q.type = 'mcq' THEN q.answer END, 'multi_select', q.multi_select, 'mcq_check', q.mcq_check,
    'time_limit_ms', q.time_limit_ms, 'memory_limit_kb', q.memory_limit_kb,
    'tests', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', t.id, 'input', t.input, 'expected_output', t.expected_output,
                                       'is_sample', t.is_sample, 'weight', t.weight) ORDER BY t.ordinal)
                       FROM public.test_cases t WHERE t.question_id = q.id), '[]'::jsonb),
    'references', COALESCE((SELECT jsonb_agg(jsonb_build_object('language', r.language, 'code', r.code))
                            FROM public.reference_solutions r WHERE r.question_id = q.id), '[]'::jsonb));
END;
$$;

-- Regenerated from 20261021000006: MCQs need an agreeing check or an override; versions checked for both types.
CREATE OR REPLACE FUNCTION public.b2b_record_verification(_actor UUID, _question_id UUID, _version INTEGER, _passed BOOLEAN)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE q public.questions;
BEGIN
  SELECT * INTO q FROM public.questions WHERE id = _question_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'NOT_FOUND'); END IF;
  IF NOT COALESCE(CASE WHEN q.org_id IS NULL THEN public.actor_is_super_admin(_actor)
                       ELSE public.actor_is_org_editor(_actor, q.org_id) END, false) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM set_config('b2b.actor', _actor::text, true);
  IF q.status = 'retired' THEN RETURN jsonb_build_object('ok', false, 'reason', 'RETIRED'); END IF;
  IF _version IS DISTINCT FROM q.version THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'CHANGED');
  END IF;
  IF (q.type = 'mcq' AND public._b2b_mcq_check_ok(q)) OR (q.type = 'coding' AND COALESCE(_passed, false)) THEN
    UPDATE public.questions SET status = 'verified' WHERE id = q.id;
    UPDATE public.reference_solutions SET verified_at = now() WHERE question_id = q.id;
    RETURN jsonb_build_object('ok', true, 'status', 'verified');
  END IF;
  UPDATE public.questions SET status = 'draft' WHERE id = q.id;
  UPDATE public.reference_solutions SET verified_at = NULL WHERE question_id = q.id;
  RETURN jsonb_build_object('ok', true, 'status', 'draft');
END;
$$;

-- Server (b2b-assess, service role): store the independent check for this version of the question.
CREATE OR REPLACE FUNCTION public.b2b_record_mcq_check(_actor UUID, _question_id UUID, _version INTEGER, _check JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE q public.questions;
BEGIN
  SELECT * INTO q FROM public.questions WHERE id = _question_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'NOT_FOUND'); END IF;
  IF NOT COALESCE(CASE WHEN q.org_id IS NULL THEN public.actor_is_super_admin(_actor)
                       ELSE public.actor_is_org_editor(_actor, q.org_id) END, false) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF q.type <> 'mcq' THEN RETURN jsonb_build_object('ok', false, 'reason', 'BAD_TYPE'); END IF;
  IF _version IS DISTINCT FROM q.version THEN RETURN jsonb_build_object('ok', false, 'reason', 'CHANGED'); END IF;
  IF _check IS NULL OR jsonb_typeof(_check) <> 'object' OR jsonb_typeof(_check->'answer') <> 'array' THEN
    RAISE EXCEPTION 'INVALID_CHECK' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE public.questions SET mcq_check = (_check - 'override' - 'version' - 'checked_at')
      || jsonb_build_object('version', q.version, 'checked_at', now())
    WHERE id = q.id;
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- Editors: use the key anyway after the check disagreed or found the question unclear. Needs a reason; audited.
CREATE OR REPLACE FUNCTION public.b2b_override_mcq_check(_question_id UUID, _version INTEGER, _note TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE q public.questions;
BEGIN
  SELECT * INTO q FROM public.questions WHERE id = _question_id FOR UPDATE;
  IF NOT FOUND OR NOT (public.is_super_admin() OR (q.org_id IS NOT NULL AND public.is_org_editor(q.org_id))) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF q.type <> 'mcq' THEN RETURN jsonb_build_object('ok', false, 'reason', 'BAD_TYPE'); END IF;
  IF q.status = 'retired' THEN RETURN jsonb_build_object('ok', false, 'reason', 'RETIRED'); END IF;
  IF _version IS DISTINCT FROM q.version THEN RETURN jsonb_build_object('ok', false, 'reason', 'CHANGED'); END IF;
  IF q.mcq_check IS NULL OR (q.mcq_check->>'version')::integer IS DISTINCT FROM q.version THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NOT_CHECKED');
  END IF;
  IF length(btrim(COALESCE(_note, ''))) < 10 THEN RETURN jsonb_build_object('ok', false, 'reason', 'NOTE_REQUIRED'); END IF;
  UPDATE public.questions SET status = 'verified',
      mcq_check = mcq_check || jsonb_build_object('override', jsonb_build_object('by', auth.uid(), 'note', left(btrim(_note), 1000), 'at', now()))
    WHERE id = q.id;
  PERFORM public.b2b_audit(q.org_id, 'question.mcq_override', 'question', q.id::text,
    jsonb_build_object('version', q.version, 'note', left(btrim(_note), 1000), 'check_answer', q.mcq_check->'answer', 'key', q.answer));
  RETURN jsonb_build_object('ok', true, 'status', 'verified');
END;
$$;

REVOKE ALL ON FUNCTION public.b2b_record_mcq_check(UUID, UUID, INTEGER, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.b2b_record_mcq_check(UUID, UUID, INTEGER, JSONB) TO service_role;
REVOKE ALL ON FUNCTION public.b2b_override_mcq_check(UUID, INTEGER, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.b2b_override_mcq_check(UUID, INTEGER, TEXT) TO authenticated;
