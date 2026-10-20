-- Track D — college portal (proposed schema; applies after 20261021000005).
-- No new tables: students, drives, drive_assignments, attempts, interviews, proctoring and dimension scores
-- already exist (20261021000002/4). This adds:
--   1. assessments.practice_enabled (practice zone on /learn/v1)
--   2. held_minor enforcement on every students write (not just the import)
--   3. service-role functions for the b2b-college edge function (actor passed, re-authorised, audited):
--      b2b_import_students, b2b_prepare_student_invites, b2b_preview_eligibility, b2b_assign_drive,
--      b2b_release_results, b2b_college_analytics
--   4. student-facing read functions (auth.uid()): b2b_my_drives, b2b_my_practice
--   5. indexes for the analytics query
-- Conventions: SECURITY DEFINER + search_path = ''; every role check COALESCEd; REVOKE then explicit GRANT.

-- =============================================
-- 1. Practice zone flag
-- =============================================
ALTER TABLE public.assessments ADD COLUMN IF NOT EXISTS practice_enabled BOOLEAN NOT NULL DEFAULT false;  -- also added by 20261021000006
CREATE INDEX idx_assessments_practice ON public.assessments(org_id) WHERE practice_enabled AND status = 'ready';

-- =============================================
-- 2. Under-18 students are held, whoever writes the row (import, manual add, edit of DOB)
-- =============================================
CREATE OR REPLACE FUNCTION public.students_hold_minors()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF public.b2b_is_minor(NEW.dob) AND NEW.status IN ('imported', 'invited') THEN
    NEW.status := 'held_minor';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER students_hold_minors BEFORE INSERT OR UPDATE OF dob, status ON public.students
  FOR EACH ROW EXECUTE FUNCTION public.students_hold_minors();

