-- R2.1–R2.3 paper uniqueness.
--  * assessments.max_overlap_pct (default 10): the most of a paper any two students in the same drive / role may share.
--  * Draw time (b2b_start_attempt, regenerated from 20261029000028): up to 25 seeded draws, keep the least
--    overlapping; past the target the closest is used and audited ('paper.overlap_exceeded'). Practice not compared.
--  * Pool calculator (b2b_paper_capacity): per pick rule, pool size vs what the target needs, plus the share that
--    hand-picked questions force on everyone; expected pairwise overlap for the paper.
--  * Scheduling gate: a drive can't move to scheduled/live when its pool can't meet the target for the students
--    assigned, unless a super admin overrode it for that drive (super_override_drive_pool).
--  * Exposure (R2.3): questions.exposure_count / last_exposed_at grow with every paper handed out;
--    b2b_retire_overexposed retires an org's own questions past a threshold.
-- Rollback: restore b2b_start_attempt from 20261029000028; DROP the functions and trigger below; DROP COLUMN
-- assessments.max_overlap_pct, questions.exposure_count, questions.last_exposed_at, drives.pool_override_*.

ALTER TABLE public.assessments ADD COLUMN IF NOT EXISTS max_overlap_pct INTEGER NOT NULL DEFAULT 10
  CHECK (max_overlap_pct BETWEEN 1 AND 100);
ALTER TABLE public.questions ADD COLUMN IF NOT EXISTS exposure_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.questions ADD COLUMN IF NOT EXISTS last_exposed_at TIMESTAMPTZ;
ALTER TABLE public.drives ADD COLUMN IF NOT EXISTS pool_override_at TIMESTAMPTZ;
ALTER TABLE public.drives ADD COLUMN IF NOT EXISTS pool_override_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.drives ADD COLUMN IF NOT EXISTS pool_override_note TEXT CHECK (pool_override_note IS NULL OR length(pool_override_note) <= 500);

-- Highest share of _set's questions that any paper already issued in the same window also has (0..1).
CREATE OR REPLACE FUNCTION public._b2b_paper_max_overlap(_set JSONB, _assessment_id UUID, _context TEXT, _context_id UUID)
RETURNS NUMERIC LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH mine AS (
    SELECT array_agg((e->>'question_id')::uuid) AS ids, count(*)::numeric AS n FROM jsonb_array_elements(_set) e
  )
  SELECT COALESCE(max((
      SELECT count(*) FROM jsonb_array_elements(t.question_set) x WHERE (x->>'question_id')::uuid = ANY (mine.ids)
    ) / NULLIF(mine.n, 0)), 0)
  FROM public.attempts t, mine
  WHERE t.assessment_id = _assessment_id AND t.context_type = _context AND t.context_id IS NOT DISTINCT FROM _context_id
$$;

-- Pool calculator, no auth (internal). Mirrors _b2b_build_question_set's filters.
CREATE OR REPLACE FUNCTION public._b2b_paper_capacity(_assessment_id UUID, _batch INTEGER)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a public.assessments;
  s JSONB;
  p JSONB;
  v_si INTEGER := 0;
  v_ri INTEGER;
  v_fixed UUID[] := '{}';
  v_rules JSONB := '[]'::jsonb;
  v_k INTEGER;
  v_n INTEGER;
  v_need INTEGER;
  v_topics TEXT[];
  v_total INTEGER := 0;
  v_expect NUMERIC := 0;
  v_t NUMERIC;
  v_ok BOOLEAN := true;
  v_fixed_share NUMERIC;
