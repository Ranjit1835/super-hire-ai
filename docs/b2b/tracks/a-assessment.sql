-- Track A — assessment engine (question bank, verification, runner, grading).
-- Proposed schema: applies after every migration up to 20261021000005. The lead turns it into a numbered
-- migration when merging. Conventions: SECURITY DEFINER + search_path ''; service-role functions take
-- _actor and re-check authorization; internal helpers (prefixed _b2b_) are callable by nobody but the owner.
--
--   1. schema tweaks: assessments.practice_enabled, attempts.grading_status, submissions.grade_tries,
--      edit_history.kind/meta (integrity rows such as second_session)
--   2. question bank: b2b_save_question (browser), b2b_save_question_as (service), verification pair
--   3. runner: start / state / heartbeat / autosave / runner_question / create_submission / finish
--   4. grading: record_judge_result, score_attempt (MCQ + negative marking, sections, dimension scores),
--      pending_submissions (grader queue), expire_attempts (deadline sweep, cron)

-- =============================================
-- 1. Schema tweaks
-- =============================================
ALTER TABLE public.assessments
  ADD COLUMN practice_enabled BOOLEAN NOT NULL DEFAULT false;   -- students of the org may self-start practice attempts

ALTER TABLE public.attempts
  ADD COLUMN grading_status TEXT CHECK (grading_status IS NULL OR grading_status IN ('pending', 'complete'));

ALTER TABLE public.submissions
  ADD COLUMN grade_tries INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_submissions_queue ON public.submissions(status, created_at) WHERE status IN ('queued', 'running');

-- Integrity rows (e.g. a second tab) live next to the edit batches; they have no question.
ALTER TABLE public.edit_history
  ALTER COLUMN question_id DROP NOT NULL,
  ADD COLUMN kind TEXT NOT NULL DEFAULT 'edits' CHECK (kind IN ('edits', 'integrity')),
  ADD COLUMN meta JSONB;
ALTER TABLE public.edit_history
  ADD CONSTRAINT edit_history_question_by_kind CHECK (kind = 'integrity' OR question_id IS NOT NULL);

-- =============================================
-- 2. Question bank
-- =============================================
-- Exact set equality of two JSON arrays of strings (MCQ answers).
CREATE OR REPLACE FUNCTION public._b2b_json_set_eq(_a JSONB, _b JSONB)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT COALESCE(jsonb_typeof(_a) = 'array' AND jsonb_typeof(_b) = 'array'
    AND (SELECT COALESCE(array_agg(DISTINCT x ORDER BY x), '{}') FROM jsonb_array_elements_text(_a) x)
      = (SELECT COALESCE(array_agg(DISTINCT y ORDER BY y), '{}') FROM jsonb_array_elements_text(_b) y), false)
$$;

-- Create or update a question with its test cases and reference solution, atomically.
-- Coding questions always come out 'draft' (verified only by the sandbox run). MCQs may be saved 'verified'.
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

-- Browser (staff): actor = the signed-in user.
CREATE OR REPLACE FUNCTION public.b2b_save_question(_q JSONB)
RETURNS JSONB LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT public._b2b_save_question(auth.uid(), _q)
$$;

-- Service role (AI generation in b2b-assess).
CREATE OR REPLACE FUNCTION public.b2b_save_question_as(_actor UUID, _q JSONB)
RETURNS JSONB LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT public._b2b_save_question(_actor, _q)
$$;

-- What the sandbox needs to verify a coding question (service role).
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
    'time_limit_ms', q.time_limit_ms, 'memory_limit_kb', q.memory_limit_kb,
    'tests', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', t.id, 'input', t.input, 'expected_output', t.expected_output,
                                       'is_sample', t.is_sample, 'weight', t.weight) ORDER BY t.ordinal)
                       FROM public.test_cases t WHERE t.question_id = q.id), '[]'::jsonb),
    'references', COALESCE((SELECT jsonb_agg(jsonb_build_object('language', r.language, 'code', r.code))
                            FROM public.reference_solutions r WHERE r.question_id = q.id), '[]'::jsonb));
END;
$$;

-- Record a sandbox verification. Coding: verified only if every test passed and the question didn't change
-- meanwhile (version). MCQ: verified directly.
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
  IF q.type = 'coding' AND (_version IS DISTINCT FROM q.version) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'CHANGED');
  END IF;
  IF q.type = 'mcq' OR COALESCE(_passed, false) THEN
    UPDATE public.questions SET status = 'verified' WHERE id = q.id;
    UPDATE public.reference_solutions SET verified_at = now() WHERE question_id = q.id;
    RETURN jsonb_build_object('ok', true, 'status', 'verified');
  END IF;
  UPDATE public.questions SET status = 'draft' WHERE id = q.id;
  UPDATE public.reference_solutions SET verified_at = NULL WHERE question_id = q.id;
  RETURN jsonb_build_object('ok', true, 'status', 'draft');
