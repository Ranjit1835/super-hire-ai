-- Track C — interview V1 (proposed migration; applies after 20261021000008).
-- Drive and job-role interviews on top of the pilot's b2b_interviews / b2b_interview_turns / b2b_evaluations.
-- Every write path is a service-role function that takes the acting user (_actor), re-checks it, and records it for
-- the audit triggers. Staff read interviews, turns, evaluations and the new notes through RLS.
--
--   1. schema: interviews without a module (job roles), template snapshot, one interview per subject + context,
--      staff-only notes (per-turn judgement, AI-assisted answer signals, injection attempts, voice problems, latency)
--   2. subject paths: context (authorise + what the template needs), create (idempotent), load, opening, turn,
--      finish, note, Gemini Live spike check
--   3. evaluation: input for the evaluator, dimension scores, sweep split by evaluator version
--   4. student helper for the drive page: the finished coding attempt to walk through
--
-- Credits: drives are included in the college plan (no credit); job-role sessions are charged by track E when the
-- candidate's session completes. Nothing here charges credits.

-- =============================================
-- 1. Schema
-- =============================================
-- Job roles may have no interview module (their template comes from the skills matrix).
ALTER TABLE public.b2b_interviews ALTER COLUMN module_id DROP NOT NULL;
ALTER TABLE public.b2b_interviews ALTER COLUMN module_version DROP NOT NULL;
ALTER TABLE public.b2b_interviews
  ADD COLUMN template JSONB CHECK (template IS NULL OR jsonb_typeof(template) = 'object'),
  ADD CONSTRAINT b2b_interviews_module_required CHECK (kind IN ('drive', 'job_role') OR module_id IS NOT NULL);
ALTER TABLE public.b2b_evaluations ALTER COLUMN module_id DROP NOT NULL;

-- One interview per subject per drive / job role (a cancelled one, with no answers, can be restarted).
CREATE UNIQUE INDEX idx_b2b_interviews_one_per_context ON public.b2b_interviews(user_id, kind, context_id)
  WHERE kind IN ('drive', 'job_role') AND status <> 'cancelled';

-- Staff-only notes. Candidates can read their own interview row and transcript, so anything that reveals a judgement
-- (in-turn rating, AI-assisted answer signals, integrity events) lives here instead.
CREATE TABLE public.b2b_interview_notes (
  id BIGSERIAL PRIMARY KEY,
  interview_id UUID NOT NULL,
  org_id UUID NOT NULL,
  turn_index INTEGER CHECK (turn_index IS NULL OR turn_index >= 1),
  kind TEXT NOT NULL CHECK (kind IN ('turn', 'integrity', 'audio_issue', 'latency_summary')),
  data JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(data) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (interview_id, org_id) REFERENCES public.b2b_interviews(id, org_id) ON DELETE CASCADE
);
CREATE INDEX idx_b2b_interview_notes ON public.b2b_interview_notes(interview_id, kind, created_at);
ALTER TABLE public.b2b_interview_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read interview notes" ON public.b2b_interview_notes FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.b2b_interviews i WHERE i.id = interview_id
          AND public.b2b_can_view_context(i.org_id, i.kind, i.context_id))
);
-- No write policies: writes only through the functions below.