BEGIN
  SELECT * INTO a FROM public.assessments WHERE id = _assessment_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'NOT_FOUND'); END IF;
  v_t := a.max_overlap_pct / 100.0;
  -- Hand-picked, servable questions: every student gets them.
  FOR s IN SELECT value FROM jsonb_array_elements(a.sections) LOOP
    IF jsonb_typeof(s->'question_ids') = 'array' THEN
      v_fixed := v_fixed || ARRAY(
        SELECT q.id FROM jsonb_array_elements_text(s->'question_ids') x(id) JOIN public.questions q ON q.id = x.id::uuid
        WHERE q.status = 'verified' AND q.type = s->>'type' AND (q.org_id = a.org_id OR q.org_id IS NULL));
    END IF;
  END LOOP;
  v_total := cardinality(v_fixed);
  FOR s IN SELECT value FROM jsonb_array_elements(a.sections) LOOP
    v_ri := 0;
    IF jsonb_typeof(s->'pick') = 'array' THEN
      FOR p IN SELECT value FROM jsonb_array_elements(s->'pick') LOOP
        v_k := GREATEST(COALESCE((p->>'count')::integer, 1), 0);
        v_topics := COALESCE(ARRAY(SELECT lower(jsonb_array_elements_text(p->'topics'))), '{}');
        SELECT count(*) INTO v_n FROM public.questions q
          WHERE q.status = 'verified' AND q.type = s->>'type' AND (q.org_id = a.org_id OR q.org_id IS NULL)
            AND (p->>'difficulty' IS NULL OR q.difficulty = p->>'difficulty')
            AND (cardinality(v_topics) = 0 OR EXISTS (SELECT 1 FROM unnest(q.topics) t WHERE lower(t) = ANY (v_topics)))
            AND (s->>'type' <> 'coding' OR q.languages && a.languages)
            AND NOT q.id = ANY (v_fixed);
        -- Each rule's own expected overlap (k/n) is held to half the target, leaving room for the retries.
        v_need := CASE WHEN v_k = 0 THEN 0 ELSE GREATEST(v_k, ceil(v_k / (v_t / 2.0))::int) END;
        IF _batch > 1 AND v_n < v_need THEN v_ok := false; END IF;
        IF v_n < v_k THEN v_ok := false; END IF;
        v_total := v_total + v_k;
        IF v_n > 0 THEN v_expect := v_expect + (v_k::numeric * LEAST(v_k, v_n)) / v_n; END IF;
        v_rules := v_rules || jsonb_build_object('section', v_si, 'rule', v_ri, 'title', COALESCE(s->>'title', ''),
          'type', s->>'type', 'difficulty', p->>'difficulty', 'topics', to_jsonb(v_topics), 'count', v_k,
          'pool', v_n, 'needed', v_need, 'ok', v_n >= v_k AND (_batch <= 1 OR v_n >= v_need));
        v_ri := v_ri + 1;
      END LOOP;
    END IF;
    v_si := v_si + 1;
  END LOOP;
  v_fixed_share := CASE WHEN v_total = 0 THEN 0 ELSE cardinality(v_fixed)::numeric / v_total END;
  IF _batch > 1 AND v_fixed_share * 100 > a.max_overlap_pct THEN v_ok := false; END IF;
  IF _batch > 1 AND NOT a.randomize THEN v_ok := false; END IF;
  RETURN jsonb_build_object(
    'ok', true, 'feasible', v_ok, 'batch', _batch, 'target_pct', a.max_overlap_pct, 'paper_size', v_total,
    'randomize', a.randomize,
    'expected_overlap_pct', CASE WHEN v_total = 0 THEN 0 ELSE round((v_expect + cardinality(v_fixed)) * 100 / v_total, 1) END,
    'fixed', jsonb_build_object('count', cardinality(v_fixed), 'shared_pct', round(v_fixed_share * 100, 1),
                                'ok', _batch <= 1 OR v_fixed_share * 100 <= a.max_overlap_pct),
    'rules', v_rules);
END;
$$;

-- For the builder and drive screens: staff of the assessment's org (or super admins).
CREATE OR REPLACE FUNCTION public.b2b_paper_capacity(_assessment_id UUID, _batch INTEGER)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_org UUID;
BEGIN
  SELECT org_id INTO v_org FROM public.assessments WHERE id = _assessment_id;
  IF v_org IS NULL OR NOT (public.is_super_admin() OR public.is_org_staff(v_org)) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN public._b2b_paper_capacity(_assessment_id, GREATEST(COALESCE(_batch, 1), 1));
END;
$$;

-- Scheduling gate.
CREATE OR REPLACE FUNCTION public.b2b_drives_pool_gate()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_batch INTEGER;
  cap JSONB;