-- =============================================
-- 3. Authorisation helpers (service-role callers pass the actor)
-- =============================================
-- TPO admin of a college (or super admin): import, invite, release results, manage staff.
CREATE OR REPLACE FUNCTION public.actor_is_college_admin(_actor UUID, _org_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(public.actor_is_super_admin(_actor), false)
      OR COALESCE(public.actor_org_role(_actor, _org_id) = 'org_admin', false)
$$;

-- TPO admin or trainer (or super admin): drives, eligibility, assignment, analytics.
CREATE OR REPLACE FUNCTION public.actor_is_college_staff(_actor UUID, _org_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(public.actor_is_super_admin(_actor), false)
      OR COALESCE(public.actor_org_role(_actor, _org_id) IN ('org_admin', 'trainer'), false)
$$;

-- =============================================
-- 3a. Student import with dedupe (merge or skip) and held minors
-- _rows: [{ row, roll_no, full_name, email, phone?, department?, batch_year?, section?, cgpa?, active_backlogs?,
--           tenth_pct?, twelfth_pct?, dob? }]  (zod-validated by the edge function; re-checked here)
-- _commit = false → preview: same answers, nothing written.
-- Returns { created, merged, skipped, heldMinors, duplicates: [{ row, reason, existingStudentId }],
--           errors: [{ row, message }], created_ids: [uuid], merged_ids: [uuid] }
-- =============================================
CREATE OR REPLACE FUNCTION public.b2b_import_students(
  _actor UUID, _org_id UUID, _rows JSONB, _on_duplicate TEXT, _commit BOOLEAN
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  r JSONB;
  v_row INTEGER;
  v_roll TEXT;
  v_email TEXT;
  v_name TEXT;
  v_dob DATE;
  v_by_roll UUID;
  v_by_email UUID;
  v_existing UUID;
  v_reason TEXT;
  v_new_id UUID;
  v_was_status TEXT;
  v_now_status TEXT;
  v_seen_rolls TEXT[] := '{}';
  v_seen_emails TEXT[] := '{}';
  v_created INTEGER := 0;
  v_merged INTEGER := 0;
  v_skipped INTEGER := 0;
  v_minors INTEGER := 0;
  v_dups JSONB := '[]'::jsonb;
  v_errors JSONB := '[]'::jsonb;
  v_created_ids UUID[] := '{}';
  v_merged_ids UUID[] := '{}';
  v_seat_limit INTEGER;
  v_seats_used INTEGER;
  v_type TEXT;
BEGIN
  IF NOT public.actor_is_college_admin(_actor, _org_id) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT type, seat_limit INTO v_type, v_seat_limit FROM public.organizations WHERE id = _org_id;
  IF v_type IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'ORG_NOT_FOUND'); END IF;
  IF v_type = 'company' THEN RETURN jsonb_build_object('ok', false, 'reason', 'WRONG_ORG_TYPE'); END IF;
  IF jsonb_typeof(_rows) <> 'array' OR jsonb_array_length(_rows) > 5000 THEN
    RAISE EXCEPTION 'INVALID_ROWS: expected an array of at most 5000 rows' USING ERRCODE = 'check_violation';
  END IF;
  IF _on_duplicate NOT IN ('merge', 'skip') THEN
    RAISE EXCEPTION 'INVALID_ON_DUPLICATE' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM set_config('b2b.actor', _actor::text, true);
  -- One import at a time per org: the seat count and the dedupe both read a stable roster.
  PERFORM pg_advisory_xact_lock(hashtextextended('org_student_import:' || _org_id::text, 0));
  SELECT count(*) INTO v_seats_used FROM public.students WHERE org_id = _org_id AND status <> 'deactivated';

  FOR r IN SELECT * FROM jsonb_array_elements(_rows) LOOP
    v_row := COALESCE((r->>'row')::integer, 0);
    v_roll := btrim(COALESCE(r->>'roll_no', ''));
    v_email := lower(btrim(COALESCE(r->>'email', '')));
    v_name := btrim(COALESCE(r->>'full_name', ''));

    -- Server-side re-validation (the browser's preview is never trusted).
    IF v_roll = '' OR length(v_roll) > 60 THEN
      v_errors := v_errors || jsonb_build_object('row', v_row, 'message', 'Roll number is missing or too long'); CONTINUE;
    END IF;
    IF v_name = '' OR length(v_name) > 200 THEN
      v_errors := v_errors || jsonb_build_object('row', v_row, 'message', 'Name is missing or too long'); CONTINUE;
    END IF;
    IF v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
      v_errors := v_errors || jsonb_build_object('row', v_row, 'message', 'Email is not valid'); CONTINUE;
    END IF;
    BEGIN
      v_dob := NULLIF(r->>'dob', '')::date;
    EXCEPTION WHEN others THEN
      v_errors := v_errors || jsonb_build_object('row', v_row, 'message', 'Date of birth is not a valid date'); CONTINUE;
    END;

    -- Duplicates inside the file: the first occurrence wins.
    IF lower(v_roll) = ANY (v_seen_rolls) OR v_email = ANY (v_seen_emails) THEN
      v_dups := v_dups || jsonb_build_object('row', v_row, 'reason', 'in_file', 'existingStudentId', NULL);
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;
    v_seen_rolls := v_seen_rolls || lower(v_roll);
    v_seen_emails := v_seen_emails || v_email;

    -- Duplicates against the roster: (org, roll_no) and (org, email).
    SELECT id INTO v_by_roll FROM public.students WHERE org_id = _org_id AND lower(roll_no) = lower(v_roll);
    SELECT id INTO v_by_email FROM public.students WHERE org_id = _org_id AND email = v_email;
    IF v_by_roll IS NOT NULL AND v_by_email IS NOT NULL AND v_by_roll <> v_by_email THEN
      v_errors := v_errors || jsonb_build_object('row', v_row, 'message',
        'Roll number and email belong to two different existing students; fix the row or edit those students first');
      CONTINUE;
    END IF;
    v_existing := COALESCE(v_by_roll, v_by_email);
    IF v_existing IS NOT NULL THEN
      v_reason := CASE WHEN v_by_roll IS NOT NULL AND v_by_email IS NOT NULL THEN 'both'
                       WHEN v_by_roll IS NOT NULL THEN 'roll_no' ELSE 'email' END;
      v_dups := v_dups || jsonb_build_object('row', v_row, 'reason', v_reason, 'existingStudentId', v_existing);
      IF _on_duplicate = 'skip' THEN
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;
      -- Merge: values in the file replace the stored ones; blank cells keep what is stored.
      SELECT status INTO v_was_status FROM public.students WHERE id = v_existing;
      IF _commit THEN
        BEGIN
          UPDATE public.students s SET
            roll_no = v_roll,
            email = v_email,
            full_name = v_name,
            phone = COALESCE(NULLIF(btrim(r->>'phone'), ''), s.phone),
            department = COALESCE(NULLIF(btrim(r->>'department'), ''), s.department),
            batch_year = COALESCE((r->>'batch_year')::integer, s.batch_year),
            section = COALESCE(NULLIF(btrim(r->>'section'), ''), s.section),
            cgpa = COALESCE((r->>'cgpa')::numeric, s.cgpa),
            active_backlogs = COALESCE((r->>'active_backlogs')::integer, s.active_backlogs),
            tenth_pct = COALESCE((r->>'tenth_pct')::numeric, s.tenth_pct),
            twelfth_pct = COALESCE((r->>'twelfth_pct')::numeric, s.twelfth_pct),
            dob = COALESCE(v_dob, s.dob)
          WHERE s.id = v_existing
          RETURNING s.status INTO v_now_status;
        EXCEPTION WHEN check_violation OR unique_violation OR invalid_text_representation OR numeric_value_out_of_range THEN
          v_errors := v_errors || jsonb_build_object('row', v_row, 'message', 'A value is out of range: ' || SQLERRM);
          CONTINUE;
        END;
      ELSE
        v_now_status := CASE WHEN public.b2b_is_minor(COALESCE(v_dob, (SELECT dob FROM public.students WHERE id = v_existing)))
                                  AND v_was_status IN ('imported', 'invited') THEN 'held_minor' ELSE v_was_status END;
      END IF;
      IF v_now_status = 'held_minor' AND v_was_status <> 'held_minor' THEN v_minors := v_minors + 1; END IF;
      v_merged := v_merged + 1;
      v_merged_ids := v_merged_ids || v_existing;
      CONTINUE;
    END IF;

    -- New student.
    IF v_seat_limit IS NOT NULL AND v_seats_used >= v_seat_limit THEN
      v_errors := v_errors || jsonb_build_object('row', v_row, 'message',
        format('Seat limit reached (%s students). Ask HiResume to raise the limit.', v_seat_limit));
      CONTINUE;
    END IF;
    IF _commit THEN
      BEGIN
        INSERT INTO public.students (org_id, roll_no, full_name, email, phone, department, batch_year, section, cgpa,
                                     active_backlogs, tenth_pct, twelfth_pct, dob)
        VALUES (_org_id, v_roll, v_name, v_email, NULLIF(btrim(r->>'phone'), ''), NULLIF(btrim(r->>'department'), ''),
                (r->>'batch_year')::integer, NULLIF(btrim(r->>'section'), ''), (r->>'cgpa')::numeric,
                (r->>'active_backlogs')::integer, (r->>'tenth_pct')::numeric, (r->>'twelfth_pct')::numeric, v_dob)
        RETURNING id, status INTO v_new_id, v_now_status;
      EXCEPTION WHEN check_violation OR unique_violation OR invalid_text_representation OR numeric_value_out_of_range THEN
        v_errors := v_errors || jsonb_build_object('row', v_row, 'message', 'A value is out of range: ' || SQLERRM);
        CONTINUE;
      END;
      v_created_ids := v_created_ids || v_new_id;
    ELSE
      v_now_status := CASE WHEN public.b2b_is_minor(v_dob) THEN 'held_minor' ELSE 'imported' END;
    END IF;
    IF v_now_status = 'held_minor' THEN v_minors := v_minors + 1; END IF;
    v_created := v_created + 1;
    v_seats_used := v_seats_used + 1;
  END LOOP;

  IF _commit THEN
    PERFORM public.b2b_audit(_org_id, 'students.import', 'organization', _org_id::text,
      jsonb_build_object('created', v_created, 'merged', v_merged, 'skipped', v_skipped, 'held_minors', v_minors,
                         'errors', jsonb_array_length(v_errors), 'on_duplicate', _on_duplicate));
  END IF;
  RETURN jsonb_build_object('ok', true, 'created', v_created, 'merged', v_merged, 'skipped', v_skipped,
    'heldMinors', v_minors, 'duplicates', v_dups, 'errors', v_errors,
    'created_ids', to_jsonb(v_created_ids), 'merged_ids', to_jsonb(v_merged_ids));
END;
$$;

-- =============================================
-- 3b. Activation invites for students (token hashes generated by the edge function, aligned with ids)
-- Returns { invites: [{ student_id, invite_id, email, roll_no, full_name, token_index }], skipped: [{ student_id, reason }] }
-- =============================================
CREATE OR REPLACE FUNCTION public.b2b_prepare_student_invites(
  _actor UUID, _org_id UUID, _student_ids UUID[], _token_hashes TEXT[]
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  i INTEGER;
  s public.students;
  v_invite UUID;
  v_out JSONB := '[]'::jsonb;
  v_skipped JSONB := '[]'::jsonb;
BEGIN
  IF NOT public.actor_is_college_admin(_actor, _org_id) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF COALESCE(array_length(_student_ids, 1), 0) <> COALESCE(array_length(_token_hashes, 1), 0)
     OR COALESCE(array_length(_student_ids, 1), 0) > 5000 THEN
    RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM set_config('b2b.actor', _actor::text, true);

  FOR i IN 1 .. COALESCE(array_length(_student_ids, 1), 0) LOOP
    SELECT * INTO s FROM public.students WHERE id = _student_ids[i] AND org_id = _org_id FOR UPDATE;
    IF NOT FOUND THEN
      v_skipped := v_skipped || jsonb_build_object('student_id', _student_ids[i], 'reason', 'NOT_FOUND'); CONTINUE;
    END IF;
    IF s.status IN ('active', 'deactivated', 'held_minor') OR s.user_id IS NOT NULL THEN
      v_skipped := v_skipped || jsonb_build_object('student_id', s.id,
        'reason', CASE WHEN s.user_id IS NOT NULL THEN 'ACTIVE' ELSE upper(s.status) END);
      CONTINUE;
    END IF;
    -- A new link replaces any live one for this student (or a stale one for the same email / roll number).
    UPDATE public.org_invites SET status = 'revoked'
      WHERE org_id = _org_id AND status = 'pending' AND role = 'student'
        AND (student_id = s.id OR email = s.email OR lower(roll_no) = lower(s.roll_no));
    BEGIN
      INSERT INTO public.org_invites (org_id, full_name, email, roll_no, role, student_id, token_hash, invited_by)
        VALUES (_org_id, s.full_name, s.email, s.roll_no, 'student', s.id, _token_hashes[i], _actor)
        RETURNING id INTO v_invite;
    EXCEPTION WHEN unique_violation THEN
      v_skipped := v_skipped || jsonb_build_object('student_id', s.id, 'reason', 'EMAIL_OR_ROLL_IN_USE');
      CONTINUE;
    END;
    UPDATE public.students SET status = 'invited' WHERE id = s.id AND status = 'imported';
    v_out := v_out || jsonb_build_object('student_id', s.id, 'invite_id', v_invite, 'email', s.email, 'roll_no', s.roll_no,
                                         'full_name', s.full_name, 'token_index', i);
  END LOOP;
  RETURN jsonb_build_object('invites', v_out, 'skipped', v_skipped);
END;
$$;

-- =============================================
-- 3c. Eligibility (one definition, used by preview and assignment)
-- _elig: { departments: [], batch_years: [], sections: [], min_cgpa, max_backlogs, min_tenth_pct, min_twelfth_pct }
-- Empty / missing filters match everyone. Missing marks fail a minimum (unknown ≠ eligible);
-- a missing backlog count is treated as 0 (sheets leave the cell blank when there are none).
-- Only students who can take a drive: not deactivated, not held as minors.
-- =============================================
CREATE OR REPLACE FUNCTION public.b2b_eligible_student_ids(_org_id UUID, _elig JSONB)
RETURNS SETOF UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT s.id FROM public.students s
  WHERE s.org_id = _org_id
    AND s.status IN ('imported', 'invited', 'active')
    AND (COALESCE(jsonb_array_length(_elig->'departments'), 0) = 0
         OR lower(s.department) IN (SELECT lower(btrim(x)) FROM jsonb_array_elements_text(_elig->'departments') x))
    AND (COALESCE(jsonb_array_length(_elig->'batch_years'), 0) = 0
         OR s.batch_year IN (SELECT x::integer FROM jsonb_array_elements_text(_elig->'batch_years') x))
    AND (COALESCE(jsonb_array_length(_elig->'sections'), 0) = 0
         OR lower(s.section) IN (SELECT lower(btrim(x)) FROM jsonb_array_elements_text(_elig->'sections') x))
    AND (_elig->>'min_cgpa' IS NULL OR s.cgpa >= (_elig->>'min_cgpa')::numeric)
    AND (_elig->>'max_backlogs' IS NULL OR COALESCE(s.active_backlogs, 0) <= (_elig->>'max_backlogs')::integer)
    AND (_elig->>'min_tenth_pct' IS NULL OR s.tenth_pct >= (_elig->>'min_tenth_pct')::numeric)
    AND (_elig->>'min_twelfth_pct' IS NULL OR s.twelfth_pct >= (_elig->>'min_twelfth_pct')::numeric)
$$;

CREATE OR REPLACE FUNCTION public.b2b_preview_eligibility(_actor UUID, _org_id UUID, _elig JSONB)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT public.actor_is_college_staff(_actor, _org_id) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN jsonb_build_object(
    'count', (SELECT count(*) FROM public.b2b_eligible_student_ids(_org_id, COALESCE(_elig, '{}'::jsonb))),
    'sample', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', s.id, 'full_name', s.full_name, 'roll_no', s.roll_no) ORDER BY s.roll_no)
      FROM (SELECT st.id, st.full_name, st.roll_no FROM public.students st
            WHERE st.id IN (SELECT public.b2b_eligible_student_ids(_org_id, COALESCE(_elig, '{}'::jsonb)))
            ORDER BY st.roll_no LIMIT 10) s), '[]'::jsonb));
END;
$$;

-- Assign every eligible student; idempotent (existing assignments are kept, removed ones are not revived).
CREATE OR REPLACE FUNCTION public.b2b_assign_drive(_actor UUID, _drive_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  d public.drives;
  v_eligible INTEGER;
  v_assigned INTEGER;
  v_total INTEGER;
BEGIN
  SELECT * INTO d FROM public.drives WHERE id = _drive_id;
  IF NOT FOUND OR NOT public.actor_is_college_staff(_actor, d.org_id) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF d.status = 'closed' THEN RETURN jsonb_build_object('ok', false, 'reason', 'DRIVE_CLOSED'); END IF;
  PERFORM set_config('b2b.actor', _actor::text, true);
  PERFORM pg_advisory_xact_lock(hashtextextended('drive_assign:' || _drive_id::text, 0));

  SELECT count(*) INTO v_eligible FROM public.b2b_eligible_student_ids(d.org_id, d.eligibility);
  WITH ins AS (
    INSERT INTO public.drive_assignments (drive_id, org_id, student_id)
    SELECT d.id, d.org_id, e FROM public.b2b_eligible_student_ids(d.org_id, d.eligibility) e
    ON CONFLICT (drive_id, student_id) DO NOTHING
    RETURNING 1
  ) SELECT count(*) INTO v_assigned FROM ins;
  SELECT count(*) INTO v_total FROM public.students
    WHERE org_id = d.org_id AND status IN ('imported', 'invited', 'active');
  IF d.status = 'draft' THEN UPDATE public.drives SET status = 'scheduled' WHERE id = d.id; END IF;
  PERFORM public.b2b_audit(d.org_id, 'drive.assign', 'drive', d.id::text,
    jsonb_build_object('assigned', v_assigned, 'eligible', v_eligible));
  RETURN jsonb_build_object('ok', true, 'assigned', v_assigned, 'alreadyAssigned', v_eligible - v_assigned,
                            'ineligible', v_total - v_eligible);
END;
$$;

-- TPO admin releases a drive's results to its students (b2b_results_visible then answers true).
CREATE OR REPLACE FUNCTION public.b2b_release_results(_actor UUID, _drive_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE d public.drives;
BEGIN
  SELECT * INTO d FROM public.drives WHERE id = _drive_id FOR UPDATE;
  IF NOT FOUND OR NOT public.actor_is_college_admin(_actor, d.org_id) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF d.results_release = 'never' THEN RETURN jsonb_build_object('ok', false, 'reason', 'RESULTS_NEVER'); END IF;
  IF d.results_released_at IS NOT NULL THEN RETURN jsonb_build_object('ok', true, 'already', true); END IF;
  PERFORM set_config('b2b.actor', _actor::text, true);
  UPDATE public.drives SET results_released_at = now() WHERE id = _drive_id;
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- =============================================
-- 3d. Analytics
-- =============================================
-- Percentage for one section type from attempts.section_scores. Accepts the shapes track A may write:
--   [{ "type": "coding", "score": 40, "max_score": 50 }, …]   (recommended)
--   { "coding": { "score": 40, "max_score": 50 } }  or  { "coding": 80 }  (already a percentage)
CREATE OR REPLACE FUNCTION public.b2b_section_pct(_sections JSONB, _type TEXT)
RETURNS NUMERIC LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN _sections IS NULL THEN NULL
    WHEN jsonb_typeof(_sections) = 'array' THEN (
      SELECT CASE WHEN sum(COALESCE((e->>'max_score')::numeric, (e->>'max')::numeric)) > 0
                  THEN round(100 * sum((e->>'score')::numeric) / sum(COALESCE((e->>'max_score')::numeric, (e->>'max')::numeric)), 1) END
      FROM jsonb_array_elements(_sections) e WHERE e->>'type' = _type AND e ? 'score')
    WHEN jsonb_typeof(_sections) = 'object' AND jsonb_typeof(_sections->_type) = 'number' THEN round((_sections->>_type)::numeric, 1)
    WHEN jsonb_typeof(_sections) = 'object' AND jsonb_typeof(_sections->_type) = 'object'
         AND COALESCE((_sections->_type->>'max_score')::numeric, (_sections->_type->>'max')::numeric) > 0 THEN
      round(100 * (_sections->_type->>'score')::numeric
            / COALESCE((_sections->_type->>'max_score')::numeric, (_sections->_type->>'max')::numeric), 1)
  END
$$;

-- One row per (student, drive) assignment of the org, with scores, integrity and the effective status.
-- Internal (no grant to clients): callers authorise first.
CREATE OR REPLACE FUNCTION public.b2b_college_result_rows(_org_id UUID, _drive_id UUID)
RETURNS TABLE (
  student_id UUID, drive_id UUID, drive_name TEXT, full_name TEXT, roll_no TEXT, email TEXT, department TEXT,
  batch_year INTEGER, section TEXT, cgpa NUMERIC, active_backlogs INTEGER, student_status TEXT, status TEXT,
  activity_at TIMESTAMPTZ, coding NUMERIC, mcq NUMERIC, assessment NUMERIC, interview NUMERIC, overall NUMERIC,
  integrity_score NUMERIC, integrity_band TEXT, user_id UUID
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT x.student_id, x.drive_id, x.drive_name, x.full_name, x.roll_no, x.email, x.department, x.batch_year,
    x.section, x.cgpa, x.active_backlogs, x.student_status, x.status, x.activity_at, x.coding, x.mcq, x.assessment,
    x.interview,
    -- overall = mean of the parts that exist (assessment %, interview %)
    CASE WHEN x.assessment IS NULL AND x.interview IS NULL THEN NULL
         ELSE round((COALESCE(x.assessment, 0) + COALESCE(x.interview, 0))
                    / ((x.assessment IS NOT NULL)::int + (x.interview IS NOT NULL)::int), 1) END AS overall,
    integ.integrity_score, integ.integrity_band, x.user_id
  FROM (
    SELECT s.id AS student_id, d.id AS drive_id, d.name AS drive_name, s.full_name, s.roll_no, s.email, s.department,
           s.batch_year, s.section, s.cgpa, s.active_backlogs, s.status AS student_status,
           CASE
             WHEN da.status IN ('completed', 'absent') THEN da.status
             -- the test alone completes a drive only when the drive has no interview (or the interview is done)
             WHEN a.status IN ('submitted', 'expired', 'terminated')
                  AND (d.interview_module_id IS NULL OR EXISTS (
                    SELECT 1 FROM public.b2b_interviews i WHERE i.kind = 'drive' AND i.context_id = d.id
                      AND i.student_id = s.id AND i.status::text IN ('completed', 'abandoned'))) THEN 'completed'
             WHEN a.status IN ('submitted', 'expired', 'terminated') THEN 'in_progress'
             WHEN a.status = 'in_progress' OR da.status = 'in_progress' THEN 'in_progress'
             WHEN d.window_end IS NOT NULL AND d.window_end < now() THEN 'absent'
             ELSE 'assigned'
           END AS status,
           COALESCE(a.submitted_at, a.started_at, da.completed_at, da.assigned_at) AS activity_at,
           public.b2b_section_pct(a.section_scores, 'coding') AS coding,
           public.b2b_section_pct(a.section_scores, 'mcq') AS mcq,
           CASE WHEN a.max_score > 0 AND a.score IS NOT NULL THEN round(100 * a.score / a.max_score, 1) END AS assessment,
           iv.interview,
           a.id AS attempt_id, iv.interview_id, s.user_id
    FROM public.drive_assignments da
    JOIN public.drives d ON d.id = da.drive_id AND d.org_id = da.org_id
    JOIN public.students s ON s.id = da.student_id AND s.org_id = da.org_id
    LEFT JOIN public.attempts a ON a.id = COALESCE(da.attempt_id, (
      SELECT a2.id FROM public.attempts a2
      WHERE a2.org_id = da.org_id AND a2.context_type = 'drive' AND a2.context_id = da.drive_id AND a2.student_id = da.student_id
      ORDER BY a2.created_at DESC LIMIT 1))
    LEFT JOIN LATERAL (
      SELECT i.id AS interview_id, round(e.overall_score * 10, 1) AS interview
      FROM public.b2b_interviews i
      JOIN public.b2b_evaluations e ON e.interview_id = i.id AND e.status = 'completed'
      WHERE i.org_id = da.org_id AND (i.id = da.interview_id
            OR (i.kind = 'drive' AND i.context_id = da.drive_id AND (i.student_id = da.student_id OR i.user_id = s.user_id)))
      ORDER BY e.completed_at DESC NULLS LAST LIMIT 1
    ) iv ON true
    WHERE da.org_id = _org_id AND da.status <> 'removed' AND (_drive_id IS NULL OR da.drive_id = _drive_id)
  ) x
  -- Integrity: the lowest score across this assignment's proctored sessions (coding test and interview).
  LEFT JOIN LATERAL (
    SELECT ps.integrity_score, ps.integrity_band FROM public.proctoring_sessions ps
    WHERE ps.org_id = _org_id AND ps.integrity_score IS NOT NULL
      AND ((x.attempt_id IS NOT NULL AND ps.attempt_id = x.attempt_id)
           OR (x.interview_id IS NOT NULL AND ps.interview_id = x.interview_id))
    ORDER BY ps.integrity_score ASC LIMIT 1
  ) integ ON true
$$;

-- _filters (contract AnalyticsFilters): driveId, from, to, departments, batchYears, sections, cgpa [min,max],
-- maxBacklogs, integrityBands, scoreRange [min,max] (overall), status, search.
-- Returns { total, rows (one page), summary: { funnel, byStatus, byDepartment, dimensions } }.
CREATE OR REPLACE FUNCTION public.b2b_college_analytics(
  _actor UUID, _org_id UUID, _filters JSONB, _page INTEGER, _page_size INTEGER, _sort_by TEXT, _sort_dir TEXT
) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  f JSONB := COALESCE(_filters, '{}'::jsonb);
  v_drive UUID := NULLIF(f->>'driveId', '')::uuid;
  v_search TEXT := NULLIF(btrim(f->>'search'), '');
  v_by TEXT := COALESCE(_sort_by, 'full_name');
  v_desc BOOLEAN := lower(COALESCE(_sort_dir, 'asc')) = 'desc';
  v_size INTEGER := LEAST(GREATEST(COALESCE(_page_size, 50), 1), 10000);
  v_offset INTEGER := (GREATEST(COALESCE(_page, 1), 1) - 1) * LEAST(GREATEST(COALESCE(_page_size, 50), 1), 10000);
  v_out JSONB;
BEGIN
  IF NOT public.actor_is_college_staff(_actor, _org_id) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_by NOT IN ('full_name', 'roll_no', 'department', 'batch_year', 'section', 'cgpa', 'status', 'coding', 'mcq',
                  'interview', 'overall', 'integrity_score', 'drive_name') THEN
    v_by := 'full_name';
  END IF;

  WITH base AS (
    SELECT r.* FROM public.b2b_college_result_rows(_org_id, v_drive) r
    WHERE (f->>'from' IS NULL OR r.activity_at >= (f->>'from')::timestamptz)
      AND (f->>'to' IS NULL OR r.activity_at <= (f->>'to')::timestamptz)
      AND (COALESCE(jsonb_array_length(f->'departments'), 0) = 0
           OR lower(r.department) IN (SELECT lower(x) FROM jsonb_array_elements_text(f->'departments') x))
      AND (COALESCE(jsonb_array_length(f->'batchYears'), 0) = 0
           OR r.batch_year IN (SELECT x::integer FROM jsonb_array_elements_text(f->'batchYears') x))
      AND (COALESCE(jsonb_array_length(f->'sections'), 0) = 0
           OR lower(r.section) IN (SELECT lower(x) FROM jsonb_array_elements_text(f->'sections') x))
      AND (f->'cgpa' IS NULL OR r.cgpa BETWEEN (f->'cgpa'->>0)::numeric AND (f->'cgpa'->>1)::numeric)
      AND (f->>'maxBacklogs' IS NULL OR COALESCE(r.active_backlogs, 0) <= (f->>'maxBacklogs')::integer)
      AND (COALESCE(jsonb_array_length(f->'integrityBands'), 0) = 0
           OR r.integrity_band IN (SELECT x FROM jsonb_array_elements_text(f->'integrityBands') x))
      AND (f->'scoreRange' IS NULL OR r.overall BETWEEN (f->'scoreRange'->>0)::numeric AND (f->'scoreRange'->>1)::numeric)
      AND (COALESCE(jsonb_array_length(f->'status'), 0) = 0
           OR r.status IN (SELECT x FROM jsonb_array_elements_text(f->'status') x))
      AND (v_search IS NULL OR r.full_name ILIKE '%' || v_search || '%' OR r.roll_no ILIKE '%' || v_search || '%'
           OR r.email ILIKE '%' || v_search || '%')
  ),
  sorted AS (
    SELECT b.*, row_number() OVER (ORDER BY
      CASE WHEN NOT v_desc THEN CASE v_by WHEN 'cgpa' THEN b.cgpa WHEN 'batch_year' THEN b.batch_year WHEN 'coding' THEN b.coding
        WHEN 'mcq' THEN b.mcq WHEN 'interview' THEN b.interview WHEN 'overall' THEN b.overall
        WHEN 'integrity_score' THEN b.integrity_score END END ASC NULLS LAST,
      CASE WHEN v_desc THEN CASE v_by WHEN 'cgpa' THEN b.cgpa WHEN 'batch_year' THEN b.batch_year WHEN 'coding' THEN b.coding
        WHEN 'mcq' THEN b.mcq WHEN 'interview' THEN b.interview WHEN 'overall' THEN b.overall
        WHEN 'integrity_score' THEN b.integrity_score END END DESC NULLS LAST,
      CASE WHEN NOT v_desc THEN CASE v_by WHEN 'full_name' THEN lower(b.full_name) WHEN 'roll_no' THEN lower(b.roll_no)
        WHEN 'department' THEN lower(b.department) WHEN 'section' THEN lower(b.section) WHEN 'status' THEN b.status
        WHEN 'drive_name' THEN lower(b.drive_name) END END ASC NULLS LAST,
      CASE WHEN v_desc THEN CASE v_by WHEN 'full_name' THEN lower(b.full_name) WHEN 'roll_no' THEN lower(b.roll_no)
        WHEN 'department' THEN lower(b.department) WHEN 'section' THEN lower(b.section) WHEN 'status' THEN b.status
        WHEN 'drive_name' THEN lower(b.drive_name) END END DESC NULLS LAST,
      lower(b.full_name), b.roll_no, b.drive_id) AS rn
    FROM base b
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM base),
    'rows', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'student_id', s.student_id, 'drive_id', s.drive_id, 'drive_name', s.drive_name, 'full_name', s.full_name,
        'roll_no', s.roll_no, 'email', s.email, 'department', s.department, 'batch_year', s.batch_year,
        'section', s.section, 'cgpa', s.cgpa, 'active_backlogs', s.active_backlogs, 'status', s.status,
        'coding', s.coding, 'mcq', s.mcq, 'interview', s.interview, 'overall', s.overall,
        'integrity_band', s.integrity_band, 'integrity_score', s.integrity_score) ORDER BY s.rn)
      FROM sorted s WHERE s.rn > v_offset AND s.rn <= v_offset + v_size), '[]'::jsonb),
    'summary', jsonb_build_object(
      'funnel', (SELECT jsonb_build_object(
          'invited', count(*) FILTER (WHERE b.student_status IN ('invited', 'active')),
          'activated', count(*) FILTER (WHERE b.student_status = 'active'),
          'started', count(*) FILTER (WHERE b.status IN ('in_progress', 'completed')),
          'completed', count(*) FILTER (WHERE b.status = 'completed')) FROM base b),
      'byStatus', (SELECT jsonb_build_object(
          'assigned', count(*) FILTER (WHERE b.status = 'assigned'),
          'in_progress', count(*) FILTER (WHERE b.status = 'in_progress'),
          'completed', count(*) FILTER (WHERE b.status = 'completed'),
          'absent', count(*) FILTER (WHERE b.status = 'absent')) FROM base b),
      'byDepartment', COALESCE((SELECT jsonb_agg(jsonb_build_object('department', g.department, 'students', g.n, 'avg', g.avg)
                                                 ORDER BY g.department)
          FROM (SELECT COALESCE(min(btrim(b.department)), 'Not set') AS department, count(*) AS n, round(avg(b.overall), 1) AS avg
                FROM base b GROUP BY lower(btrim(b.department))) g), '[]'::jsonb),
      'dimensions', COALESCE((SELECT jsonb_agg(jsonb_build_object('dimension', g.dimension, 'avg', g.avg) ORDER BY g.sort)
          FROM (SELECT cd.key AS dimension, cd.sort, round(avg(ds.score), 1) AS avg
                FROM public.dimension_scores ds
                JOIN public.competency_dimensions cd ON cd.key = ds.dimension
                JOIN base b ON ds.context_type = 'drive' AND ds.context_id = b.drive_id
                           AND (ds.student_id = b.student_id OR (ds.student_id IS NULL AND ds.subject_user_id = b.user_id))
                WHERE ds.org_id = _org_id
                GROUP BY cd.key, cd.sort) g), '[]'::jsonb)
    )
  ) INTO v_out;
  RETURN v_out;
