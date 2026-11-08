-- B35: a drive card showed "Integrity High (100)" while the student's review page said 88. The card took the lowest
-- *stored* score across the assignment's sessions; the coding-test session had none (it never ended: B40), so only
-- the interview's 100 counted. Now:
--   1. b2b-retention `finalize_integrity` (every 10 minutes) scores ended sessions that have no score, with the same
--      rules as the browser's `end` (integrityScore in contracts/proctor-rules.ts).
--   2. Until every session of an assignment is scored, its integrity shows as not scored yet (NULL), not a partial min.

-- Ended sessions with no score yet, oldest first. Service role only.
CREATE OR REPLACE FUNCTION public.b2b_proctor_unscored_sessions(_limit INTEGER)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(jsonb_agg(id ORDER BY ended_at), '[]'::jsonb) FROM (
    SELECT id, ended_at FROM public.proctoring_sessions
    WHERE status = 'ended' AND integrity_score IS NULL
    ORDER BY ended_at NULLS FIRST LIMIT LEAST(GREATEST(COALESCE(_limit, 50), 1), 500)) s
$$;

-- Store a computed score on an ended session that has none. Returns false if it was already scored. Service role only.
CREATE OR REPLACE FUNCTION public.b2b_proctor_store_score(_session_id UUID, _score NUMERIC, _band TEXT, _detail JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE n INTEGER;
BEGIN
  IF _band NOT IN ('high', 'medium', 'low') THEN RAISE EXCEPTION 'BAD_BAND'; END IF;
  UPDATE public.proctoring_sessions
    SET integrity_score = LEAST(100, GREATEST(0, _score)), integrity_band = _band, score_detail = _detail
    WHERE id = _session_id AND status = 'ended' AND integrity_score IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.b2b_proctor_unscored_sessions(INTEGER), public.b2b_proctor_store_score(UUID, NUMERIC, TEXT, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.b2b_proctor_unscored_sessions(INTEGER), public.b2b_proctor_store_score(UUID, NUMERIC, TEXT, JSONB)
  TO service_role;

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
  -- Integrity: the lowest score across this assignment's proctored sessions (coding test and interview), and only
  -- once every one of them is scored (B35): a session still running or not yet scored makes it "not scored yet".
  LEFT JOIN LATERAL (
    SELECT CASE WHEN bool_and(ps.integrity_score IS NOT NULL) THEN min(ps.integrity_score) END AS integrity_score,
           CASE WHEN bool_and(ps.integrity_score IS NOT NULL)
                THEN (array_agg(ps.integrity_band ORDER BY ps.integrity_score ASC))[1] END AS integrity_band
    FROM public.proctoring_sessions ps
    WHERE ps.org_id = _org_id
      AND ((x.attempt_id IS NOT NULL AND ps.attempt_id = x.attempt_id)
           OR (x.interview_id IS NOT NULL AND ps.interview_id = x.interview_id))
  ) integ ON true
$$;
