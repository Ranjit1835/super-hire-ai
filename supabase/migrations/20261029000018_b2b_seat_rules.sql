-- R1.3 seat cap on every path + R1.4 no seat recycling.
--  * A student holds a seat while not deactivated, and keeps holding it after deactivation once seat_locked_at is set
--    (stamped at their first counted session, R1.5). Only a super admin can free a locked seat (super_free_seat).
--  * students_seat_cap (BEFORE INSERT / UPDATE): when a row starts holding a seat, lock the organisation row and
--    re-count, so two TPO actions at the same moment can't pass the cap. Covers single add, reactivation and import.
--  * Org admins can't clear seat_locked_at or delete a student whose seat is locked.
--  * b2b_import_students counts seats with the same helper (body otherwise unchanged from 20261021000008).
-- Rollback: DROP TRIGGER students_seat_cap ON public.students; DROP FUNCTION public.b2b_students_seat_cap(), public.b2b_take_seat_check(uuid),
-- public.super_free_seat(uuid), public.b2b_seats_used(uuid); ALTER TABLE public.students DROP COLUMN seat_locked_at;
-- restore b2b_import_students from 20261021000008_b2b_v1_college.sql.

ALTER TABLE public.students ADD COLUMN IF NOT EXISTS seat_locked_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.b2b_seats_used(_org_id UUID)
RETURNS INTEGER LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT count(*)::int FROM public.students
  WHERE org_id = _org_id AND (status <> 'deactivated' OR seat_locked_at IS NOT NULL)
$$;
REVOKE ALL ON FUNCTION public.b2b_seats_used(UUID) FROM PUBLIC, anon, authenticated;

-- Locks the organisation row (serialising seat changes per org), then returns whether one more seat fits.
-- Definer: TPOs can't lock or count rows themselves. A fresh snapshot per statement means the count sees every
-- committed seat once the lock is held.
CREATE OR REPLACE FUNCTION public.b2b_take_seat_check(_org_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_limit INTEGER;
BEGIN
  -- Callable through the trigger by the org's own staff; service-role functions have no auth.uid().
  IF auth.uid() IS NOT NULL AND NOT (public.is_org_staff(_org_id) OR public.is_super_admin()) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT seat_limit INTO v_limit FROM public.organizations WHERE id = _org_id FOR UPDATE;
  RETURN v_limit IS NULL OR public.b2b_seats_used(_org_id) < v_limit;
END;
$$;
REVOKE ALL ON FUNCTION public.b2b_take_seat_check(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.b2b_take_seat_check(UUID) TO authenticated;  -- the invoker trigger below calls it

-- Invoker on purpose (like students_user_id_guard): current_user is the caller, so direct REST writes by staff
-- ('authenticated') are told apart from service-role functions.
CREATE OR REPLACE FUNCTION public.b2b_students_seat_cap()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_staff BOOLEAN := current_user = 'authenticated' AND NOT public.is_super_admin();
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.seat_locked_at IS NOT NULL AND v_staff THEN
      RAISE EXCEPTION 'SEAT_LOCKED: this student has used their seat; deactivate them instead' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.seat_locked_at IS NOT NULL AND NEW.seat_locked_at IS NULL AND v_staff THEN
    RAISE EXCEPTION 'SEAT_LOCKED: only HiResume can free a used seat' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (NEW.status <> 'deactivated' OR NEW.seat_locked_at IS NOT NULL)
     AND NOT (TG_OP = 'UPDATE' AND (OLD.status <> 'deactivated' OR OLD.seat_locked_at IS NOT NULL)) THEN
    IF NOT public.b2b_take_seat_check(NEW.org_id) THEN
      RAISE EXCEPTION 'SEAT_LIMIT: all seats are in use' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS students_seat_cap ON public.students;
CREATE TRIGGER students_seat_cap BEFORE INSERT OR UPDATE OF status, seat_locked_at OR DELETE ON public.students
  FOR EACH ROW EXECUTE FUNCTION public.b2b_students_seat_cap();

-- Super admin only: free a used seat (the student must be deactivated first). Audited by audit_students.
CREATE OR REPLACE FUNCTION public.super_free_seat(_student_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE s public.students;
BEGIN
  IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'insufficient_privilege'; END IF;
  SELECT * INTO s FROM public.students WHERE id = _student_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'NOT_FOUND'); END IF;
  IF s.status <> 'deactivated' THEN RETURN jsonb_build_object('ok', false, 'reason', 'STILL_ACTIVE'); END IF;
  UPDATE public.students SET seat_locked_at = NULL WHERE id = _student_id;
  RETURN jsonb_build_object('ok', true, 'seats_used', public.b2b_seats_used(s.org_id));
END;
$$;
REVOKE ALL ON FUNCTION public.super_free_seat(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.super_free_seat(UUID) TO authenticated;

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
  -- Seats include deactivated students who already used one (R1.4); same rule as the students_seat_cap trigger.
  v_seats_used := public.b2b_seats_used(_org_id);

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