BEGIN
  IF NEW.assessment_id IS NULL OR NEW.pool_override_at IS NOT NULL OR NEW.status NOT IN ('scheduled', 'live')
     OR (TG_OP = 'UPDATE' AND OLD.status IN ('scheduled', 'live') AND OLD.assessment_id IS NOT DISTINCT FROM NEW.assessment_id) THEN
    RETURN NEW;
  END IF;
  SELECT count(*) INTO v_batch FROM public.drive_assignments WHERE drive_id = NEW.id AND status <> 'removed';
  cap := public._b2b_paper_capacity(NEW.assessment_id, v_batch);
  IF NOT COALESCE((cap->>'feasible')::boolean, true) THEN
    RAISE EXCEPTION 'POOL_TOO_SMALL: the question pool can''t keep % students'' papers within % percent overlap', v_batch, cap->>'target_pct'
      USING ERRCODE = 'check_violation', DETAIL = cap::text;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS drives_pool_gate ON public.drives;
CREATE TRIGGER drives_pool_gate BEFORE INSERT OR UPDATE OF status, assessment_id ON public.drives
  FOR EACH ROW EXECUTE FUNCTION public.b2b_drives_pool_gate();

-- Super admin override for one drive (audited through audit_drives). _note NULL clears it.
CREATE OR REPLACE FUNCTION public.super_override_drive_pool(_drive_id UUID, _note TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'insufficient_privilege'; END IF;
  UPDATE public.drives SET
    pool_override_at = CASE WHEN _note IS NULL THEN NULL ELSE now() END,
    pool_override_by = CASE WHEN _note IS NULL THEN NULL ELSE auth.uid() END,
    pool_override_note = NULLIF(btrim(_note), '')
  WHERE id = _drive_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'NOT_FOUND'); END IF;
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- R2.3: retire an org's own questions that have been handed out at least _threshold times.
CREATE OR REPLACE FUNCTION public.b2b_retire_overexposed(_org_id UUID, _threshold INTEGER)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE n INTEGER;
BEGIN
  IF NOT (public.is_super_admin() OR public.is_org_editor(_org_id)) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _threshold IS NULL OR _threshold < 1 THEN RAISE EXCEPTION 'INVALID_THRESHOLD' USING ERRCODE = 'check_violation'; END IF;
  UPDATE public.questions SET status = 'retired'
    WHERE org_id = _org_id AND status = 'verified' AND exposure_count >= _threshold;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public._b2b_paper_max_overlap(JSONB, UUID, TEXT, UUID), public._b2b_paper_capacity(UUID, INTEGER),
  public.b2b_drives_pool_gate() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.b2b_paper_capacity(UUID, INTEGER), public.super_override_drive_pool(UUID, TEXT),
  public.b2b_retire_overexposed(UUID, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.b2b_paper_capacity(UUID, INTEGER), public.super_override_drive_pool(UUID, TEXT),
  public.b2b_retire_overexposed(UUID, INTEGER) TO authenticated;

-- The bank page shows how many papers each question has been in (R2.3).
CREATE OR REPLACE FUNCTION public.b2b_bank_page(
  _org_id UUID, _owner TEXT, _type TEXT, _search TEXT, _page INTEGER, _page_size INTEGER
) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_owner TEXT := CASE WHEN _org_id IS NULL THEN 'global' WHEN _owner IN ('ours', 'global') THEN _owner ELSE 'all' END;
  v_type TEXT := CASE WHEN _type IN ('coding', 'mcq') THEN _type ELSE NULL END;
  -- Escape LIKE wildcards so a search for "100%" or "a_b" means those characters.
  v_like TEXT := CASE WHEN NULLIF(btrim(_search), '') IS NULL THEN NULL
                      ELSE '%' || replace(replace(replace(lower(btrim(_search)), '\', '\\'), '%', '\%'), '_', '\_') || '%' END;
  v_size INTEGER := LEAST(GREATEST(COALESCE(_page_size, 50), 1), 200);
  v_offset INTEGER := (GREATEST(COALESCE(_page, 1), 1) - 1) * LEAST(GREATEST(COALESCE(_page_size, 50), 1), 200);
  v_out JSONB;
BEGIN
  WITH scope AS (
    SELECT q.* FROM public.questions q
    WHERE CASE v_owner
            WHEN 'global' THEN q.org_id IS NULL
            WHEN 'ours' THEN q.org_id = _org_id
            ELSE (q.org_id = _org_id OR q.org_id IS NULL)
          END
  ),
  hits AS (
    SELECT s.* FROM scope s
    WHERE (v_type IS NULL OR s.type = v_type)
      AND (v_like IS NULL OR lower(s.title) LIKE v_like
           OR EXISTS (SELECT 1 FROM unnest(s.topics) t WHERE lower(t) LIKE v_like))
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM hits),
    'rows', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', h.id, 'org_id', h.org_id, 'type', h.type, 'title', h.title, 'statement', h.statement,
        'difficulty', h.difficulty, 'topics', h.topics, 'category', h.category, 'languages', h.languages,
        'starter_code', h.starter_code, 'constraints', h.constraints, 'time_limit_ms', h.time_limit_ms,
        'memory_limit_kb', h.memory_limit_kb, 'options', h.options, 'answer', h.answer, 'multi_select', h.multi_select,
        'explanation', h.explanation, 'points', h.points, 'status', h.status, 'source', h.source, 'version', h.version,
        'created_at', h.created_at, 'exposure_count', h.exposure_count) ORDER BY h.created_at DESC, h.id DESC)
      FROM (SELECT * FROM hits ORDER BY created_at DESC, id DESC OFFSET v_offset LIMIT v_size) h), '[]'::jsonb),
    'counts', (SELECT jsonb_build_object(
      'verified', count(*) FILTER (WHERE s.status = 'verified'),
      'draft', count(*) FILTER (WHERE s.status = 'draft'),
      'retired', count(*) FILTER (WHERE s.status = 'retired'),
      'coding', count(*) FILTER (WHERE s.type = 'coding'),
      'mcq', count(*) FILTER (WHERE s.type = 'mcq')) FROM scope s)
  ) INTO v_out;
  RETURN v_out;
