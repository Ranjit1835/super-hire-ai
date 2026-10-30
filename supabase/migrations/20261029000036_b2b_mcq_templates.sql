-- R2.2 parameterised MCQ templates. A template makes many concrete MCQs ahead of time (b2b-assess
-- generateVariants, supabase/functions/_shared/mcq-template.ts); they share questions.family_id and record their
-- numbers in questions.params. No model runs at exam time.
--   1. source 'template' for generated variants; family index.
--   2. Papers take at most one variant per family, so a student never gets two versions of the same question.

ALTER TABLE public.questions DROP CONSTRAINT IF EXISTS questions_source_check;
ALTER TABLE public.questions ADD CONSTRAINT questions_source_check CHECK (source IN ('manual', 'ai', 'import', 'template'));
CREATE INDEX IF NOT EXISTS idx_questions_family ON public.questions (family_id) WHERE family_id IS NOT NULL;

-- Regenerated from 20261021000006: one variant per template family per paper.
CREATE OR REPLACE FUNCTION public._b2b_build_question_set(_assessment_id UUID, _seed TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a public.assessments;
  s JSONB;
  p JSONB;
  v_si INTEGER := 0;
  v_set JSONB := '[]'::jsonb;
  v_section JSONB;
  v_picked UUID[] := '{}';
  v_families UUID[] := '{}';   -- R2.2: one variant per template family per paper
  v_ids UUID[];
  v_qid UUID;
  v_type TEXT;
  v_topics TEXT[];
BEGIN
  SELECT * INTO a FROM public.assessments WHERE id = _assessment_id;
  FOR s IN SELECT value FROM jsonb_array_elements(a.sections) LOOP
    v_type := s->>'type';
    v_section := '[]'::jsonb;
    -- fixed questions
    IF jsonb_typeof(s->'question_ids') = 'array' THEN
      FOR v_qid IN
        SELECT q.id FROM jsonb_array_elements_text(s->'question_ids') WITH ORDINALITY AS x(id, ord)
        JOIN public.questions q ON q.id = x.id::uuid
        WHERE q.status = 'verified' AND q.type = v_type AND (q.org_id = a.org_id OR q.org_id IS NULL)
          AND NOT q.id = ANY (v_picked)
        ORDER BY x.ord
      LOOP
        v_picked := v_picked || v_qid;
        v_families := v_families || COALESCE((SELECT q.family_id FROM public.questions q WHERE q.id = v_qid), v_qid);
        v_section := v_section || jsonb_build_array(v_qid);
      END LOOP;
    END IF;
    -- pool rules
    IF jsonb_typeof(s->'pick') = 'array' THEN
      FOR p IN SELECT value FROM jsonb_array_elements(s->'pick') LOOP
        v_topics := COALESCE(ARRAY(SELECT lower(jsonb_array_elements_text(p->'topics'))), '{}');
        -- At most one variant per template family (a question without a family is its own family).
        SELECT COALESCE(array_agg(id ORDER BY k), '{}') INTO v_ids FROM (
          SELECT id, k FROM (
            SELECT DISTINCT ON (COALESCE(q.family_id, q.id)) q.id,
                   CASE WHEN a.randomize THEN md5(_seed || q.id::text) ELSE q.created_at::text || q.id::text END AS k
            FROM public.questions q
            WHERE q.status = 'verified' AND q.type = v_type AND (q.org_id = a.org_id OR q.org_id IS NULL)
              AND (p->>'difficulty' IS NULL OR q.difficulty = p->>'difficulty')
              AND (cardinality(v_topics) = 0
                   OR EXISTS (SELECT 1 FROM unnest(q.topics) t WHERE lower(t) = ANY (v_topics)))
              AND (v_type <> 'coding' OR q.languages && a.languages)
              AND NOT q.id = ANY (v_picked)
              AND NOT COALESCE(q.family_id, q.id) = ANY (v_families)
            ORDER BY COALESCE(q.family_id, q.id),
                     CASE WHEN a.randomize THEN md5(_seed || q.id::text) ELSE q.created_at::text || q.id::text END
          ) fam
          ORDER BY k
          LIMIT GREATEST(COALESCE((p->>'count')::integer, 1), 0)
        ) x;
        v_picked := v_picked || v_ids;
        v_families := v_families || ARRAY(SELECT COALESCE(q.family_id, q.id) FROM public.questions q WHERE q.id = ANY (v_ids));
        v_section := v_section || to_jsonb(v_ids);
      END LOOP;
    END IF;
    -- order within the section, then option shuffle
    v_set := v_set || COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'question_id', q.id, 'section', v_si, 'type', q.type,
               'option_order', CASE WHEN q.type = 'mcq' THEN (
                  SELECT jsonb_agg(o->>'id' ORDER BY CASE WHEN a.shuffle_options THEN md5(_seed || q.id::text || (o->>'id')) END NULLS LAST, oo.ord)
                  FROM jsonb_array_elements(q.options) WITH ORDINALITY AS oo(o, ord)) END)
             ORDER BY CASE WHEN a.randomize THEN md5(_seed || 'order' || q.id::text) END NULLS LAST, x.ord)
      FROM jsonb_array_elements_text(v_section) WITH ORDINALITY AS x(id, ord)
      JOIN public.questions q ON q.id = x.id::uuid), '[]'::jsonb);
    v_si := v_si + 1;
  END LOOP;
  RETURN v_set;
END;
$$;
