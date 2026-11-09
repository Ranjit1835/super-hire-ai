-- R2.8 plagiarism / similarity (decision D6: Dolos).
-- Coding answers in a drive are compared pairwise by the plagiarism worker (services/plagiarism-worker, Dolos on
-- Cloud Run). The database is the queue: a run per (drive, coding question, language); the worker claims a run,
-- gets the submissions, and reports pairs back. Staff see similarity %, the longest shared fragment and the matched
-- regions side by side. MCQ answer patterns (the same wrong choices) are computed here in SQL.
-- Similarity is evidence for a person to review, never an automatic penalty.

CREATE TABLE public.similarity_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  drive_id UUID NOT NULL REFERENCES public.drives(id) ON DELETE CASCADE,
  question_id UUID NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
  language TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed')),
  submissions INTEGER NOT NULL DEFAULT 0,
  tries_left INTEGER NOT NULL DEFAULT 3,
  requested_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  engine TEXT,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX similarity_runs_one_active ON public.similarity_runs (drive_id, question_id, language)
  WHERE status IN ('queued', 'running');
CREATE INDEX similarity_runs_queue ON public.similarity_runs (status, created_at);
CREATE INDEX similarity_runs_drive ON public.similarity_runs (drive_id, created_at DESC);

CREATE TABLE public.similarity_pairs (
  id BIGSERIAL PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES public.similarity_runs(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  drive_id UUID NOT NULL REFERENCES public.drives(id) ON DELETE CASCADE,
  attempt_a UUID NOT NULL REFERENCES public.attempts(id) ON DELETE CASCADE,
  attempt_b UUID NOT NULL REFERENCES public.attempts(id) ON DELETE CASCADE,
  similarity NUMERIC(5, 4) NOT NULL CHECK (similarity BETWEEN 0 AND 1),
  longest INTEGER NOT NULL DEFAULT 0,      -- longest shared fragment, in k-grams
  overlap INTEGER NOT NULL DEFAULT 0,      -- shared k-grams
  -- matched regions: [{ "a": [startRow, startCol, endRow, endCol], "b": [...] }], rows 0-based
  fragments JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(fragments) = 'array'),
  CHECK (attempt_a <> attempt_b),
  UNIQUE (run_id, attempt_a, attempt_b)
);
CREATE INDEX similarity_pairs_drive ON public.similarity_pairs (drive_id, similarity DESC);

ALTER TABLE public.similarity_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.similarity_pairs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read similarity runs" ON public.similarity_runs FOR SELECT TO authenticated
  USING (public.b2b_can_view_context(org_id, 'drive', drive_id));
CREATE POLICY "Staff read similarity pairs" ON public.similarity_pairs FOR SELECT TO authenticated
  USING (public.b2b_can_view_context(org_id, 'drive', drive_id));
-- No client writes: only the SECURITY DEFINER functions below change these tables.

/** Only pairs at or above this similarity are stored (lower ones are noise for a reviewer). */
CREATE OR REPLACE FUNCTION public._b2b_similarity_floor() RETURNS NUMERIC LANGUAGE sql IMMUTABLE AS $$ SELECT 0.30::numeric $$;

-- Queues a run per (coding question, language) with at least two finished answers, unless one is already queued or
-- running, or the last finished run is newer than every answer (nothing changed). Internal; returns runs queued.
CREATE OR REPLACE FUNCTION public._b2b_similarity_enqueue(_drive_id UUID, _by UUID)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE n INTEGER := 0; r RECORD;
BEGIN
  FOR r IN
    SELECT a.org_id, aa.question_id, aa.language, count(*) AS subs, max(aa.updated_at) AS last_change
    FROM public.attempts a
    JOIN public.attempt_answers aa ON aa.attempt_id = a.id
    JOIN public.questions q ON q.id = aa.question_id AND q.type = 'coding'
    WHERE a.context_type = 'drive' AND a.context_id = _drive_id
      AND a.status IN ('submitted', 'expired', 'terminated')
      AND aa.language IS NOT NULL AND length(btrim(COALESCE(aa.code, ''))) > 0
    GROUP BY a.org_id, aa.question_id, aa.language
    HAVING count(*) >= 2
  LOOP
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM public.similarity_runs s
      WHERE s.drive_id = _drive_id AND s.question_id = r.question_id AND s.language = r.language
        AND (s.status IN ('queued', 'running') OR (s.status = 'done' AND s.created_at >= r.last_change)));
    INSERT INTO public.similarity_runs (org_id, drive_id, question_id, language, submissions, requested_by)
      VALUES (r.org_id, _drive_id, r.question_id, r.language, r.subs, _by);
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$;

