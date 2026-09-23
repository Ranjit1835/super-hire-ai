-- B2B cost tracking (Step 9).
-- Every billable unit is logged in the SAME transaction that stores the turn or evaluation
-- (no extra network calls in the interview hot path, no lost or double-counted events):
--   llm   — per model call: input/output tokens (from turn/evaluation meta)
--   stt   — seconds of recognised speech per spoken answer
--   tts   — characters spoken by the interviewer
-- Cost in INR is computed at insert from b2b_pricing and stored with the raw units, so it can
-- be recomputed if rates change. Visible to super-admin only.

CREATE TABLE public.b2b_pricing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- LLM: model name or LIKE pattern ("gemini-%", "%"); speech: "stt:browser", "tts:browser", …
  provider_key TEXT NOT NULL,
  input_inr_per_million NUMERIC(12, 4) NOT NULL DEFAULT 0,   -- LLM input tokens
  output_inr_per_million NUMERIC(12, 4) NOT NULL DEFAULT 0,  -- LLM output (incl. thinking) tokens
  unit_inr NUMERIC(12, 4) NOT NULL DEFAULT 0,                -- STT: per minute · TTS: per million characters
  effective_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Placeholder rates. Converted from Gemini 2.5 Flash's published USD pricing ($0.30 in / $2.50 out per 1M tokens)
-- at ₹84/USD — VERIFY against your actual Gemini bill for the model you use and edit in /admin/costs.
INSERT INTO public.b2b_pricing (provider_key, input_inr_per_million, output_inr_per_million, notes) VALUES
  ('%', 25.2, 210, 'Default for any model. Placeholder — verify against your Gemini invoice.');
INSERT INTO public.b2b_pricing (provider_key, unit_inr, notes) VALUES
  ('stt:browser', 0, 'Chrome Web Speech API — no charge to HiResume.'),
  ('tts:browser', 0, 'Browser speechSynthesis — no charge to HiResume.');

CREATE TABLE public.b2b_usage_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  interview_id UUID,
  kind TEXT NOT NULL CHECK (kind IN ('llm', 'stt', 'tts')),
  purpose TEXT,                 -- llm: opening | turn | evaluation
  provider_key TEXT NOT NULL,   -- model name, or stt:browser / tts:browser
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  stt_seconds NUMERIC(10, 2) NOT NULL DEFAULT 0,
  tts_chars INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER,
  cost_inr NUMERIC(12, 6) NOT NULL DEFAULT 0,
  pricing_id UUID REFERENCES public.b2b_pricing(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_b2b_usage_org_time ON public.b2b_usage_log(org_id, created_at);
CREATE INDEX idx_b2b_usage_interview ON public.b2b_usage_log(interview_id);

ALTER TABLE public.b2b_pricing ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.b2b_usage_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Super-admin reads pricing" ON public.b2b_pricing FOR SELECT TO authenticated USING (public.is_super_admin());
CREATE POLICY "Super-admin writes pricing" ON public.b2b_pricing FOR ALL TO authenticated
  USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());
CREATE POLICY "Super-admin reads usage" ON public.b2b_usage_log FOR SELECT TO authenticated USING (public.is_super_admin());

