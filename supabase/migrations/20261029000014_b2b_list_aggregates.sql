-- Aggregates the portals used to compute in the browser from rows capped at PostgREST's max_rows (1000):
--  * the roster's distinct branches / batch years / sections (filter and eligibility pickers), which lost values in
--    colleges with more than 1000 students;
--  * per-role candidate counts on the company roles list, which undercounted past 1000 candidates.
-- SECURITY INVOKER: the students and role_candidates RLS policies still decide what the caller sees (a hiring manager
-- only counts the roles they can view).

CREATE OR REPLACE FUNCTION public.b2b_student_facets(_org_id UUID)
RETURNS JSONB LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'departments', COALESCE((SELECT jsonb_agg(d ORDER BY d) FROM (
        SELECT DISTINCT s.department AS d FROM public.students s
        WHERE s.org_id = _org_id AND NULLIF(btrim(s.department), '') IS NOT NULL) x), '[]'::jsonb),
    'batchYears', COALESCE((SELECT jsonb_agg(y ORDER BY y) FROM (
        SELECT DISTINCT s.batch_year AS y FROM public.students s
        WHERE s.org_id = _org_id AND s.batch_year IS NOT NULL) x), '[]'::jsonb),
    'sections', COALESCE((SELECT jsonb_agg(c ORDER BY c) FROM (
        SELECT DISTINCT s.section AS c FROM public.students s
        WHERE s.org_id = _org_id AND NULLIF(btrim(s.section), '') IS NOT NULL) x), '[]'::jsonb)
  )
$$;

-- { "<job_role_id>": { "total": n, "completed": n } }. "Completed" = past the invite/test stages and not withdrawn,
-- matching the roles list's previous client-side rule.
CREATE OR REPLACE FUNCTION public.b2b_role_counts(_org_id UUID)
RETURNS JSONB LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT COALESCE(jsonb_object_agg(rc.job_role_id, jsonb_build_object(
           'total', rc.total, 'completed', rc.completed)), '{}'::jsonb)
  FROM (
    SELECT r.job_role_id, count(*) AS total,
           count(*) FILTER (WHERE r.stage NOT IN ('invited', 'in_progress', 'withdrawn')) AS completed
    FROM public.role_candidates r WHERE r.org_id = _org_id GROUP BY r.job_role_id
  ) rc
$$;

REVOKE ALL ON FUNCTION public.b2b_student_facets(UUID), public.b2b_role_counts(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.b2b_student_facets(UUID), public.b2b_role_counts(UUID) TO authenticated, service_role;

-- Student memberships per org for the pilot super-admin org list ({ "<org_id>": n }). RLS decides which rows count
-- (super admins see every org; staff only their own).
CREATE OR REPLACE FUNCTION public.b2b_student_counts_by_org()
RETURNS JSONB LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT COALESCE(jsonb_object_agg(m.org_id, m.n), '{}'::jsonb)
  FROM (SELECT org_id, count(*) AS n FROM public.org_memberships WHERE role = 'student' GROUP BY org_id) m
$$;
REVOKE ALL ON FUNCTION public.b2b_student_counts_by_org() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.b2b_student_counts_by_org() TO authenticated, service_role;