END;
$$;

-- =============================================
-- 3. Runner
-- =============================================
-- A session that hasn't been seen for this long may be taken over (closed tab, crashed browser).
CREATE OR REPLACE FUNCTION public._b2b_session_stale_after() RETURNS INTERVAL LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT interval '45 seconds'
$$;
-- Saves that left the browser just before the deadline still land.
CREATE OR REPLACE FUNCTION public._b2b_deadline_grace() RETURNS INTERVAL LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT interval '15 seconds'
$$;

-- Per-subject question set: [{ question_id, section, type, option_order }]. Deterministic for a seed
-- (the attempt id): order by md5(seed || id), so a resume never reshuffles and two subjects differ.
CREATE OR REPLACE FUNCTION public._b2b_build_question_set(_assessment_id UUID, _seed TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a public.assessments;
  s JSONB;
  p JSONB;
  v_si INTEGER := 0;
  v_set JSONB := '[]'::jsonb;
  v_section JSONB;
  v_picked UUID[] := '{}';
  v_ids UUID[];
  v_qid UUID;
  v_type TEXT;
  v_topics TEXT[];
BEGIN
  SELECT * INTO a FROM public.assessments WHERE id = _assessment_id;
  FOR s IN SELECT value FROM jsonb_array_elements(a.sections) LOOP
    v_type := s->>'type';
    v_section := '[]'::jsonb;
    -- fixed questions
    IF jsonb_typeof(s->'question_ids') = 'array' THEN
      FOR v_qid IN
        SELECT q.id FROM jsonb_array_elements_text(s->'question_ids') WITH ORDINALITY AS x(id, ord)
        JOIN public.questions q ON q.id = x.id::uuid
        WHERE q.status = 'verified' AND q.type = v_type AND (q.org_id = a.org_id OR q.org_id IS NULL)
          AND NOT q.id = ANY (v_picked)
        ORDER BY x.ord
      LOOP
        v_picked := v_picked || v_qid;
        v_section := v_section || jsonb_build_array(v_qid);
      END LOOP;
    END IF;
    -- pool rules
    IF jsonb_typeof(s->'pick') = 'array' THEN
      FOR p IN SELECT value FROM jsonb_array_elements(s->'pick') LOOP
        v_topics := COALESCE(ARRAY(SELECT lower(jsonb_array_elements_text(p->'topics'))), '{}');
        SELECT COALESCE(array_agg(id), '{}') INTO v_ids FROM (
          SELECT q.id FROM public.questions q
          WHERE q.status = 'verified' AND q.type = v_type AND (q.org_id = a.org_id OR q.org_id IS NULL)
            AND (p->>'difficulty' IS NULL OR q.difficulty = p->>'difficulty')
            AND (cardinality(v_topics) = 0
                 OR EXISTS (SELECT 1 FROM unnest(q.topics) t WHERE lower(t) = ANY (v_topics)))
            AND (v_type <> 'coding' OR q.languages && a.languages)
            AND NOT q.id = ANY (v_picked)
          ORDER BY CASE WHEN a.randomize THEN md5(_seed || q.id::text) ELSE q.created_at::text || q.id::text END
          LIMIT GREATEST(COALESCE((p->>'count')::integer, 1), 0)
        ) x;
        v_picked := v_picked || v_ids;
        v_section := v_section || to_jsonb(v_ids);
      END LOOP;
    END IF;
    -- order within the section, then option shuffle
    v_set := v_set || COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'question_id', q.id, 'section', v_si, 'type', q.type,
               'option_order', CASE WHEN q.type = 'mcq' THEN (
                  SELECT jsonb_agg(o->>'id' ORDER BY CASE WHEN a.shuffle_options THEN md5(_seed || q.id::text || (o->>'id')) END NULLS LAST, oo.ord)
                  FROM jsonb_array_elements(q.options) WITH ORDINALITY AS oo(o, ord)) END)
             ORDER BY CASE WHEN a.randomize THEN md5(_seed || 'order' || q.id::text) END NULLS LAST, x.ord)
      FROM jsonb_array_elements_text(v_section) WITH ORDINALITY AS x(id, ord)
      JOIN public.questions q ON q.id = x.id::uuid), '[]'::jsonb);
    v_si := v_si + 1;
  END LOOP;
  RETURN v_set;
END;
$$;