-- Most specific matching price row in effect: exact key beats pattern; longer pattern beats "%".
CREATE OR REPLACE FUNCTION public.b2b_price_for(_key TEXT)
RETURNS public.b2b_pricing LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT p.* FROM public.b2b_pricing p
  WHERE p.effective_from <= now() AND (p.provider_key = _key OR _key LIKE p.provider_key)
  ORDER BY (p.provider_key = _key) DESC, length(p.provider_key) DESC, p.effective_from DESC
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.b2b_log_usage(
  _org_id UUID, _interview_id UUID, _kind TEXT, _purpose TEXT, _provider TEXT,
  _input INTEGER, _output INTEGER, _stt_seconds NUMERIC, _tts_chars INTEGER, _latency INTEGER
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  p public.b2b_pricing;
  v_cost NUMERIC := 0;
BEGIN
  p := public.b2b_price_for(_provider);
  IF p.id IS NOT NULL THEN
    v_cost := CASE _kind
      WHEN 'llm' THEN coalesce(_input, 0) * p.input_inr_per_million / 1e6 + coalesce(_output, 0) * p.output_inr_per_million / 1e6
      WHEN 'stt' THEN coalesce(_stt_seconds, 0) / 60 * p.unit_inr
      WHEN 'tts' THEN coalesce(_tts_chars, 0) * p.unit_inr / 1e6
      ELSE 0 END;
  END IF;
  INSERT INTO public.b2b_usage_log
    (org_id, interview_id, kind, purpose, provider_key, input_tokens, output_tokens, stt_seconds, tts_chars, latency_ms, cost_inr, pricing_id)
  VALUES
    (_org_id, _interview_id, _kind, _purpose, _provider, coalesce(_input, 0), coalesce(_output, 0), coalesce(_stt_seconds, 0),
     coalesce(_tts_chars, 0), _latency, v_cost, p.id);
END;
$$;

-- Log every element of an llm-usage JSON array: [{ model, input_tokens, output_tokens, latency_ms, purpose? }]
CREATE OR REPLACE FUNCTION public.b2b_log_llm_array(_org_id UUID, _interview_id UUID, _purpose TEXT, _usage JSONB)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  u JSONB;
BEGIN
  IF jsonb_typeof(_usage) <> 'array' THEN RETURN; END IF;
  FOR u IN SELECT * FROM jsonb_array_elements(_usage) LOOP
    PERFORM public.b2b_log_usage(
      _org_id, _interview_id, 'llm', coalesce(u->>'purpose', _purpose), coalesce(u->>'model', 'unknown'),
      (u->>'input_tokens')::int, (u->>'output_tokens')::int, 0, 0, (u->>'latency_ms')::int);
  END LOOP;
END;
$$;

-- =============================================
-- Hook logging into the existing write paths (same signatures)
-- =============================================
CREATE OR REPLACE FUNCTION public.b2b_record_opening(
  _interview_id UUID, _question TEXT, _meta JSONB, _state JSONB
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  iv public.b2b_interviews;
  v_rows INTEGER;
BEGIN
  SELECT * INTO iv FROM public.b2b_interviews WHERE id = _interview_id FOR UPDATE;
  IF NOT FOUND OR iv.status <> 'in_progress' THEN RAISE EXCEPTION 'NOT_IN_PROGRESS'; END IF;
  INSERT INTO public.b2b_interview_turns (interview_id, org_id, turn_index, role, content, topic, difficulty, meta)
    VALUES (iv.id, iv.org_id, 1, 'interviewer', _question, _state->>'current_topic', _state->>'difficulty', coalesce(_meta, '{}'::jsonb))
    ON CONFLICT (interview_id, turn_index, role) DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows > 0 THEN -- only log once, even if the opening is retried
    PERFORM public.b2b_log_llm_array(iv.org_id, iv.id, 'opening', _meta->'llm');
    PERFORM public.b2b_log_usage(iv.org_id, iv.id, 'tts', 'question', 'tts:browser', 0, 0, 0, length(_question), NULL);
  END IF;
  UPDATE public.b2b_interviews SET state = _state, last_activity_at = now() WHERE id = iv.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.b2b_record_turn(
  _interview_id UUID, _user_id UUID, _expected_turn_count INTEGER, _client_turn_id UUID,
  _answer TEXT, _answer_meta JSONB, _answer_topic TEXT, _answer_difficulty TEXT,
  _next_question TEXT, _next_meta JSONB, _state JSONB, _end_reason TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  iv public.b2b_interviews;
  v_turn INTEGER;
BEGIN
  SELECT * INTO iv FROM public.b2b_interviews WHERE id = _interview_id FOR UPDATE;
  IF NOT FOUND OR iv.user_id <> _user_id THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NOT_FOUND');
  END IF;
  IF EXISTS (SELECT 1 FROM public.b2b_interview_turns WHERE interview_id = iv.id AND client_turn_id = _client_turn_id) THEN
    RETURN jsonb_build_object('ok', true, 'duplicate', true);
  END IF;
  IF iv.status <> 'in_progress' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NOT_IN_PROGRESS', 'status', iv.status);
  END IF;
  IF (iv.state->>'turn_count')::int <> _expected_turn_count THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'TURN_CONFLICT', 'turn_count', (iv.state->>'turn_count')::int);
  END IF;

  v_turn := _expected_turn_count + 1;
  INSERT INTO public.b2b_interview_turns
    (interview_id, org_id, turn_index, role, content, topic, difficulty, meta, client_turn_id)
  VALUES (iv.id, iv.org_id, v_turn, 'student', _answer, _answer_topic, _answer_difficulty, coalesce(_answer_meta, '{}'::jsonb), _client_turn_id);

  IF _next_question IS NOT NULL THEN
    INSERT INTO public.b2b_interview_turns (interview_id, org_id, turn_index, role, content, topic, difficulty, meta)
    VALUES (iv.id, iv.org_id, v_turn + 1, 'interviewer', _next_question, _state->>'current_topic', _state->>'difficulty',
            coalesce(_next_meta, '{}'::jsonb));
  END IF;

  -- Usage: speech recognised for this answer, model calls for the next question, characters spoken next.
  IF coalesce(_answer_meta->>'input_mode', 'voice') = 'voice' AND (_answer_meta->>'speech_ms') IS NOT NULL THEN
    PERFORM public.b2b_log_usage(iv.org_id, iv.id, 'stt', 'answer', 'stt:browser', 0, 0,
      round(((_answer_meta->>'speech_ms')::numeric) / 1000, 2), 0, NULL);
  END IF;
  PERFORM public.b2b_log_llm_array(iv.org_id, iv.id, 'turn', _next_meta->'llm');
  IF _next_question IS NOT NULL THEN
    PERFORM public.b2b_log_usage(iv.org_id, iv.id, 'tts', 'question', 'tts:browser', 0, 0, 0, length(_next_question), NULL);
  END IF;

  UPDATE public.b2b_interviews SET
    state = _state,
    last_activity_at = now(),
    status = CASE WHEN _end_reason IS NULL THEN 'in_progress' ELSE 'completed' END::public.b2b_interview_status,
    end_reason = _end_reason,
    completed_at = CASE WHEN _end_reason IS NULL THEN NULL ELSE now() END
  WHERE id = iv.id;

  RETURN jsonb_build_object('ok', true, 'duplicate', false);
END;
$$;

CREATE OR REPLACE FUNCTION public.b2b_save_evaluation(
  _evaluation_id UUID, _status TEXT, _model TEXT, _result JSONB, _audio_metrics JSONB,
  _overall NUMERIC, _readiness TEXT, _primary_gap TEXT, _attempts INTEGER, _llm_usage JSONB, _error TEXT
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  ev public.b2b_evaluations;
BEGIN
  UPDATE public.b2b_evaluations SET
    status = _status, model = _model, result = _result, audio_metrics = _audio_metrics,
    overall_score = _overall, readiness_level = _readiness, primary_gap = _primary_gap,
    attempts = attempts + coalesce(_attempts, 0), llm_usage = llm_usage || coalesce(_llm_usage, '[]'::jsonb),
    error = _error, updated_at = now(),
    completed_at = CASE WHEN _status = 'completed' THEN now() ELSE completed_at END
  WHERE id = _evaluation_id
  RETURNING * INTO ev;
  IF FOUND THEN
    PERFORM public.b2b_log_llm_array(ev.org_id, ev.interview_id, 'evaluation', _llm_usage); -- failed attempts cost money too
  END IF;
END;
$$;

-- =============================================
-- Super-admin reports
-- =============================================
CREATE OR REPLACE FUNCTION public.super_cost_by_org_month(_include_demo BOOLEAN DEFAULT false)
RETURNS TABLE (
  month DATE, org_id UUID, org_name TEXT, is_demo BOOLEAN,
  interviews BIGINT, llm_calls BIGINT, input_tokens BIGINT, output_tokens BIGINT,
  stt_minutes NUMERIC, tts_chars BIGINT, cost_inr NUMERIC, cost_per_interview NUMERIC
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'insufficient_privilege'; END IF;
  RETURN QUERY
  SELECT
    date_trunc('month', u.created_at AT TIME ZONE 'Asia/Kolkata')::date,
    o.id, o.name, o.is_demo,
    count(DISTINCT u.interview_id) FILTER (WHERE u.interview_id IS NOT NULL),
    count(*) FILTER (WHERE u.kind = 'llm'),
    coalesce(sum(u.input_tokens), 0)::bigint, coalesce(sum(u.output_tokens), 0)::bigint,
    round(coalesce(sum(u.stt_seconds), 0) / 60, 1), coalesce(sum(u.tts_chars), 0)::bigint,
    round(coalesce(sum(u.cost_inr), 0), 2),
    round(coalesce(sum(u.cost_inr), 0) / nullif(count(DISTINCT u.interview_id), 0), 2)
  FROM public.b2b_usage_log u
  JOIN public.organizations o ON o.id = u.org_id
  WHERE _include_demo OR NOT o.is_demo
  GROUP BY 1, o.id, o.name, o.is_demo
  ORDER BY 1 DESC, 11 DESC;
END;
$$;

-- Per org: plan revenue estimate (students × price per student) vs cost to date.
CREATE OR REPLACE FUNCTION public.super_cost_vs_revenue(_include_demo BOOLEAN DEFAULT false)
RETURNS TABLE (
  org_id UUID, org_name TEXT, is_demo BOOLEAN, plan_id TEXT, price_inr_per_student NUMERIC, students BIGINT,
  revenue_inr NUMERIC, interviews BIGINT, cost_inr NUMERIC, cost_per_interview NUMERIC, cost_per_student NUMERIC,
  margin_inr NUMERIC, cost_share NUMERIC
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'insufficient_privilege'; END IF;
  RETURN QUERY
  WITH s AS (
    SELECT m.org_id, count(*) AS n FROM public.org_memberships m WHERE m.role = 'student' GROUP BY m.org_id
  ), c AS (
    SELECT u.org_id, sum(u.cost_inr) AS cost, count(DISTINCT u.interview_id) AS ivs FROM public.b2b_usage_log u GROUP BY u.org_id
  )
  SELECT o.id, o.name, o.is_demo, p.id, p.price_inr_per_student, coalesce(s.n, 0),
    round(coalesce(s.n, 0) * p.price_inr_per_student, 2),
    coalesce(c.ivs, 0), round(coalesce(c.cost, 0), 2),
    round(coalesce(c.cost, 0) / nullif(c.ivs, 0), 2),
    round(coalesce(c.cost, 0) / nullif(s.n, 0), 2),
    round(coalesce(s.n, 0) * p.price_inr_per_student - coalesce(c.cost, 0), 2),
    round(coalesce(c.cost, 0) / nullif(coalesce(s.n, 0) * p.price_inr_per_student, 0), 4)
  FROM public.organizations o
  JOIN public.plans p ON p.id = o.plan_id
  LEFT JOIN s ON s.org_id = o.id
  LEFT JOIN c ON c.org_id = o.id
  WHERE _include_demo OR NOT o.is_demo
  ORDER BY 9 DESC;
END;
$$;

-- Re-price every logged event with the rates currently in effect (e.g. after replacing the
-- placeholder rates with your real Gemini rates). Returns the number of rows changed.
CREATE OR REPLACE FUNCTION public.super_recompute_costs()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v INTEGER;
BEGIN
  IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'insufficient_privilege'; END IF;
  WITH priced AS (
    SELECT u.id, p.id AS pid,
      CASE u.kind
        WHEN 'llm' THEN u.input_tokens * p.input_inr_per_million / 1e6 + u.output_tokens * p.output_inr_per_million / 1e6
        WHEN 'stt' THEN u.stt_seconds / 60 * p.unit_inr
        WHEN 'tts' THEN u.tts_chars * p.unit_inr / 1e6
        ELSE 0 END AS cost
    FROM public.b2b_usage_log u
    CROSS JOIN LATERAL public.b2b_price_for(u.provider_key) p
  )
  UPDATE public.b2b_usage_log l SET cost_inr = priced.cost, pricing_id = priced.pid
  FROM priced
  WHERE l.id = priced.id AND (l.cost_inr IS DISTINCT FROM priced.cost OR l.pricing_id IS DISTINCT FROM priced.pid);
  GET DIAGNOSTICS v = ROW_COUNT;
  RETURN v;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.super_recompute_costs() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.super_recompute_costs() TO authenticated;

REVOKE EXECUTE ON FUNCTION
  public.b2b_price_for(TEXT),
  public.b2b_log_usage(UUID, UUID, TEXT, TEXT, TEXT, INTEGER, INTEGER, NUMERIC, INTEGER, INTEGER),
  public.b2b_log_llm_array(UUID, UUID, TEXT, JSONB)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.b2b_price_for(TEXT),
  public.b2b_log_usage(UUID, UUID, TEXT, TEXT, TEXT, INTEGER, INTEGER, NUMERIC, INTEGER, INTEGER),
  public.b2b_log_llm_array(UUID, UUID, TEXT, JSONB)
TO service_role;
REVOKE EXECUTE ON FUNCTION public.super_cost_by_org_month(BOOLEAN), public.super_cost_vs_revenue(BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.super_cost_by_org_month(BOOLEAN), public.super_cost_vs_revenue(BOOLEAN) TO authenticated;