-- Staff: "check this drive now".
CREATE OR REPLACE FUNCTION public.b2b_request_similarity(_drive_id UUID)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE d public.drives;
BEGIN
  SELECT * INTO d FROM public.drives WHERE id = _drive_id;
  IF NOT FOUND OR NOT (public.is_super_admin() OR public.is_org_editor(d.org_id)) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN public._b2b_similarity_enqueue(_drive_id, auth.uid());
END;
$$;

-- Cron: queue drives whose window ended in the last 7 days and were never checked. Returns runs queued.
CREATE OR REPLACE FUNCTION public.b2b_similarity_enqueue_due()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE n INTEGER := 0; d RECORD;
BEGIN
  FOR d IN
    SELECT dr.id FROM public.drives dr
    WHERE (dr.status = 'closed' OR dr.window_end < now()) AND dr.window_end > now() - interval '7 days'
      AND NOT EXISTS (SELECT 1 FROM public.similarity_runs s WHERE s.drive_id = dr.id)
  LOOP
    n := n + public._b2b_similarity_enqueue(d.id, NULL);
  END LOOP;
  RETURN n;
END;
$$;

-- Worker: claim the oldest queued run (or one stuck in 'running' for 15+ minutes) and get its submissions.
-- Returns NULL when there is nothing to do.
CREATE OR REPLACE FUNCTION public.b2b_similarity_claim(_engine TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.similarity_runs;
BEGIN
  -- Stuck runs (a worker died) go back to the queue, or fail once out of tries.
  UPDATE public.similarity_runs SET
      status = CASE WHEN tries_left > 1 THEN 'queued' ELSE 'failed' END,
      tries_left = tries_left - 1, error = 'worker timed out',
      finished_at = CASE WHEN tries_left > 1 THEN NULL ELSE now() END
    WHERE status = 'running' AND started_at < now() - interval '15 minutes';

  SELECT * INTO r FROM public.similarity_runs WHERE status = 'queued'
    ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN RETURN NULL; END IF;
  UPDATE public.similarity_runs SET status = 'running', started_at = now(), engine = left(_engine, 100)
    WHERE id = r.id;

  RETURN jsonb_build_object(
    'run_id', r.id, 'language', r.language,
    'starter_code', (SELECT q.starter_code->>r.language FROM public.questions q WHERE q.id = r.question_id),
    'submissions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('attempt_id', a.id, 'code', left(aa.code, 100000)) ORDER BY a.id)
      FROM public.attempts a
      JOIN public.attempt_answers aa ON aa.attempt_id = a.id AND aa.question_id = r.question_id
      WHERE a.context_type = 'drive' AND a.context_id = r.drive_id
        AND a.status IN ('submitted', 'expired', 'terminated')
        AND aa.language = r.language AND length(btrim(COALESCE(aa.code, ''))) > 0
    ), '[]'::jsonb));
END;
$$;