-- Claim the single active session. NULL session or a different one: allowed only when the current
-- session is stale; otherwise OTHER_SESSION (logged as an integrity row in edit_history).
CREATE OR REPLACE FUNCTION public._b2b_claim_session(_attempt_id UUID, _session UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE a public.attempts; v_new UUID;
BEGIN
  SELECT * INTO a FROM public.attempts WHERE id = _attempt_id FOR UPDATE;
  IF a.status NOT IN ('in_progress', 'not_started') THEN
    RETURN jsonb_build_object('ok', true, 'session_id', COALESCE(_session, a.active_session_id, gen_random_uuid()));
  END IF;
  IF _session IS NOT NULL AND a.active_session_id = _session THEN
    UPDATE public.attempts SET active_session_seen_at = now() WHERE id = a.id;
    RETURN jsonb_build_object('ok', true, 'session_id', _session);
  END IF;
  IF a.active_session_id IS NOT NULL AND a.active_session_seen_at > now() - public._b2b_session_stale_after() THEN
    INSERT INTO public.edit_history (attempt_id, question_id, org_id, seq, kind, events, meta)
      VALUES (a.id, NULL, a.org_id, 0, 'integrity',
              jsonb_build_array(jsonb_build_object('t', (extract(epoch FROM now() - COALESCE(a.started_at, now())) * 1000)::bigint,
                                                   'op', 'second_session')),
              jsonb_build_object('type', 'second_session', 'presented_session', _session, 'at', now()));
    RETURN jsonb_build_object('ok', false, 'reason', 'OTHER_SESSION');
  END IF;
  v_new := COALESCE(_session, gen_random_uuid());
  UPDATE public.attempts SET active_session_id = v_new, active_session_seen_at = now() WHERE id = a.id;
  RETURN jsonb_build_object('ok', true, 'session_id', v_new, 'took_over', a.active_session_id IS NOT NULL);
END;
$$;

CREATE OR REPLACE FUNCTION public._b2b_subject_ids(_actor UUID, _org UUID, OUT student_id UUID, OUT candidate_id UUID)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT (SELECT s.id FROM public.students s WHERE s.org_id = _org AND s.user_id = _actor LIMIT 1),
         (SELECT c.id FROM public.candidates c WHERE c.org_id = _org AND c.user_id = _actor LIMIT 1)
$$;

-- Start or resume the caller's attempt in a context.
--   practice: _assessment_id; the caller is an active student member of the assessment's org; practice_enabled.
--   drive:    _context_id = drive; the caller's student row is assigned, the drive is scheduled/live, inside its window.
--   job_role: _context_id = job role; the caller is the candidate linked to a live role_candidates row.
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
    SELECT * INTO v_attempt FROM public.attempts
      WHERE subject_user_id = _actor AND context_type = 'practice' AND assessment_id = a.id AND status IN ('not_started', 'in_progress')
      ORDER BY created_at DESC LIMIT 1;
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
    v_charge := public.b2b_consume_credits(v_org, 0.25, 'practice_coding', 'attempt', v_id::text, _actor);
    IF NOT (v_charge->>'ok')::boolean THEN RETURN jsonb_build_object('ok', false, 'reason', v_charge->>'reason'); END IF;
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

-- Load an attempt the actor takes (subject only).
CREATE OR REPLACE FUNCTION public._b2b_subject_attempt(_actor UUID, _attempt_id UUID)
RETURNS public.attempts LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE a public.attempts;
BEGIN
  SELECT * INTO a FROM public.attempts WHERE id = _attempt_id;
  IF NOT FOUND OR _actor IS NULL OR a.subject_user_id <> _actor THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN a;
END;
$$;

CREATE OR REPLACE FUNCTION public._b2b_attempt_policy(a public.attempts)
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(
    CASE a.context_type
      WHEN 'drive' THEN (SELECT proctoring_policy FROM public.drives WHERE id = a.context_id)
      WHEN 'job_role' THEN (SELECT proctoring_policy FROM public.job_roles WHERE id = a.context_id)
    END,
    (SELECT proctoring_policy FROM public.assessments WHERE id = a.assessment_id), 'standard')
$$;

-- Runner view of the attempt. Never contains answers, hidden tests or reference solutions.
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
    JOIN public.questions q ON q.id = (qs.e->>'question_id')::uuid;
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
    'proctoring_session_id', (SELECT ps.id FROM public.proctoring_sessions ps WHERE ps.attempt_id = a.id
                              ORDER BY ps.started_at DESC LIMIT 1));
END;
$$;

