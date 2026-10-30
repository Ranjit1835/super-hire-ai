-- R2.7 code playback: everything a reviewer needs to replay how each coding answer was written.
-- The edit log (edit_history, written by autosave since V1) is returned in order with the starter code the editor
-- began from and the final saved answer, so the browser can rebuild the code keystroke by keystroke and check that
-- the replay ends exactly at the saved answer. Staff of the attempt's context only; practice attempts included
-- (the student's TPO may look), the student never.

-- Events per question are capped so one pathological log can't produce an unbounded response.
CREATE OR REPLACE FUNCTION public.b2b_attempt_code_replay(_attempt_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE a public.attempts; asm public.assessments; v_cap CONSTANT INTEGER := 50000;
BEGIN
  SELECT * INTO a FROM public.attempts WHERE id = _attempt_id;
  IF NOT FOUND OR public.b2b_attempt_access(_attempt_id) IS DISTINCT FROM 'staff' THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO asm FROM public.assessments WHERE id = a.assessment_id;
  RETURN jsonb_build_object(
    'attempt_id', a.id, 'status', a.status, 'started_at', a.started_at, 'submitted_at', a.submitted_at,
    'questions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'question_id', q.id, 'title', q.title,
        'languages', to_jsonb(ARRAY(SELECT l FROM unnest(q.languages) l WHERE l = ANY (asm.languages))),
        'starter_code', q.starter_code,
        'final_language', aa.language, 'final_code', aa.code,
        'events', COALESCE(ev.events, '[]'::jsonb), 'truncated', COALESCE(ev.n, 0) > v_cap
      ) ORDER BY qs.ord)
      FROM jsonb_array_elements(a.question_set) WITH ORDINALITY AS qs(e, ord)
      JOIN public.questions q ON q.id = (qs.e->>'question_id')::uuid AND q.type = 'coding'
      LEFT JOIN public.attempt_answers aa ON aa.attempt_id = a.id AND aa.question_id = q.id
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(x.e ORDER BY x.seq, x.i) FILTER (WHERE x.rn <= v_cap) AS events, count(*) AS n
        FROM (
          SELECT h.seq, el.i, el.e, row_number() OVER (ORDER BY h.seq, el.i) AS rn
          FROM public.edit_history h
          CROSS JOIN LATERAL jsonb_array_elements(h.events) WITH ORDINALITY AS el(e, i)
          WHERE h.attempt_id = a.id AND h.question_id = q.id AND h.kind = 'edits'
        ) x
      ) ev ON true
    ), '[]'::jsonb));
END;
$$;

-- The drive results screen knows the drive and the student, not the attempt.
CREATE OR REPLACE FUNCTION public.b2b_drive_code_replay(_drive_id UUID, _student_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_attempt UUID;
BEGIN
  SELECT id INTO v_attempt FROM public.attempts
    WHERE context_type = 'drive' AND context_id = _drive_id AND student_id = _student_id
    ORDER BY created_at DESC LIMIT 1;
  IF v_attempt IS NULL THEN
    -- Same answer for "no attempt" and "not yours", so the call can't probe other orgs' drives.
    IF NOT EXISTS (SELECT 1 FROM public.drives d WHERE d.id = _drive_id AND public.b2b_can_view_context(d.org_id, 'drive', d.id)) THEN
      RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
    END IF;
    RETURN NULL;
  END IF;
  RETURN public.b2b_attempt_code_replay(v_attempt);
END;
$$;

REVOKE ALL ON FUNCTION public.b2b_attempt_code_replay(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.b2b_drive_code_replay(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.b2b_attempt_code_replay(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.b2b_drive_code_replay(UUID, UUID) TO authenticated;
