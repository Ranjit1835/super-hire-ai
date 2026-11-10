-- The repeat check must see every question, not only the ones on the requested topic: on 2026-11-10 "operating
-- systems" missed a seed question tagged "os" and the generator wrote it again. b2b_question_digest_as now returns all
-- non-retired questions of the type in the actor's scope (own org + global bank, at most 3000, newest first) with their
-- options and an on_topic flag; the prompt's "avoid these" list still uses only the on-topic ones.
-- Rollback: re-run b2b_question_digest_as from 20261110000003_b2b_question_digest.sql.

CREATE OR REPLACE FUNCTION public.b2b_question_digest_as(_actor UUID, _org_id UUID, _type TEXT, _topic TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_topic TEXT := lower(btrim(coalesce(_topic, '')));
BEGIN
  IF _org_id IS NULL AND NOT public.actor_is_super_admin(_actor) THEN RETURN '[]'::jsonb; END IF;
  IF _org_id IS NOT NULL AND NOT public.actor_is_org_editor(_actor, _org_id) THEN RETURN '[]'::jsonb; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object('title', q.title, 'statement', left(q.statement, 600), 'options', q.options,
                                        'on_topic', q.on_topic) ORDER BY q.created_at DESC)
    FROM (
      SELECT title, statement, options, created_at,
             (v_topic = '' OR EXISTS (SELECT 1 FROM unnest(q.topics) t WHERE lower(t) = v_topic)
              OR q.title ILIKE '%' || v_topic || '%' OR q.statement ILIKE '%' || v_topic || '%') AS on_topic
      FROM public.questions q
      WHERE q.type = _type AND q.status <> 'retired' AND (q.org_id IS NULL OR q.org_id = _org_id)
      ORDER BY q.created_at DESC
      LIMIT 3000
    ) q), '[]'::jsonb);
END $$;
REVOKE EXECUTE ON FUNCTION public.b2b_question_digest_as(UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.b2b_question_digest_as(UUID, UUID, TEXT, TEXT) TO service_role;