CREATE OR REPLACE FUNCTION public.b2b_attempt_heartbeat(_actor UUID, _attempt_id UUID, _session UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE a public.attempts;
BEGIN
  a := public._b2b_subject_attempt(_actor, _attempt_id);
  PERFORM public._b2b_expire_if_due(a.id);
  SELECT * INTO a FROM public.attempts WHERE id = _attempt_id;
  IF a.status NOT IN ('in_progress', 'not_started') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'ENDED', 'status', a.status, 'deadline_at', a.deadline_at,
                              'server_now', now(), 'paused', false);
  END IF;
  IF a.active_session_id IS DISTINCT FROM _session THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'OTHER_SESSION', 'status', a.status, 'deadline_at', a.deadline_at,
                              'server_now', now(), 'paused', a.paused_at IS NOT NULL);
  END IF;
  UPDATE public.attempts SET active_session_seen_at = now() WHERE id = a.id;
  RETURN jsonb_build_object('ok', true, 'status', a.status, 'deadline_at', a.deadline_at, 'server_now', now(),
                            'paused', a.paused_at IS NOT NULL);
END;
$$;

-- Common guard for writes during the test: subject, same session, in progress, before deadline (+grace),
-- question in the attempt's set.
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
  UPDATE public.attempts SET active_session_seen_at = now() WHERE id = a.id;
  RETURN jsonb_build_object('ok', true, 'org_id', a.org_id, 'deadline_at', a.deadline_at, 'started_at', a.started_at);
END;
$$;

-- Autosave: the latest answer per question; an older seq never overwrites a newer one. Edit batches are logged.
CREATE OR REPLACE FUNCTION public.b2b_autosave(
  _actor UUID, _attempt_id UUID, _session UUID, _question UUID, _seq INTEGER,
  _language TEXT, _code TEXT, _mcq_choice JSONB, _edits JSONB
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE g JSONB; v_seq INTEGER; v_org UUID;
BEGIN
  g := public._b2b_runner_guard(_actor, _attempt_id, _session, _question);
  IF NOT (g->>'ok')::boolean THEN RETURN g; END IF;
  v_org := (g->>'org_id')::uuid;
  INSERT INTO public.attempt_answers AS aa (attempt_id, question_id, org_id, language, code, mcq_choice, seq, updated_at)
    VALUES (_attempt_id, _question, v_org, _language, _code, _mcq_choice, _seq, now())
  ON CONFLICT (attempt_id, question_id) DO UPDATE SET
    language = COALESCE(EXCLUDED.language, aa.language),
    code = COALESCE(EXCLUDED.code, aa.code),
    mcq_choice = COALESCE(EXCLUDED.mcq_choice, aa.mcq_choice),
    seq = EXCLUDED.seq, updated_at = now()
  WHERE aa.seq < EXCLUDED.seq;
  IF _edits IS NOT NULL AND jsonb_typeof(_edits) = 'array' AND jsonb_array_length(_edits) > 0 THEN
    INSERT INTO public.edit_history (attempt_id, question_id, org_id, seq, events)
      VALUES (_attempt_id, _question, v_org, _seq, _edits)
    ON CONFLICT (attempt_id, question_id, seq) DO NOTHING;
  END IF;
  SELECT seq INTO v_seq FROM public.attempt_answers WHERE attempt_id = _attempt_id AND question_id = _question;
  RETURN jsonb_build_object('ok', true, 'seq', v_seq, 'deadline_at', g->>'deadline_at', 'server_now', now());
END;
$$;

-- What run / submit need for one question (service role only: includes hidden tests for the grader).
CREATE OR REPLACE FUNCTION public.b2b_runner_question(_actor UUID, _attempt_id UUID, _session UUID, _question UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE g JSONB; q public.questions; v_langs TEXT[];
BEGIN
  g := public._b2b_runner_guard(_actor, _attempt_id, _session, _question);
  IF NOT (g->>'ok')::boolean THEN RETURN g; END IF;
  SELECT * INTO q FROM public.questions WHERE id = _question;
  SELECT ARRAY(SELECT l FROM unnest(q.languages) l WHERE l = ANY (asm.languages)) INTO v_langs
    FROM public.attempts a JOIN public.assessments asm ON asm.id = a.assessment_id WHERE a.id = _attempt_id;
  RETURN jsonb_build_object('ok', true, 'type', q.type, 'points', q.points, 'languages', to_jsonb(v_langs),
    'time_limit_ms', q.time_limit_ms, 'memory_limit_kb', q.memory_limit_kb,
    'tests', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', t.id, 'input', t.input, 'expected_output', t.expected_output,
                                       'is_sample', t.is_sample, 'weight', t.weight) ORDER BY t.ordinal)
                       FROM public.test_cases t WHERE t.question_id = q.id), '[]'::jsonb));
END;
$$;