END;
$$;

-- =============================================
-- 4. Student-facing reads (from the browser, auth.uid())
-- =============================================
-- My drive assignments with the effective status; scores only once results are visible.
CREATE OR REPLACE FUNCTION public.b2b_my_drives()
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'drive_id', d.id, 'org_id', d.org_id, 'org_name', o.name, 'name', d.name, 'description', d.description,
      'window_start', d.window_start, 'window_end', d.window_end, 'proctoring_policy', d.proctoring_policy,
      'results_release', d.results_release,
      'has_assessment', d.assessment_id IS NOT NULL, 'has_interview', d.interview_module_id IS NOT NULL,
      'resume_task', d.resume_task,
      'status', r.status,
      'attempt_status', CASE WHEN a.id IS NULL THEN NULL ELSE a.status END,
      'results_visible', public.b2b_results_visible('drive', d.id),
      'results', CASE WHEN public.b2b_results_visible('drive', d.id) AND r.status = 'completed' THEN jsonb_build_object(
          'coding', r.coding, 'mcq', r.mcq, 'assessment', r.assessment, 'interview', r.interview, 'overall', r.overall)
        END
    ) ORDER BY d.window_start NULLS LAST, d.created_at), '[]'::jsonb)
  FROM public.students s
  JOIN public.organizations o ON o.id = s.org_id
  JOIN public.drive_assignments da ON da.student_id = s.id AND da.status <> 'removed'
  JOIN public.drives d ON d.id = da.drive_id
  LEFT JOIN public.attempts a ON a.org_id = s.org_id AND a.context_type = 'drive' AND a.context_id = d.id
                              AND a.subject_user_id = s.user_id
  CROSS JOIN LATERAL (
    SELECT rr.* FROM public.b2b_college_result_rows(s.org_id, d.id) rr WHERE rr.student_id = s.id
  ) r
  WHERE s.user_id = auth.uid() AND s.status = 'active' AND d.status <> 'draft'