-- =============================================
-- 2. Subject paths
-- =============================================
-- Who the actor is in a drive / job role and whether they may (still) interview there.
-- { ok, reason?, org_id, student_id, candidate_id, title, first_name, policy, module, job_role, existing }
CREATE OR REPLACE FUNCTION public._b2b_iv_resolve(_actor UUID, _context TEXT, _context_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  d public.drives;
  jr public.job_roles;
  da public.drive_assignments;
  rc public.role_candidates;
  m public.interview_modules;
  v_org UUID;
  v_student UUID;
  v_candidate UUID;
  v_name TEXT;
  v_existing JSONB;
  v_org_status TEXT;
BEGIN
  IF _actor IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'NOT_ELIGIBLE'); END IF;
  SELECT to_jsonb(x) INTO v_existing FROM (
    SELECT i.id AS interview_id, i.status::text AS status FROM public.b2b_interviews i
    WHERE i.user_id = _actor AND i.kind = _context AND i.context_id = _context_id AND i.status::text <> 'cancelled'
    ORDER BY i.created_at DESC LIMIT 1) x;

  IF _context = 'drive' THEN
    SELECT * INTO d FROM public.drives WHERE id = _context_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'NOT_FOUND'); END IF;
    v_org := d.org_id;
    SELECT s.student_id INTO v_student FROM public._b2b_subject_ids(_actor, v_org) s;
    SELECT * INTO da FROM public.drive_assignments WHERE drive_id = d.id AND student_id = v_student;
    IF v_student IS NULL OR NOT FOUND OR da.status IN ('removed', 'absent') THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'NOT_ELIGIBLE');
    END IF;
    SELECT full_name INTO v_name FROM public.students WHERE id = v_student;
    IF v_existing IS NULL THEN
      IF d.interview_module_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'NO_INTERVIEW'); END IF;
      IF d.status NOT IN ('scheduled', 'live') THEN RETURN jsonb_build_object('ok', false, 'reason', 'NOT_OPEN'); END IF;
      IF d.window_start IS NOT NULL AND now() < d.window_start THEN RETURN jsonb_build_object('ok', false, 'reason', 'NOT_OPEN_YET'); END IF;
      IF d.window_end IS NOT NULL AND now() >= d.window_end THEN RETURN jsonb_build_object('ok', false, 'reason', 'WINDOW_CLOSED'); END IF;
    END IF;
    SELECT * INTO m FROM public.interview_modules WHERE id = d.interview_module_id;
    IF v_existing IS NULL AND (m.id IS NULL OR NOT m.is_active) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'NO_INTERVIEW');
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
    SELECT full_name INTO v_name FROM public.candidates WHERE id = v_candidate;
    IF v_existing IS NULL THEN
      IF jr.status <> 'open' THEN RETURN jsonb_build_object('ok', false, 'reason', 'NOT_OPEN'); END IF;
      IF rc.invite_expires_at IS NOT NULL AND rc.invite_expires_at <= now() THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'INVITE_EXPIRED');
      END IF;
    END IF;
    IF jr.interview_module_id IS NOT NULL THEN SELECT * INTO m FROM public.interview_modules WHERE id = jr.interview_module_id; END IF;
  ELSE
    RETURN jsonb_build_object('ok', false, 'reason', 'BAD_CONTEXT');
  END IF;

  SELECT status INTO v_org_status FROM public.organizations WHERE id = v_org;
  IF v_existing IS NULL AND v_org_status <> 'active' THEN RETURN jsonb_build_object('ok', false, 'reason', 'ORG_SUSPENDED'); END IF;

  RETURN jsonb_build_object(
    'ok', true, 'org_id', v_org, 'student_id', v_student, 'candidate_id', v_candidate,
    'first_name', NULLIF(split_part(btrim(COALESCE(v_name, '')), ' ', 1), ''),
    'title', CASE WHEN _context = 'drive' THEN d.name ELSE jr.title END,
    'policy', COALESCE(CASE WHEN _context = 'drive' THEN d.proctoring_policy ELSE jr.proctoring_policy END, 'standard'),
    'module', CASE WHEN m.id IS NULL THEN NULL ELSE jsonb_build_object('id', m.id, 'version', m.version, 'spec', m.spec) END,
    'job_role', CASE WHEN _context = 'job_role' THEN jsonb_build_object(
      'skills_matrix', jr.skills_matrix, 'seniority', jr.seniority, 'code_walkthrough', jr.code_walkthrough,
      -- track E may add an interview config column; read it when present
      'interview_config', to_jsonb(jr) -> 'interview_config') END,
    'existing', v_existing);
END;
$$;