-- A run or a submit. Runs are rate-limited (30 a minute per attempt). Submit also stores the answer.
CREATE OR REPLACE FUNCTION public.b2b_create_submission(
  _actor UUID, _attempt_id UUID, _session UUID, _question UUID, _kind TEXT, _language TEXT, _code TEXT, _mcq_choice JSONB
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE g JSONB; v_id UUID; v_org UUID;
BEGIN
  IF _kind NOT IN ('run', 'submit') THEN RETURN jsonb_build_object('ok', false, 'reason', 'BAD_KIND'); END IF;
  g := public._b2b_runner_guard(_actor, _attempt_id, _session, _question);
  IF NOT (g->>'ok')::boolean THEN RETURN g; END IF;
  v_org := (g->>'org_id')::uuid;
  IF _kind = 'run' AND (SELECT count(*) FROM public.submissions WHERE attempt_id = _attempt_id AND kind = 'run'
                        AND created_at > now() - interval '1 minute') >= 30 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'RATE_LIMITED');
  END IF;
  INSERT INTO public.submissions (attempt_id, question_id, org_id, kind, language, code, mcq_choice, status)
    VALUES (_attempt_id, _question, v_org, _kind, _language, _code, _mcq_choice, CASE WHEN _kind = 'run' THEN 'running' ELSE 'queued' END)
    RETURNING id INTO v_id;
  IF _kind = 'submit' THEN
    INSERT INTO public.attempt_answers AS aa (attempt_id, question_id, org_id, language, code, mcq_choice, seq)
      VALUES (_attempt_id, _question, v_org, _language, _code, _mcq_choice, 0)
    ON CONFLICT (attempt_id, question_id) DO UPDATE SET
      language = COALESCE(EXCLUDED.language, aa.language), code = COALESCE(EXCLUDED.code, aa.code),
      mcq_choice = COALESCE(EXCLUDED.mcq_choice, aa.mcq_choice), updated_at = now();
  END IF;
  RETURN jsonb_build_object('ok', true, 'submission_id', v_id);
END;
$$;

-- =============================================
-- 4. Grading
-- =============================================
-- Scores from what is graded so far: coding = latest done final (else latest done submit);
-- MCQ = exact match → points, wrong → −negative_marking × points, blank → 0. Section scores floor at 0.
-- Writes attempts.score/max_score/section_scores/grading_status and the dimension scores.
CREATE OR REPLACE FUNCTION public.b2b_score_attempt(_attempt_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a public.attempts;
  asm public.assessments;
  v_rows JSONB;
  v_sections JSONB;
  v_total NUMERIC;
  v_max NUMERIC;
  v_pending BOOLEAN;
BEGIN
  SELECT * INTO a FROM public.attempts WHERE id = _attempt_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'NOT_FOUND'); END IF;
  SELECT * INTO asm FROM public.assessments WHERE id = a.assessment_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('section', r.section, 'type', r.type, 'category', r.category, 'topic', r.topic,
                                               'score', r.score, 'max', r.max, 'pending', r.pending)), '[]'::jsonb)
    INTO v_rows
  FROM (
  SELECT (e->>'section')::integer AS section, q.type, q.category, lower(COALESCE(q.topics[1], q.category, 'general')) AS topic,
    CASE WHEN q.type = 'mcq' THEN
           CASE WHEN aa.mcq_choice IS NULL OR jsonb_array_length(COALESCE(aa.mcq_choice, '[]')) = 0 THEN 0
                WHEN public._b2b_json_set_eq(aa.mcq_choice, q.answer) THEN q.points
                ELSE -asm.negative_marking * q.points END
         ELSE COALESCE(sub.score, 0) END AS score,
    q.points AS max,
    (q.type = 'coding' AND sub.score IS NULL AND EXISTS (
      SELECT 1 FROM public.submissions s2 WHERE s2.attempt_id = a.id AND s2.question_id = q.id
        AND s2.kind IN ('submit', 'final') AND s2.status IN ('queued', 'running'))) AS pending
  FROM jsonb_array_elements(a.question_set) e
  JOIN public.questions q ON q.id = (e->>'question_id')::uuid
  LEFT JOIN public.attempt_answers aa ON aa.attempt_id = a.id AND aa.question_id = q.id
  LEFT JOIN LATERAL (
    SELECT s.score FROM public.submissions s
    WHERE s.attempt_id = a.id AND s.question_id = q.id AND s.kind IN ('submit', 'final') AND s.status = 'done'
    ORDER BY (s.kind = 'final') DESC, s.created_at DESC LIMIT 1) sub ON true
  ) r;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('index', x.section, 'title', COALESCE(asm.sections->x.section->>'title', ''),
                                               'type', x.type, 'score', x.score, 'max_score', x.max) ORDER BY x.section), '[]'::jsonb),
         COALESCE(sum(x.score), 0), COALESCE(sum(x.max), 0)
    INTO v_sections, v_total, v_max
  FROM (SELECT section, min(type) AS type, GREATEST(sum(score), 0) AS score, sum(max) AS max
        FROM jsonb_to_recordset(v_rows) AS q(section INTEGER, type TEXT, category TEXT, topic TEXT, score NUMERIC, max NUMERIC, pending BOOLEAN) GROUP BY section) x;
  SELECT COALESCE(bool_or(q.pending), false) INTO v_pending FROM jsonb_to_recordset(v_rows) AS q(section INTEGER, type TEXT, category TEXT, topic TEXT, score NUMERIC, max NUMERIC, pending BOOLEAN);

  UPDATE public.attempts SET score = v_total, max_score = v_max, section_scores = v_sections,
    grading_status = CASE WHEN v_pending THEN 'pending' ELSE 'complete' END
  WHERE id = a.id;

  -- Dimension scores (0–100): coding; problem_solving (aptitude MCQs); technical_knowledge per topic.
  DELETE FROM public.dimension_scores WHERE source_type = 'assessment' AND source_id = a.id;
  INSERT INTO public.dimension_scores (org_id, subject_user_id, student_id, candidate_id, source_type, source_id,
                                       context_type, context_id, dimension, topic, score)
  SELECT a.org_id, a.subject_user_id, a.student_id, a.candidate_id, 'assessment', a.id, a.context_type, a.context_id,
         d.dimension, d.topic, LEAST(100, GREATEST(0, round(d.score / NULLIF(d.max, 0) * 100, 2)))
  FROM (
    SELECT 'coding' AS dimension, NULL::text AS topic, sum(score) AS score, sum(max) AS max FROM jsonb_to_recordset(v_rows) AS q(section INTEGER, type TEXT, category TEXT, topic TEXT, score NUMERIC, max NUMERIC, pending BOOLEAN) WHERE type = 'coding'
    UNION ALL
    SELECT 'problem_solving', NULL, sum(score), sum(max) FROM jsonb_to_recordset(v_rows) AS q(section INTEGER, type TEXT, category TEXT, topic TEXT, score NUMERIC, max NUMERIC, pending BOOLEAN) WHERE type = 'mcq' AND category = 'aptitude'
    UNION ALL
    SELECT 'technical_knowledge', topic, sum(score), sum(max) FROM jsonb_to_recordset(v_rows) AS q(section INTEGER, type TEXT, category TEXT, topic TEXT, score NUMERIC, max NUMERIC, pending BOOLEAN)
      WHERE type = 'mcq' AND category IS DISTINCT FROM 'aptitude' GROUP BY topic
  ) d WHERE d.max > 0;

  RETURN jsonb_build_object('ok', true, 'score', v_total, 'max_score', v_max, 'pending', v_pending);