-- Worker: report a run. On error the run is retried (3 tries in all). On success its pairs replace the previous
-- results for the same question and language, so staff always see the latest check.
-- _pairs: [{ attempt_a, attempt_b, similarity, longest, overlap, fragments }]
CREATE OR REPLACE FUNCTION public.b2b_similarity_complete(_run_id UUID, _pairs JSONB, _error TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.similarity_runs; n INTEGER;
BEGIN
  SELECT * INTO r FROM public.similarity_runs WHERE id = _run_id FOR UPDATE;
  IF NOT FOUND OR r.status <> 'running' THEN RETURN jsonb_build_object('ok', false, 'reason', 'NOT_RUNNING'); END IF;

  IF _error IS NOT NULL THEN
    UPDATE public.similarity_runs SET
        status = CASE WHEN tries_left > 1 THEN 'queued' ELSE 'failed' END,
        tries_left = tries_left - 1, error = left(_error, 1000),
        finished_at = CASE WHEN tries_left > 1 THEN NULL ELSE now() END
      WHERE id = _run_id;
    RETURN jsonb_build_object('ok', true, 'retry', r.tries_left > 1);
  END IF;
  IF _pairs IS NULL OR jsonb_typeof(_pairs) <> 'array' THEN
    RAISE EXCEPTION 'INVALID_PAIRS' USING ERRCODE = 'check_violation';
  END IF;

  -- Only attempts that belong to this run's drive, each pair once (a < b), above the floor, top 5000.
  INSERT INTO public.similarity_pairs (run_id, org_id, drive_id, attempt_a, attempt_b, similarity, longest, overlap, fragments)
  -- Stored with attempt_a < attempt_b; when the worker sent them the other way round, the regions swap sides too.
  SELECT _run_id, r.org_id, r.drive_id, LEAST(x.a, x.b), GREATEST(x.a, x.b), x.sim, x.longest, x.overlap,
         CASE WHEN x.a < x.b THEN x.fragments ELSE COALESCE((
           SELECT jsonb_agg(jsonb_build_object('a', f->'b', 'b', f->'a') ORDER BY o)
           FROM jsonb_array_elements(x.fragments) WITH ORDINALITY AS fr(f, o)), '[]'::jsonb) END
  FROM (
    SELECT (p->>'attempt_a')::uuid AS a, (p->>'attempt_b')::uuid AS b,
           LEAST(1, GREATEST(0, (p->>'similarity')::numeric))::numeric(5, 4) AS sim,
           GREATEST(0, COALESCE((p->>'longest')::integer, 0)) AS longest,
           GREATEST(0, COALESCE((p->>'overlap')::integer, 0)) AS overlap,
           CASE WHEN jsonb_typeof(p->'fragments') = 'array' THEN p->'fragments' ELSE '[]'::jsonb END AS fragments
    FROM jsonb_array_elements(_pairs) p
  ) x
  WHERE x.a <> x.b AND x.sim >= public._b2b_similarity_floor()
    AND EXISTS (SELECT 1 FROM public.attempts t WHERE t.id = x.a AND t.context_type = 'drive' AND t.context_id = r.drive_id)
    AND EXISTS (SELECT 1 FROM public.attempts t WHERE t.id = x.b AND t.context_type = 'drive' AND t.context_id = r.drive_id)
  ORDER BY x.sim DESC
  LIMIT 5000
  ON CONFLICT (run_id, attempt_a, attempt_b) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;

  DELETE FROM public.similarity_pairs p USING public.similarity_runs s
    WHERE p.run_id = s.id AND s.id <> _run_id
      AND s.drive_id = r.drive_id AND s.question_id = r.question_id AND s.language = r.language;
  UPDATE public.similarity_runs SET status = 'done', finished_at = now(), error = NULL WHERE id = _run_id;
  RETURN jsonb_build_object('ok', true, 'pairs', n);
END;
$$;

-- MCQ answer patterns: pairs of students in a drive who chose the same WRONG option on several questions they both
-- answered. Identical right answers mean nothing; identical wrong ones are what copying leaves behind.
CREATE OR REPLACE FUNCTION public._b2b_mcq_pattern_pairs(_drive_id UUID, _min_shared INTEGER DEFAULT 3)
RETURNS TABLE (attempt_a UUID, attempt_b UUID, shared_wrong INTEGER, wrong_a INTEGER, wrong_b INTEGER)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH wrong AS (
    SELECT a.id AS attempt_id, aa.question_id,
           ARRAY(SELECT x FROM jsonb_array_elements_text(aa.mcq_choice) x ORDER BY x) AS choice
    FROM public.attempts a
    JOIN public.attempt_answers aa ON aa.attempt_id = a.id
    JOIN public.questions q ON q.id = aa.question_id AND q.type = 'mcq'
    WHERE a.context_type = 'drive' AND a.context_id = _drive_id
      AND a.status IN ('submitted', 'expired', 'terminated')
      AND jsonb_typeof(aa.mcq_choice) = 'array' AND jsonb_array_length(aa.mcq_choice) > 0
      AND ARRAY(SELECT x FROM jsonb_array_elements_text(aa.mcq_choice) x ORDER BY x)
          IS DISTINCT FROM ARRAY(SELECT x FROM jsonb_array_elements_text(q.answer) x ORDER BY x)
  ), totals AS (
    SELECT attempt_id, count(*)::integer AS n FROM wrong GROUP BY attempt_id
  )
  SELECT w1.attempt_id, w2.attempt_id, count(*)::integer, t1.n, t2.n
  FROM wrong w1
  JOIN wrong w2 ON w2.question_id = w1.question_id AND w2.choice = w1.choice AND w2.attempt_id > w1.attempt_id
  JOIN totals t1 ON t1.attempt_id = w1.attempt_id
  JOIN totals t2 ON t2.attempt_id = w2.attempt_id
  GROUP BY w1.attempt_id, w2.attempt_id, t1.n, t2.n
  HAVING count(*) >= _min_shared AND count(*)::numeric / LEAST(t1.n, t2.n) >= 0.6
$$;

-- Staff: the drive's similarity overview (latest coding results, run status, MCQ patterns).
CREATE OR REPLACE FUNCTION public.b2b_drive_similarity(_drive_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE d public.drives;
BEGIN
  SELECT * INTO d FROM public.drives WHERE id = _drive_id;
  IF NOT FOUND OR NOT public.b2b_can_view_context(d.org_id, 'drive', d.id) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN jsonb_build_object(
    'runs', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', s.id, 'question', q.title, 'language', s.language, 'status', s.status,
               'submissions', s.submissions, 'created_at', s.created_at, 'finished_at', s.finished_at) ORDER BY s.created_at DESC)
      FROM (SELECT DISTINCT ON (question_id, language) * FROM public.similarity_runs
            WHERE drive_id = _drive_id ORDER BY question_id, language, created_at DESC) s
      JOIN public.questions q ON q.id = s.question_id), '[]'::jsonb),
    'pairs', COALESCE((
      SELECT jsonb_agg(x ORDER BY (x->>'similarity')::numeric DESC) FROM (
        SELECT jsonb_build_object('id', p.id, 'question', q.title, 'language', s.language,
                 'similarity', p.similarity, 'longest', p.longest,
                 'a', jsonb_build_object('student_id', sa.id, 'name', sa.full_name, 'roll_no', sa.roll_no),
                 'b', jsonb_build_object('student_id', sb.id, 'name', sb.full_name, 'roll_no', sb.roll_no)) AS x
        FROM public.similarity_pairs p
        JOIN public.similarity_runs s ON s.id = p.run_id
        JOIN public.questions q ON q.id = s.question_id
        JOIN public.attempts aa ON aa.id = p.attempt_a JOIN public.students sa ON sa.id = aa.student_id
        JOIN public.attempts ab ON ab.id = p.attempt_b JOIN public.students sb ON sb.id = ab.student_id
        WHERE p.drive_id = _drive_id
        ORDER BY p.similarity DESC LIMIT 200) t), '[]'::jsonb),
    'mcq', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('shared_wrong', m.shared_wrong, 'wrong_a', m.wrong_a, 'wrong_b', m.wrong_b,
               'a', jsonb_build_object('student_id', sa.id, 'name', sa.full_name, 'roll_no', sa.roll_no),
               'b', jsonb_build_object('student_id', sb.id, 'name', sb.full_name, 'roll_no', sb.roll_no))
             ORDER BY m.shared_wrong DESC)
      FROM (SELECT * FROM public._b2b_mcq_pattern_pairs(_drive_id) ORDER BY shared_wrong DESC LIMIT 100) m
      JOIN public.attempts aa ON aa.id = m.attempt_a JOIN public.students sa ON sa.id = aa.student_id
      JOIN public.attempts ab ON ab.id = m.attempt_b JOIN public.students sb ON sb.id = ab.student_id), '[]'::jsonb));
