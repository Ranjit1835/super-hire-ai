-- Question bank paging. The bank page used to download the newest 1000 questions and filter them in the browser, so
-- older questions (and the header counts) silently disappeared past 1000. This pages, filters and counts in the
-- database. SECURITY INVOKER: the "Read questions" RLS policy still decides what the caller can see.
--
-- _org_id NULL = the global bank. _owner: 'all' (own + global), 'ours', 'global'. _type: 'all', 'coding', 'mcq'.
-- _search matches the title or any topic, case-insensitive substring. Counts cover the scope (org + owner) and
-- ignore type and search, so the header always describes the whole bank.
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
        'created_at', h.created_at) ORDER BY h.created_at DESC, h.id DESC)
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

REVOKE ALL ON FUNCTION public.b2b_bank_page(UUID, TEXT, TEXT, TEXT, INTEGER, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.b2b_bank_page(UUID, TEXT, TEXT, TEXT, INTEGER, INTEGER) TO authenticated, service_role;

-- Paging order for the bank page and the builder's verified pool.
CREATE INDEX IF NOT EXISTS idx_questions_org_created ON public.questions (org_id, created_at DESC, id DESC);
