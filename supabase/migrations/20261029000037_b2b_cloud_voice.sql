-- Phase 3 voice (cheaper option, decided 2026-10-30; docs/b2b/VOICE_STACK_RESEARCH.md): the room records one
-- answer at a time and the server transcribes it (Groq Whisper, or Sarvam), then voices the interviewer's line
-- (Google WaveNet en-IN, or Sarvam Bulbul V4 Flash). No always-on voice server; browser speech stays the fallback.
--
-- b2b_iv_voice_use: called by b2b-interview before (check) and after (log) each provider call. Only the
-- interview's own candidate, only while it is in progress, within per-interview caps, so the endpoints can't be
-- used as a free speech service. Each use is logged to b2b_usage_log (kind stt / tts) at the provider's rate, so it
-- shows in the super-admin cost breakdown (R6.1).

-- Cost prices (₹88/USD). Google's first 4M WaveNet characters a month are free; the log uses the list rate, so
-- it over- rather than under-states. Verify against invoices and edit in /admin/costs.
INSERT INTO public.b2b_pricing (provider_key, unit_inr, notes) VALUES
  ('stt:groq:whisper-large-v3-turbo', 0.0587, 'Groq Whisper large-v3-turbo: $0.04/hour = ₹0.0587/min (min 10 s billed per request).'),
  ('stt:sarvam', 0.49, 'Sarvam speech-to-text, pay as you go: ₹0.49/min.'),
  ('tts:google:wavenet', 352, 'Google Cloud TTS WaveNet: $4 per 1M characters = ₹352/M (first 4M chars/month free).'),
  ('tts:sarvam:bulbul-v4-flash', 1000, 'Sarvam Bulbul V4 Flash, pay as you go: ₹1 per 1K characters = ₹1000/M.');

/** Per-interview voice caps: generous for a real interview, useless as a free speech service. */
CREATE OR REPLACE FUNCTION public._b2b_voice_caps()
RETURNS JSONB LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('stt_calls', 200, 'stt_seconds', 5400, 'tts_calls', 250, 'tts_chars', 60000)
$$;

CREATE OR REPLACE FUNCTION public.b2b_iv_voice_use(
  _actor UUID, _interview_id UUID, _kind TEXT, _provider_key TEXT, _units NUMERIC, _check_only BOOLEAN
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  i public.b2b_interviews := public._b2b_iv_own(_actor, _interview_id);
  caps JSONB := public._b2b_voice_caps();
  v_calls INTEGER; v_units NUMERIC; p public.b2b_pricing; v_cost NUMERIC := 0;
BEGIN
  IF _kind NOT IN ('stt', 'tts') THEN RAISE EXCEPTION 'INVALID_KIND'; END IF;
  IF i.status::text <> 'in_progress' THEN RETURN jsonb_build_object('ok', false, 'reason', 'NOT_IN_PROGRESS'); END IF;
  SELECT count(*), COALESCE(sum(CASE WHEN _kind = 'stt' THEN stt_seconds ELSE tts_chars END), 0) INTO v_calls, v_units
    FROM public.b2b_usage_log WHERE interview_id = i.id AND kind = _kind;
  IF v_calls >= (caps->>(_kind || '_calls'))::integer
     OR v_units + GREATEST(COALESCE(_units, 0), 0) > (caps->>(_kind || CASE WHEN _kind = 'stt' THEN '_seconds' ELSE '_chars' END))::numeric THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'VOICE_LIMIT');
  END IF;
  IF _check_only THEN RETURN jsonb_build_object('ok', true); END IF;

  p := public.b2b_price_for(_provider_key);
  IF p.id IS NOT NULL THEN
    v_cost := CASE WHEN _kind = 'stt' THEN GREATEST(_units, 0) / 60 * p.unit_inr ELSE GREATEST(_units, 0) * p.unit_inr / 1e6 END;
  END IF;
  INSERT INTO public.b2b_usage_log (org_id, interview_id, kind, purpose, provider_key, stt_seconds, tts_chars, cost_inr, pricing_id,
                                    feature, user_id)
  VALUES (i.org_id, i.id, _kind, 'voice', left(_provider_key, 100),
          CASE WHEN _kind = 'stt' THEN round(GREATEST(_units, 0), 2) ELSE 0 END,
          CASE WHEN _kind = 'tts' THEN GREATEST(_units, 0)::integer ELSE 0 END, v_cost, p.id,
          CASE WHEN _kind = 'stt' THEN 'interview.voice.stt' ELSE 'interview.voice.tts' END, _actor);
  RETURN jsonb_build_object('ok', true, 'cost_inr', v_cost);
END;
$$;

REVOKE ALL ON FUNCTION public.b2b_iv_voice_use(UUID, UUID, TEXT, TEXT, NUMERIC, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.b2b_iv_voice_use(UUID, UUID, TEXT, TEXT, NUMERIC, BOOLEAN) TO service_role;