$$;

-- Practice zone: practice assessments of my colleges and the pooled credit balance.
CREATE OR REPLACE FUNCTION public.b2b_my_practice()
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'org_id', o.id, 'org_name', o.name, 'credits_balance', o.credits_balance,
      'assessments', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', x.id, 'title', x.title, 'duration_min', x.duration_min)
                                                ORDER BY x.title)
                               FROM public.assessments x
                               WHERE x.org_id = o.id AND x.practice_enabled AND x.status = 'ready'), '[]'::jsonb)
    ) ORDER BY o.name), '[]'::jsonb)
  FROM public.students s JOIN public.organizations o ON o.id = s.org_id
  WHERE s.user_id = auth.uid() AND s.status = 'active' AND o.status = 'active'
$$;

-- =============================================
-- 5. Indexes for the analytics query (filters run per org; scores join by drive context)
-- =============================================
CREATE INDEX idx_drive_assignments_org_drive ON public.drive_assignments(org_id, drive_id) WHERE status <> 'removed';
CREATE INDEX idx_attempts_drive_student ON public.attempts(context_id, student_id) WHERE context_type = 'drive';
CREATE INDEX idx_b2b_interviews_drive_student ON public.b2b_interviews(context_id, student_id) WHERE kind = 'drive';
CREATE INDEX idx_b2b_evaluations_interview_done ON public.b2b_evaluations(interview_id, completed_at DESC) WHERE status = 'completed';
CREATE INDEX idx_students_org_status ON public.students(org_id, status);
CREATE INDEX idx_dimension_scores_drive_student ON public.dimension_scores(context_id, student_id) WHERE context_type = 'drive';