END;
$$;

-- End an attempt: status, end reason, final submissions for every coding answer (reusing an identical
-- graded submit), then score with what is graded so far.
CREATE OR REPLACE FUNCTION public._b2b_end_attempt(_attempt_id UUID, _status TEXT, _reason TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE a public.attempts; v_pending UUID[];
BEGIN
  UPDATE public.attempts SET status = _status, end_reason = _reason, submitted_at = now(), active_session_id = NULL
    WHERE id = _attempt_id AND status IN ('not_started', 'in_progress')
    RETURNING * INTO a;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', true, 'already', true, 'pending', '[]'::jsonb); END IF;

  INSERT INTO public.submissions (attempt_id, question_id, org_id, kind, language, code, status, results, compile_output,
                                  passed, total, score, max_score, judged_at)
  SELECT a.id, aa.question_id, a.org_id, 'final', aa.language, aa.code,
         CASE WHEN prev.id IS NOT NULL THEN 'done' ELSE 'queued' END,
         prev.results, prev.compile_output, prev.passed, prev.total, prev.score, prev.max_score, prev.judged_at
  FROM public.attempt_answers aa
  JOIN public.questions q ON q.id = aa.question_id AND q.type = 'coding'
  LEFT JOIN LATERAL (
    SELECT s.* FROM public.submissions s
    WHERE s.attempt_id = a.id AND s.question_id = aa.question_id AND s.kind = 'submit' AND s.status = 'done'
      AND s.code IS NOT DISTINCT FROM aa.code AND s.language IS NOT DISTINCT FROM aa.language
    ORDER BY s.created_at DESC LIMIT 1) prev ON true
  WHERE aa.attempt_id = a.id AND COALESCE(btrim(aa.code), '') <> '' AND aa.language IS NOT NULL;

  SELECT COALESCE(array_agg(id), '{}') INTO v_pending FROM public.submissions
    WHERE attempt_id = a.id AND kind = 'final' AND status = 'queued';
  PERFORM public.b2b_score_attempt(a.id);
  RETURN jsonb_build_object('ok', true, 'pending', to_jsonb(v_pending));
END;
$$;

CREATE OR REPLACE FUNCTION public._b2b_expire_if_due(_attempt_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.attempts WHERE id = _attempt_id AND status = 'in_progress'
             AND paused_at IS NULL AND now() > deadline_at + public._b2b_deadline_grace()) THEN
    PERFORM public._b2b_end_attempt(_attempt_id, 'expired', 'deadline');
    RETURN true;
  END IF;
  RETURN false;
END;
$$;

-- The subject finishes (or the runner auto-submits at the deadline / on a strict-policy limit).
CREATE OR REPLACE FUNCTION public.b2b_finish_attempt(_actor UUID, _attempt_id UUID, _session UUID, _reason TEXT DEFAULT 'submitted')
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE a public.attempts; v_reason TEXT;
BEGIN
  a := public._b2b_subject_attempt(_actor, _attempt_id);
  PERFORM set_config('b2b.actor', _actor::text, true);
  IF a.status NOT IN ('in_progress', 'not_started') THEN
    RETURN jsonb_build_object('ok', true, 'already', true, 'pending', '[]'::jsonb);
  END IF;
  IF a.active_session_id IS DISTINCT FROM _session THEN RETURN jsonb_build_object('ok', false, 'reason', 'OTHER_SESSION'); END IF;
  v_reason := CASE WHEN _reason = 'violations' THEN 'violations'
                   WHEN now() >= a.deadline_at THEN 'deadline' ELSE 'submitted' END;
  RETURN public._b2b_end_attempt(a.id, 'submitted', v_reason);
END;
$$;

-- Grader writes a result (service role / system). Rescoring happens when the attempt has ended.
CREATE OR REPLACE FUNCTION public.b2b_record_judge_result(
  _submission_id UUID, _status TEXT, _results JSONB, _compile_output TEXT,
  _passed INTEGER, _total INTEGER, _score NUMERIC, _max_score NUMERIC
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE s public.submissions;
BEGIN
  IF _status NOT IN ('done', 'error', 'queued') THEN RETURN jsonb_build_object('ok', false, 'reason', 'BAD_STATUS'); END IF;
  UPDATE public.submissions SET status = _status, results = _results, compile_output = left(_compile_output, 20000),
    passed = _passed, total = _total, score = _score, max_score = _max_score,
    judged_at = CASE WHEN _status = 'queued' THEN NULL ELSE now() END
  WHERE id = _submission_id RETURNING * INTO s;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'NOT_FOUND'); END IF;
  IF s.kind <> 'run' AND EXISTS (SELECT 1 FROM public.attempts WHERE id = s.attempt_id AND status IN ('submitted', 'expired', 'terminated')) THEN
    PERFORM public.b2b_score_attempt(s.attempt_id);
  END IF;
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- Grader queue: claims up to _limit queued submit/final submissions (and ones stuck 'running' > 5 min),
-- with what the grader needs. Gives up after 5 tries (status 'error').
CREATE OR REPLACE FUNCTION public.b2b_claim_pending_submissions(_limit INTEGER DEFAULT 10, _ids UUID[] DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v JSONB;
BEGIN
  UPDATE public.submissions SET status = 'error', judged_at = now(), compile_output = 'Grading failed after several tries.'
    WHERE kind <> 'run' AND status IN ('queued', 'running') AND grade_tries >= 5
      AND (status = 'queued' OR created_at < now() - interval '5 minutes');
  WITH picked AS (
    SELECT s.id FROM public.submissions s
    WHERE s.kind IN ('submit', 'final') AND s.grade_tries < 5
      AND (s.status = 'queued' OR (s.status = 'running' AND s.created_at < now() - interval '5 minutes'))
      AND (_ids IS NULL OR s.id = ANY (_ids))
    ORDER BY s.created_at LIMIT LEAST(GREATEST(_limit, 1), 50)
    FOR UPDATE SKIP LOCKED
  ), upd AS (
    UPDATE public.submissions s SET status = 'running', grade_tries = s.grade_tries + 1
    FROM picked WHERE s.id = picked.id RETURNING s.*
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', u.id, 'attempt_id', u.attempt_id, 'question_id', u.question_id, 'language', u.language, 'code', u.code,
    'points', q.points, 'time_limit_ms', q.time_limit_ms, 'memory_limit_kb', q.memory_limit_kb,
    'tests', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', t.id, 'input', t.input, 'expected_output', t.expected_output,
                                       'is_sample', t.is_sample, 'weight', t.weight) ORDER BY t.ordinal)
                       FROM public.test_cases t WHERE t.question_id = q.id), '[]'::jsonb))), '[]'::jsonb) INTO v
  FROM upd u JOIN public.questions q ON q.id = u.question_id;
  RETURN v;