END;
$$;

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
  v_paper_candidate JSONB;
  v_overlap NUMERIC;
  v_best_overlap NUMERIC;
  v_try INTEGER;
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
  -- R2.1: a drive / job-role paper must overlap every paper already issued in the same window by at most
  -- assessments.max_overlap_pct. Try up to 25 seeded draws and keep the best; past that the closest one is used and
  -- the shortfall is logged (scheduling already warned: b2b_drives_pool_gate). Practice runs aren't compared.
  IF _context = 'practice' THEN
    v_set := public._b2b_build_question_set(a.id, v_id::text);
  ELSE
    PERFORM pg_advisory_xact_lock(hashtextextended('b2b_paper:' || a.id::text || ':' || _context || ':' || COALESCE(_context_id::text, ''), 0));
    v_best_overlap := 2;
    FOR v_try IN 0..24 LOOP
      v_paper_candidate := public._b2b_build_question_set(a.id, v_id::text || CASE WHEN v_try = 0 THEN '' ELSE ':' || v_try END);
      v_overlap := public._b2b_paper_max_overlap(v_paper_candidate, a.id, _context, _context_id);
      IF v_overlap < v_best_overlap THEN v_set := v_paper_candidate; v_best_overlap := v_overlap; END IF;
      EXIT WHEN v_overlap * 100 <= COALESCE(a.max_overlap_pct, 10);
    END LOOP;
    IF v_best_overlap * 100 > COALESCE(a.max_overlap_pct, 10) THEN
      PERFORM public.b2b_audit(a.org_id, 'paper.overlap_exceeded', 'assessment', a.id::text,
        jsonb_build_object('context', _context, 'context_id', _context_id, 'overlap_pct', round(v_best_overlap * 100, 1),
                           'target_pct', COALESCE(a.max_overlap_pct, 10)));
    END IF;
  END IF;
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

  -- R2.3 exposure: every question handed out counts.
  UPDATE public.questions q SET exposure_count = q.exposure_count + 1, last_exposed_at = now()
    WHERE q.id IN (SELECT (e->>'question_id')::uuid FROM jsonb_array_elements(v_set) e);

  IF _context = 'drive' THEN
    UPDATE public.drive_assignments SET attempt_id = v_id, status = 'in_progress' WHERE id = da.id;
  ELSIF _context = 'job_role' THEN
    UPDATE public.role_candidates SET attempt_id = v_id, started_at = COALESCE(started_at, now()),
      stage = CASE WHEN stage = 'invited' THEN 'in_progress' ELSE stage END WHERE id = rc.id;
  END IF;
  RETURN jsonb_build_object('ok', true, 'attempt_id', v_id, 'session_id', v_attempt.active_session_id, 'resumed', false);
END;
$$;