END;
$$;

-- Staff: one pair side by side (both answers and the matched regions).
CREATE OR REPLACE FUNCTION public.b2b_similarity_pair(_pair_id BIGINT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE p public.similarity_pairs; s public.similarity_runs;
BEGIN
  SELECT * INTO p FROM public.similarity_pairs WHERE id = _pair_id;
  IF NOT FOUND OR NOT public.b2b_can_view_context(p.org_id, 'drive', p.drive_id) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO s FROM public.similarity_runs WHERE id = p.run_id;
  RETURN jsonb_build_object(
    'id', p.id, 'similarity', p.similarity, 'longest', p.longest, 'language', s.language, 'fragments', p.fragments,
    'question', (SELECT title FROM public.questions WHERE id = s.question_id),
    'a', (SELECT jsonb_build_object('name', st.full_name, 'roll_no', st.roll_no, 'code', aa.code)
          FROM public.attempts a JOIN public.students st ON st.id = a.student_id
          LEFT JOIN public.attempt_answers aa ON aa.attempt_id = a.id AND aa.question_id = s.question_id
          WHERE a.id = p.attempt_a),
    'b', (SELECT jsonb_build_object('name', st.full_name, 'roll_no', st.roll_no, 'code', aa.code)
          FROM public.attempts a JOIN public.students st ON st.id = a.student_id
          LEFT JOIN public.attempt_answers aa ON aa.attempt_id = a.id AND aa.question_id = s.question_id
          WHERE a.id = p.attempt_b));
END;
$$;

REVOKE ALL ON FUNCTION public._b2b_similarity_enqueue(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._b2b_mcq_pattern_pairs(UUID, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.b2b_similarity_enqueue_due() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.b2b_similarity_claim(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.b2b_similarity_complete(UUID, JSONB, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.b2b_similarity_enqueue_due() TO service_role;
GRANT EXECUTE ON FUNCTION public.b2b_similarity_claim(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.b2b_similarity_complete(UUID, JSONB, TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.b2b_request_similarity(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.b2b_drive_similarity(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.b2b_similarity_pair(BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.b2b_request_similarity(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.b2b_drive_similarity(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.b2b_similarity_pair(BIGINT) TO authenticated;