END;
$$;

-- Deadline sweep (pg_cron, every minute): ends attempts past their deadline (+grace). Returns how many.
CREATE OR REPLACE FUNCTION public.b2b_expire_attempts()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id UUID; v_n INTEGER := 0;
BEGIN
  FOR v_id IN SELECT id FROM public.attempts
              WHERE status = 'in_progress' AND paused_at IS NULL AND deadline_at + public._b2b_deadline_grace() < now()
              ORDER BY deadline_at LIMIT 500 FOR UPDATE SKIP LOCKED LOOP
    PERFORM public._b2b_end_attempt(v_id, 'expired', 'deadline');
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$$;

-- =============================================
-- Grants
-- =============================================
REVOKE EXECUTE ON FUNCTION
  public._b2b_json_set_eq(JSONB, JSONB), public._b2b_save_question(UUID, JSONB), public._b2b_session_stale_after(),
  public._b2b_deadline_grace(), public._b2b_build_question_set(UUID, TEXT), public._b2b_claim_session(UUID, UUID),
  public._b2b_subject_ids(UUID, UUID), public._b2b_subject_attempt(UUID, UUID), public._b2b_attempt_policy(public.attempts),
  public._b2b_runner_guard(UUID, UUID, UUID, UUID), public._b2b_end_attempt(UUID, TEXT, TEXT), public._b2b_expire_if_due(UUID)
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE EXECUTE ON FUNCTION
  public.b2b_save_question_as(UUID, JSONB), public.b2b_question_for_verify(UUID, UUID),
  public.b2b_record_verification(UUID, UUID, INTEGER, BOOLEAN), public.b2b_start_attempt(UUID, TEXT, UUID, UUID, UUID),
  public.b2b_attempt_state(UUID, UUID, UUID), public.b2b_attempt_heartbeat(UUID, UUID, UUID),
  public.b2b_autosave(UUID, UUID, UUID, UUID, INTEGER, TEXT, TEXT, JSONB, JSONB),
  public.b2b_runner_question(UUID, UUID, UUID, UUID),
  public.b2b_create_submission(UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, JSONB),
  public.b2b_score_attempt(UUID), public.b2b_finish_attempt(UUID, UUID, UUID, TEXT),
  public.b2b_record_judge_result(UUID, TEXT, JSONB, TEXT, INTEGER, INTEGER, NUMERIC, NUMERIC),
  public.b2b_claim_pending_submissions(INTEGER, UUID[]), public.b2b_expire_attempts()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.b2b_save_question_as(UUID, JSONB), public.b2b_question_for_verify(UUID, UUID),
  public.b2b_record_verification(UUID, UUID, INTEGER, BOOLEAN), public.b2b_start_attempt(UUID, TEXT, UUID, UUID, UUID),
  public.b2b_attempt_state(UUID, UUID, UUID), public.b2b_attempt_heartbeat(UUID, UUID, UUID),
  public.b2b_autosave(UUID, UUID, UUID, UUID, INTEGER, TEXT, TEXT, JSONB, JSONB),
  public.b2b_runner_question(UUID, UUID, UUID, UUID),
  public.b2b_create_submission(UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, JSONB),
  public.b2b_score_attempt(UUID), public.b2b_finish_attempt(UUID, UUID, UUID, TEXT),
  public.b2b_record_judge_result(UUID, TEXT, JSONB, TEXT, INTEGER, INTEGER, NUMERIC, NUMERIC),
  public.b2b_claim_pending_submissions(INTEGER, UUID[]), public.b2b_expire_attempts()
  TO service_role;

