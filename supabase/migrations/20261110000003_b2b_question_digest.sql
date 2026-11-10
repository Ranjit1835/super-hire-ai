-- No repeated questions from AI generation (owner, 2026-11-10). The generator reads what the bank already holds on a
-- topic, tells the model to write something different, and drops near-copies (supabase/functions/_shared/question-dedupe.ts).
-- b2b_question_digest_as: titles and statements the actor can already use for that org (its own + the global bank),
-- same type, not retired, matching the topic by tag, title or statement. Editors of the org (or super admins for the
-- global bank) only; at most 200 rows, newest first.
-- Rollback: DROP FUNCTION public.b2b_question_digest_as(UUID, UUID, TEXT, TEXT).

CREATE OR REPLACE FUNCTION public.b2b_question_digest_as(_actor UUID, _org_id UUID, _type TEXT, _topic TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_topic TEXT := lower(btrim(coalesce(_topic, '')));
BEGIN
  IF _org_id IS NULL AND NOT public.actor_is_super_admin(_actor) THEN RETURN '[]'::jsonb; END IF;
  IF _org_id IS NOT NULL AND NOT public.actor_is_org_editor(_actor, _org_id) THEN RETURN '[]'::jsonb; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object('title', q.title, 'statement', left(q.statement, 600)) ORDER BY q.created_at DESC)
    FROM (
      SELECT title, statement, created_at FROM public.questions q
      WHERE q.type = _type AND q.status <> 'retired'
        AND (q.org_id IS NULL OR q.org_id = _org_id)
        AND (v_topic = '' OR EXISTS (SELECT 1 FROM unnest(q.topics) t WHERE lower(t) = v_topic)
             OR q.title ILIKE '%' || v_topic || '%' OR q.statement ILIKE '%' || v_topic || '%')
      ORDER BY q.created_at DESC
      LIMIT 200
    ) q), '[]'::jsonb);
END $$;
REVOKE EXECUTE ON FUNCTION public.b2b_question_digest_as(UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.b2b_question_digest_as(UUID, UUID, TEXT, TEXT) TO service_role;