-- The actor's finished coding attempt in this context (the given one, or the latest), with the code to walk
-- through: the best graded final (else submit) for a coding question. Never includes hidden tests.
CREATE OR REPLACE FUNCTION public._b2b_iv_walkthrough(_actor UUID, _context TEXT, _context_id UUID, _attempt_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a public.attempts;
  w JSONB;
BEGIN
  SELECT * INTO a FROM public.attempts
    WHERE subject_user_id = _actor AND context_type = _context AND context_id = _context_id
      AND (_attempt_id IS NULL OR id = _attempt_id)
      AND status IN ('submitted', 'expired', 'terminated')
    ORDER BY created_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT jsonb_build_object('attemptId', a.id, 'questionTitle', q.title, 'statement', q.statement,
                            'language', s.language, 'code', s.code, 'passed', s.passed, 'total', s.total)
    INTO w
    FROM public.submissions s JOIN public.questions q ON q.id = s.question_id
    WHERE s.attempt_id = a.id AND s.kind IN ('final', 'submit') AND q.type = 'coding'
      AND s.code IS NOT NULL AND length(btrim(s.code)) > 0
    ORDER BY (s.kind = 'final') DESC, COALESCE(s.passed, 0) DESC, s.created_at DESC
    LIMIT 1;
  RETURN COALESCE(w, jsonb_build_object('attemptId', a.id, 'questionTitle', NULL));
END;
$$;

-- What startContext needs to build the template. A given attempt must be the actor's own in this context.
CREATE OR REPLACE FUNCTION public.b2b_iv_context(_actor UUID, _context TEXT, _context_id UUID, _attempt_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  r JSONB := public._b2b_iv_resolve(_actor, _context, _context_id);
BEGIN
  IF NOT (r->>'ok')::boolean THEN RETURN r; END IF;
  IF _attempt_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.attempts WHERE id = _attempt_id AND subject_user_id = _actor
      AND context_type = _context AND context_id = _context_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'BAD_ATTEMPT');
  END IF;
  RETURN r || jsonb_build_object('walkthrough', public._b2b_iv_walkthrough(_actor, _context, _context_id, _attempt_id));
END;
$$;

-- Create (or return) the interview. Re-checks everything; serialised per actor; idempotent per subject + context.
CREATE OR REPLACE FUNCTION public.b2b_iv_create(
  _actor UUID, _context TEXT, _context_id UUID, _attempt_id UUID, _template JSONB, _module_spec JSONB,
  _state JSONB, _prompt_version TEXT, _client_meta JSONB
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  r JSONB;
  live public.b2b_interviews;
  v_id UUID;
  v_minutes INTEGER;
  v_attempt UUID;
BEGIN
  IF _actor IS NULL THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'insufficient_privilege'; END IF;
  PERFORM set_config('b2b.actor', _actor::text, true);
  PERFORM pg_advisory_xact_lock(hashtextextended('b2b_start:' || _actor::text, 0));
  PERFORM public.b2b_expire_stale_interviews();
  r := public._b2b_iv_resolve(_actor, _context, _context_id);
  IF NOT (r->>'ok')::boolean THEN RETURN r; END IF;
  IF r->'existing' IS NOT NULL AND jsonb_typeof(r->'existing') = 'object' THEN
    RETURN jsonb_build_object('ok', true, 'interview_id', r->'existing'->>'interview_id', 'resumed', true);
  END IF;
  SELECT * INTO live FROM public.b2b_interviews WHERE user_id = _actor AND status = 'in_progress';
  IF FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'OTHER_IN_PROGRESS', 'interview_id', live.id); END IF;

  v_minutes := LEAST(60, GREATEST(5, COALESCE((_template->>'durationMin')::int, 20)));
  v_attempt := NULLIF(_template->'walkthrough'->>'attemptId', '')::uuid;
  INSERT INTO public.b2b_interviews
    (org_id, user_id, module_id, module_version, module_spec, state, prompt_version, client_meta, deadline_at,
     kind, context_id, attempt_id, student_id, candidate_id, template)
  VALUES
    ((r->>'org_id')::uuid, _actor, (r->'module'->>'id')::uuid, (r->'module'->>'version')::int, _module_spec, _state,
     _prompt_version, COALESCE(_client_meta, '{}'::jsonb), now() + make_interval(mins => v_minutes),
     _context, _context_id, COALESCE(v_attempt, _attempt_id), (r->>'student_id')::uuid, (r->>'candidate_id')::uuid, _template)
  RETURNING id INTO v_id;

  IF _context = 'drive' THEN
    UPDATE public.drive_assignments SET interview_id = v_id
      WHERE drive_id = _context_id AND student_id = (r->>'student_id')::uuid;
  ELSE
    UPDATE public.role_candidates SET interview_id = v_id, started_at = COALESCE(started_at, now()),
      stage = CASE WHEN stage = 'invited' THEN 'in_progress' ELSE stage END
      WHERE job_role_id = _context_id AND candidate_id = (r->>'candidate_id')::uuid;
  END IF;
  RETURN jsonb_build_object('ok', true, 'interview_id', v_id, 'resumed', false);
END;
$$;

-- The subject's own V1 interview: row, transcript, and the result only when results are visible.
CREATE OR REPLACE FUNCTION public.b2b_iv_load(_actor UUID, _interview_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  i public.b2b_interviews;
  v_visible BOOLEAN;
  v_result JSONB;
BEGIN
  SELECT * INTO i FROM public.b2b_interviews WHERE id = _interview_id;
  IF NOT FOUND OR _actor IS NULL OR i.user_id <> _actor OR i.kind NOT IN ('drive', 'job_role') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NOT_FOUND');
  END IF;
  v_visible := COALESCE(public.b2b_results_visible(i.kind, i.context_id), false);
  IF v_visible THEN
    SELECT jsonb_build_object('overall_score', e.overall_score, 'recommendation', e.result->>'recommendation',
                              'dimensions', e.result->'dimensions')
      INTO v_result FROM public.b2b_evaluations e
      WHERE e.interview_id = i.id AND e.status = 'completed' ORDER BY e.completed_at DESC LIMIT 1;
  END IF;
  RETURN jsonb_build_object(
    'ok', true, 'id', i.id, 'org_id', i.org_id, 'kind', i.kind, 'context_id', i.context_id, 'status', i.status::text,
    'end_reason', i.end_reason, 'started_at', i.started_at, 'deadline_at', i.deadline_at, 'server_now', now(),
    'state', i.state, 'template', i.template,
    'policy', COALESCE(CASE i.kind WHEN 'drive' THEN (SELECT proctoring_policy FROM public.drives WHERE id = i.context_id)
                                    ELSE (SELECT proctoring_policy FROM public.job_roles WHERE id = i.context_id) END, 'standard'),
    'first_name', NULLIF(split_part(btrim(COALESCE(
        (SELECT full_name FROM public.students WHERE id = i.student_id),
        (SELECT full_name FROM public.candidates WHERE id = i.candidate_id), '')), ' ', 1), ''),
    'results_visible', v_visible,
    'result', v_result,
    'turns', COALESCE((SELECT jsonb_agg(jsonb_build_object('turn', t.turn_index, 'role', t.role, 'content', t.content,
                                                           'topic', t.topic, 'created_at', t.created_at, 'client_turn_id', t.client_turn_id)
                                        ORDER BY t.turn_index, (t.role = 'student'))
                       FROM public.b2b_interview_turns t WHERE t.interview_id = i.id), '[]'::jsonb));
END;
$$;

CREATE OR REPLACE FUNCTION public._b2b_iv_own(_actor UUID, _interview_id UUID)
RETURNS public.b2b_interviews LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE i public.b2b_interviews;
BEGIN
  SELECT * INTO i FROM public.b2b_interviews WHERE id = _interview_id;
  IF NOT FOUND OR _actor IS NULL OR i.user_id <> _actor OR i.kind NOT IN ('drive', 'job_role') THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN i;
END;
$$;

CREATE OR REPLACE FUNCTION public.b2b_iv_record_opening(_actor UUID, _interview_id UUID, _question TEXT, _meta JSONB, _state JSONB)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM public._b2b_iv_own(_actor, _interview_id);
  PERFORM set_config('b2b.actor', _actor::text, true);
  PERFORM public.b2b_record_opening(_interview_id, _question, COALESCE(_meta, '{}'::jsonb) - 'llm', _state);
END;
$$;

-- One answered turn (pilot write path: ownership, idempotency, turn order) + the staff-only note for it.
CREATE OR REPLACE FUNCTION public.b2b_iv_record_turn(
  _actor UUID, _interview_id UUID, _expected_turn_count INTEGER, _client_turn_id UUID, _answer TEXT, _answer_meta JSONB,
  _answer_topic TEXT, _answer_difficulty TEXT, _next_question TEXT, _next_meta JSONB, _state JSONB, _end_reason TEXT,
  _note JSONB
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  i public.b2b_interviews := public._b2b_iv_own(_actor, _interview_id);
  r JSONB;
BEGIN
  PERFORM set_config('b2b.actor', _actor::text, true);
  r := public.b2b_record_turn(_interview_id, _actor, _expected_turn_count, _client_turn_id, _answer, _answer_meta,
                              _answer_topic, _answer_difficulty, _next_question, COALESCE(_next_meta, '{}'::jsonb) - 'llm',
                              _state, _end_reason);
  IF (r->>'ok')::boolean AND NOT COALESCE((r->>'duplicate')::boolean, false) AND _note IS NOT NULL THEN
    INSERT INTO public.b2b_interview_notes (interview_id, org_id, turn_index, kind, data)
      VALUES (i.id, i.org_id, _expected_turn_count + 1, 'turn', _note);
    IF COALESCE((_note->'injection'->>'detected')::boolean, false) THEN
      INSERT INTO public.b2b_interview_notes (interview_id, org_id, turn_index, kind, data)
        VALUES (i.id, i.org_id, _expected_turn_count + 1, 'integrity',
                jsonb_build_object('type', 'prompt_injection', 'source', 'server', 'patterns', _note->'injection'->'patterns'));
    END IF;
  END IF;
  RETURN r;
END;
$$;

-- The subject ends (or time ran out). No answers yet → cancelled (nothing was charged, so nothing to refund).
CREATE OR REPLACE FUNCTION public.b2b_iv_finish(_actor UUID, _interview_id UUID, _reason TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  i public.b2b_interviews := public._b2b_iv_own(_actor, _interview_id);
  v_answers INTEGER;
BEGIN
  IF _reason NOT IN ('student_ended', 'time_limit') THEN RAISE EXCEPTION 'INVALID_REASON'; END IF;
  PERFORM set_config('b2b.actor', _actor::text, true);
  SELECT * INTO i FROM public.b2b_interviews WHERE id = i.id FOR UPDATE;
  IF i.status::text <> 'in_progress' THEN RETURN jsonb_build_object('ok', true, 'status', i.status::text, 'already', true); END IF;
  SELECT count(*) INTO v_answers FROM public.b2b_interview_turns WHERE interview_id = i.id AND role = 'student';
  IF v_answers = 0 THEN
    UPDATE public.b2b_interviews SET status = 'cancelled', end_reason = 'cancelled', completed_at = now() WHERE id = i.id;
    RETURN jsonb_build_object('ok', true, 'status', 'cancelled');
  END IF;
  UPDATE public.b2b_interviews SET status = 'completed', end_reason = _reason, completed_at = now() WHERE id = i.id;
  RETURN jsonb_build_object('ok', true, 'status', 'completed');
END;
$$;

-- Notes the subject's browser reports: voice problems, client-side integrity events, the latency summary.
CREATE OR REPLACE FUNCTION public.b2b_iv_note(_actor UUID, _interview_id UUID, _kind TEXT, _data JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  i public.b2b_interviews := public._b2b_iv_own(_actor, _interview_id);
BEGIN
  IF _kind NOT IN ('audio_issue', 'integrity', 'latency_summary') THEN RAISE EXCEPTION 'INVALID_KIND'; END IF;
  IF (SELECT count(*) FROM public.b2b_interview_notes WHERE interview_id = i.id AND kind = _kind) >= 200 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'TOO_MANY');
  END IF;
  INSERT INTO public.b2b_interview_notes (interview_id, org_id, kind, data)
    VALUES (i.id, i.org_id, _kind, COALESCE(_data, '{}'::jsonb) || jsonb_build_object('source', 'client'));
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- Gemini Live spike: the subject of the given interview, or (no interview) any staff member / super admin.
CREATE OR REPLACE FUNCTION public.b2b_iv_live_allowed(_actor UUID, _interview_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT _actor IS NOT NULL AND CASE
    WHEN _interview_id IS NOT NULL THEN EXISTS (
      SELECT 1 FROM public.b2b_interviews WHERE id = _interview_id AND user_id = _actor AND status::text = 'in_progress')
    ELSE public.actor_is_super_admin(_actor) OR EXISTS (
      SELECT 1 FROM public.org_memberships WHERE user_id = _actor AND role IN ('org_admin', 'trainer', 'recruiter'))
  END
$$;

-- =============================================
-- 3. Evaluation (service role)
-- =============================================
CREATE OR REPLACE FUNCTION public.b2b_iv_eval_input(_interview_id UUID)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'id', i.id, 'org_id', i.org_id, 'kind', i.kind, 'context_id', i.context_id, 'status', i.status::text,
    'started_at', i.started_at, 'template', i.template, 'user_id', i.user_id,
    'student_id', i.student_id, 'candidate_id', i.candidate_id,
    'names', jsonb_build_array(
      (SELECT full_name FROM public.students WHERE id = i.student_id),
      (SELECT full_name FROM public.candidates WHERE id = i.candidate_id),
      (SELECT full_name FROM public.org_memberships WHERE org_id = i.org_id AND user_id = i.user_id)),
    'institutions', jsonb_build_array((SELECT name FROM public.organizations WHERE id = i.org_id)),
    'turns', COALESCE((SELECT jsonb_agg(jsonb_build_object('turn', t.turn_index, 'role', t.role, 'content', t.content,
                                                           'topic', t.topic, 'meta', t.meta, 'created_at', t.created_at)
                                        ORDER BY t.turn_index, (t.role = 'student'))
                       FROM public.b2b_interview_turns t WHERE t.interview_id = i.id), '[]'::jsonb),
    'notes', COALESCE((SELECT jsonb_agg(jsonb_build_object('kind', n.kind, 'turn', n.turn_index, 'data', n.data) ORDER BY n.id)
                       FROM public.b2b_interview_notes n WHERE n.interview_id = i.id), '[]'::jsonb))
  FROM public.b2b_interviews i WHERE i.id = _interview_id
$$;

-- Replace this interview's dimension scores (0–100) with the latest evaluation's.
CREATE OR REPLACE FUNCTION public.b2b_iv_save_scores(_interview_id UUID, _rows JSONB)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  i public.b2b_interviews;
  v_n INTEGER;
BEGIN
  SELECT * INTO i FROM public.b2b_interviews WHERE id = _interview_id;
  IF NOT FOUND OR i.kind NOT IN ('drive', 'job_role') THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  DELETE FROM public.dimension_scores WHERE source_type = 'interview' AND source_id = i.id;
  INSERT INTO public.dimension_scores (org_id, subject_user_id, student_id, candidate_id, source_type, source_id,
                                       context_type, context_id, dimension, topic, score)
  SELECT i.org_id, i.user_id, i.student_id, i.candidate_id, 'interview', i.id, i.kind, i.context_id,
         r->>'dimension', NULLIF(r->>'topic', ''), LEAST(100, GREATEST(0, (r->>'score')::numeric))
  FROM jsonb_array_elements(COALESCE(_rows, '[]'::jsonb)) r
  WHERE EXISTS (SELECT 1 FROM public.competency_dimensions c WHERE c.key = r->>'dimension')
  ON CONFLICT (source_type, source_id, dimension, topic) DO UPDATE SET score = EXCLUDED.score;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

-- The sweep now runs per evaluator: V1 versions ('interview-v1…') score drive / job-role interviews, the pilot's
-- versions score practice / public-test interviews. Otherwise unchanged (retry policy from 20260924000003).
CREATE OR REPLACE FUNCTION public.b2b_interviews_needing_evaluation(_version TEXT, _org_id UUID DEFAULT NULL, _limit INTEGER DEFAULT 50)
RETURNS TABLE (interview_id UUID) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT i.id FROM public.b2b_interviews i
  JOIN public.organizations o ON o.id = i.org_id
  LEFT JOIN public.b2b_evaluations e ON e.interview_id = i.id AND e.evaluator_version = _version
  WHERE i.status IN ('completed', 'abandoned')
    AND NOT o.is_demo
    AND (_org_id IS NULL OR i.org_id = _org_id)
    AND (i.kind IN ('drive', 'job_role')) = (_version LIKE 'interview-v1%')
    AND EXISTS (SELECT 1 FROM public.b2b_interview_turns t WHERE t.interview_id = i.id AND t.role = 'student')
    AND (e.id IS NULL
         OR (e.status = 'failed' AND e.attempts < 5 AND e.updated_at < now() - interval '5 minutes')
         OR (e.status = 'pending' AND e.updated_at < now() - interval '3 minutes'))
  ORDER BY i.completed_at NULLS LAST
  LIMIT greatest(1, least(_limit, 500))
$$;

-- =============================================
-- 4. Student helper (browser): the finished coding attempt of a drive / job role, for the interview link
-- =============================================
CREATE OR REPLACE FUNCTION public.b2b_my_context_attempt(_context TEXT, _context_id UUID)
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT a.id FROM public.attempts a
  WHERE a.subject_user_id = auth.uid() AND a.context_type = _context AND a.context_id = _context_id
    AND a.status IN ('submitted', 'expired', 'terminated')
  ORDER BY a.created_at DESC LIMIT 1
$$;

-- =============================================
-- Grants
-- =============================================
REVOKE EXECUTE ON FUNCTION
  public._b2b_iv_resolve(UUID, TEXT, UUID), public._b2b_iv_walkthrough(UUID, TEXT, UUID, UUID), public._b2b_iv_own(UUID, UUID),
  public.b2b_iv_context(UUID, TEXT, UUID, UUID),
  public.b2b_iv_create(UUID, TEXT, UUID, UUID, JSONB, JSONB, JSONB, TEXT, JSONB),
  public.b2b_iv_load(UUID, UUID), public.b2b_iv_record_opening(UUID, UUID, TEXT, JSONB, JSONB),
  public.b2b_iv_record_turn(UUID, UUID, INTEGER, UUID, TEXT, JSONB, TEXT, TEXT, TEXT, JSONB, JSONB, TEXT, JSONB),
  public.b2b_iv_finish(UUID, UUID, TEXT), public.b2b_iv_note(UUID, UUID, TEXT, JSONB), public.b2b_iv_live_allowed(UUID, UUID),
  public.b2b_iv_eval_input(UUID), public.b2b_iv_save_scores(UUID, JSONB),
  public.b2b_interviews_needing_evaluation(TEXT, UUID, INTEGER), public.b2b_my_context_attempt(TEXT, UUID)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.b2b_iv_context(UUID, TEXT, UUID, UUID),
  public.b2b_iv_create(UUID, TEXT, UUID, UUID, JSONB, JSONB, JSONB, TEXT, JSONB),
  public.b2b_iv_load(UUID, UUID), public.b2b_iv_record_opening(UUID, UUID, TEXT, JSONB, JSONB),
  public.b2b_iv_record_turn(UUID, UUID, INTEGER, UUID, TEXT, JSONB, TEXT, TEXT, TEXT, JSONB, JSONB, TEXT, JSONB),
  public.b2b_iv_finish(UUID, UUID, TEXT), public.b2b_iv_note(UUID, UUID, TEXT, JSONB), public.b2b_iv_live_allowed(UUID, UUID),
  public.b2b_iv_eval_input(UUID), public.b2b_iv_save_scores(UUID, JSONB),
  public.b2b_interviews_needing_evaluation(TEXT, UUID, INTEGER)
TO service_role;
GRANT EXECUTE ON FUNCTION public.b2b_my_context_attempt(TEXT, UUID) TO authenticated, service_role;


-- =============================================
-- Drive completion (added by the lead when merging): finishing the interview completes the student's drive
-- assignment once the drive's test (if any) is also finished. The analytics status covers the other order.
-- =============================================
CREATE OR REPLACE FUNCTION public._b2b_iv_complete_drive_assignment()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.kind = 'drive' AND NEW.student_id IS NOT NULL AND NEW.status::text IN ('completed', 'abandoned')
     AND OLD.status IS DISTINCT FROM NEW.status THEN
    UPDATE public.drive_assignments da
       SET status = 'completed', completed_at = COALESCE(da.completed_at, now()), interview_id = NEW.id
      FROM public.drives d
     WHERE da.drive_id = NEW.context_id AND da.student_id = NEW.student_id AND d.id = da.drive_id
       AND da.status IN ('assigned', 'in_progress')
       AND (d.assessment_id IS NULL OR EXISTS (
         SELECT 1 FROM public.attempts a WHERE a.context_type = 'drive' AND a.context_id = d.id
           AND a.subject_user_id = NEW.user_id AND a.status IN ('submitted', 'expired', 'terminated')));
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public._b2b_iv_complete_drive_assignment() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_b2b_iv_complete_drive_assignment ON public.b2b_interviews;
CREATE TRIGGER trg_b2b_iv_complete_drive_assignment
  AFTER UPDATE OF status ON public.b2b_interviews
  FOR EACH ROW EXECUTE FUNCTION public._b2b_iv_complete_drive_assignment();