-- =============================================
-- Grants
-- =============================================
REVOKE EXECUTE ON FUNCTION
  public.actor_is_college_admin(UUID, UUID), public.actor_is_college_staff(UUID, UUID),
  public.b2b_import_students(UUID, UUID, JSONB, TEXT, BOOLEAN),
  public.b2b_prepare_student_invites(UUID, UUID, UUID[], TEXT[]),
  public.b2b_eligible_student_ids(UUID, JSONB), public.b2b_preview_eligibility(UUID, UUID, JSONB),
  public.b2b_assign_drive(UUID, UUID), public.b2b_release_results(UUID, UUID),
  public.b2b_college_result_rows(UUID, UUID),
  public.b2b_college_analytics(UUID, UUID, JSONB, INTEGER, INTEGER, TEXT, TEXT),
  public.b2b_my_drives(), public.b2b_my_practice(), public.students_hold_minors()
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.actor_is_college_admin(UUID, UUID), public.actor_is_college_staff(UUID, UUID),
  public.b2b_import_students(UUID, UUID, JSONB, TEXT, BOOLEAN),
  public.b2b_prepare_student_invites(UUID, UUID, UUID[], TEXT[]),
  public.b2b_preview_eligibility(UUID, UUID, JSONB),
  public.b2b_assign_drive(UUID, UUID), public.b2b_release_results(UUID, UUID),
  public.b2b_college_analytics(UUID, UUID, JSONB, INTEGER, INTEGER, TEXT, TEXT)
TO service_role;
GRANT EXECUTE ON FUNCTION public.b2b_my_drives(), public.b2b_my_practice() TO authenticated;
GRANT EXECUTE ON FUNCTION public.b2b_section_pct(JSONB, TEXT) TO authenticated, service_role;