-- Browser: staff save questions directly (the function checks the role itself).
REVOKE EXECUTE ON FUNCTION public.b2b_save_question(JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.b2b_save_question(JSONB) TO authenticated, service_role;

-- =============================================
-- Cron (only where pg_cron / pg_net exist; skipped in the embedded test database)
-- =============================================
-- Every minute: end attempts past their deadline. Every 2 minutes: ask b2b-assess to grade queued coding
-- submissions (Judge0), using the same Vault secrets as the evaluation sweep (b2b_project_url, b2b_cron_secret).
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('b2b-expire-attempts', '* * * * *', 'SELECT public.b2b_expire_attempts()');
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
      PERFORM cron.schedule('b2b-grade-pending', '*/2 * * * *', $job$
        SELECT net.http_post(
          url := u.decrypted_secret || '/functions/v1/b2b-assess',
          headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', s.decrypted_secret),
          body := '{"action":"gradePending","limit":10}'::jsonb,
          timeout_milliseconds := 5000)
        FROM vault.decrypted_secrets u, vault.decrypted_secrets s
        WHERE u.name = 'b2b_project_url' AND s.name = 'b2b_cron_secret'
          AND EXISTS (SELECT 1 FROM public.submissions WHERE kind <> 'run' AND status IN ('queued', 'running'))
      $job$);
    END IF;
  END IF;
END
$cron$;
