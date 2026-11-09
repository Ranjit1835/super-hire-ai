-- B2B V1 — AI gateway storage: exact-match cache with single-flight dedupe, usage/cost log, quotas.
-- Everything here is service-role only (edge functions); nothing is readable from the browser except
-- usage reports for super admins and an org's own counters for its staff.

-- =============================================
-- Cache + single flight
-- =============================================
-- key = sha256(feature, prompt_version, provider, model, scope, normalized input). Personal data is cached per
-- org (scope = org id); non-personal content uses the global scope (org_id NULL).
CREATE TABLE public.ai_cache (
  key TEXT PRIMARY KEY CHECK (key ~ '^[0-9a-f]{64}$'),
  feature TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  model TEXT NOT NULL,
  org_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'ready')),
  response JSONB,
  owner_token UUID,              -- the claim that is computing a pending row
  hits INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  CHECK (status = 'pending' OR response IS NOT NULL)
);
CREATE INDEX idx_ai_cache_expiry ON public.ai_cache(expires_at) WHERE expires_at IS NOT NULL;
ALTER TABLE public.ai_cache ENABLE ROW LEVEL SECURITY;  -- no policies: service role only

-- Claim a key. Returns one of:
--   { state: 'hit', response }              ready and not expired
--   { state: 'claimed', token }             caller computes, then calls b2b_ai_cache_fill / _release
--   { state: 'wait' }                       someone else is computing (claimed < _stale_after ago): poll again
CREATE OR REPLACE FUNCTION public.b2b_ai_cache_claim(
  _key TEXT, _feature TEXT, _prompt_version TEXT, _model TEXT, _org_id UUID, _stale_after_s INTEGER DEFAULT 90
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  c public.ai_cache;
  v_token UUID := gen_random_uuid();
BEGIN
  INSERT INTO public.ai_cache (key, feature, prompt_version, model, org_id, status, owner_token)
    VALUES (_key, _feature, _prompt_version, _model, _org_id, 'pending', v_token)
  ON CONFLICT (key) DO NOTHING;
  IF FOUND THEN RETURN jsonb_build_object('state', 'claimed', 'token', v_token); END IF;

  SELECT * INTO c FROM public.ai_cache WHERE key = _key FOR UPDATE;
  IF c.status = 'ready' AND (c.expires_at IS NULL OR c.expires_at > now()) THEN
    UPDATE public.ai_cache SET hits = hits + 1 WHERE key = _key;
    RETURN jsonb_build_object('state', 'hit', 'response', c.response);
  END IF;
  -- Expired, or a pending claim whose worker died: take it over.
  IF c.status = 'ready' OR c.updated_at < now() - make_interval(secs => _stale_after_s) THEN
    UPDATE public.ai_cache SET status = 'pending', response = NULL, owner_token = v_token, updated_at = now(),
        expires_at = NULL   -- an in-flight claim must not look expired to the prune job
      WHERE key = _key;
    RETURN jsonb_build_object('state', 'claimed', 'token', v_token);
  END IF;
  RETURN jsonb_build_object('state', 'wait');
END;
$$;

CREATE OR REPLACE FUNCTION public.b2b_ai_cache_fill(_key TEXT, _token UUID, _response JSONB, _ttl_s INTEGER)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE public.ai_cache
    SET status = 'ready', response = _response, owner_token = NULL, updated_at = now(),
        expires_at = CASE WHEN _ttl_s IS NULL THEN NULL ELSE now() + make_interval(secs => _ttl_s) END
    WHERE key = _key AND owner_token = _token;
  RETURN FOUND;
END;
$$;

-- The computation failed: drop the claim so a waiter (or a retry) can claim it.
CREATE OR REPLACE FUNCTION public.b2b_ai_cache_release(_key TEXT, _token UUID)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  DELETE FROM public.ai_cache WHERE key = _key AND owner_token = _token AND status = 'pending'
$$;

-- Bumping a prompt version makes old keys unreachable; this removes them (and expired rows).
CREATE OR REPLACE FUNCTION public.b2b_ai_cache_prune(_feature TEXT DEFAULT NULL, _keep_version TEXT DEFAULT NULL)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE n INTEGER;
BEGIN
  DELETE FROM public.ai_cache
    WHERE (expires_at IS NOT NULL AND expires_at < now())
       OR (_feature IS NOT NULL AND feature = _feature AND prompt_version IS DISTINCT FROM _keep_version);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

-- =============================================
-- Usage / cost log (extends the pilot's b2b_usage_log)
-- =============================================
ALTER TABLE public.b2b_usage_log
  ALTER COLUMN org_id DROP NOT NULL,                 -- global features (e.g. question bank generation)
  ADD COLUMN feature TEXT,
  ADD COLUMN user_id UUID,
  ADD COLUMN cache_hit BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN cached_input_tokens INTEGER NOT NULL DEFAULT 0 CHECK (cached_input_tokens >= 0);
CREATE INDEX idx_b2b_usage_feature_time ON public.b2b_usage_log(feature, created_at);

-- Context-cached input is billed at a discount; NULL = 10% of the input rate (Gemini's published ratio).
ALTER TABLE public.b2b_pricing ADD COLUMN cached_input_inr_per_million NUMERIC(12, 4);

CREATE OR REPLACE FUNCTION public.b2b_log_ai_usage(
  _org_id UUID, _user_id UUID, _feature TEXT, _model TEXT, _input INTEGER, _cached_input INTEGER,
  _output INTEGER, _latency INTEGER, _cache_hit BOOLEAN, _interview_id UUID DEFAULT NULL, _purpose TEXT DEFAULT NULL
) RETURNS NUMERIC LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  p public.b2b_pricing;
  v_cached INTEGER := LEAST(COALESCE(_cached_input, 0), COALESCE(_input, 0));
  v_cost NUMERIC := 0;
BEGIN
  IF NOT COALESCE(_cache_hit, false) THEN
    p := public.b2b_price_for(_model);
    IF p.id IS NOT NULL THEN
      v_cost := (COALESCE(_input, 0) - v_cached) * p.input_inr_per_million / 1e6
              + v_cached * COALESCE(p.cached_input_inr_per_million, p.input_inr_per_million / 10) / 1e6
              + COALESCE(_output, 0) * p.output_inr_per_million / 1e6;
    END IF;
  END IF;
  INSERT INTO public.b2b_usage_log
    (org_id, interview_id, kind, purpose, provider_key, input_tokens, output_tokens, latency_ms, cost_inr, pricing_id,
     feature, user_id, cache_hit, cached_input_tokens)
  VALUES
    (_org_id, _interview_id, 'llm', _purpose, _model,
     CASE WHEN _cache_hit THEN 0 ELSE COALESCE(_input, 0) END, CASE WHEN _cache_hit THEN 0 ELSE COALESCE(_output, 0) END,
     _latency, v_cost, p.id, _feature, _user_id, COALESCE(_cache_hit, false), CASE WHEN _cache_hit THEN 0 ELSE v_cached END);
  RETURN v_cost;
END;
$$;

-- =============================================
-- Quotas: per org, per feature, per calendar month (IST). Limits live in organizations.settings.quotas
-- as { "<feature>": <monthly limit> }; no entry = unlimited (credits still apply where they exist).
-- =============================================
CREATE TABLE public.usage_counters (
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  feature TEXT NOT NULL,
  period_start DATE NOT NULL,
  used INTEGER NOT NULL DEFAULT 0 CHECK (used >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, feature, period_start)
);
ALTER TABLE public.usage_counters ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read usage counters" ON public.usage_counters FOR SELECT TO authenticated
  USING (public.is_super_admin() OR public.is_org_admin(org_id));

CREATE OR REPLACE FUNCTION public.b2b_ist_month_start(_at TIMESTAMPTZ DEFAULT now())
RETURNS DATE LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT date_trunc('month', _at AT TIME ZONE 'Asia/Kolkata')::date
$$;

-- Atomically count one use if the org is under its limit. Returns { ok, used, limit }.
CREATE OR REPLACE FUNCTION public.b2b_take_quota(_org_id UUID, _feature TEXT, _units INTEGER DEFAULT 1)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_limit INTEGER;
  v_used INTEGER;
  v_period DATE := public.b2b_ist_month_start();
BEGIN
  SELECT NULLIF(settings->'quotas'->>_feature, '')::integer INTO v_limit FROM public.organizations WHERE id = _org_id;
  INSERT INTO public.usage_counters AS c (org_id, feature, period_start, used)
    VALUES (_org_id, _feature, v_period, _units)
  ON CONFLICT (org_id, feature, period_start) DO UPDATE
    SET used = c.used + _units, updated_at = now()
    WHERE v_limit IS NULL OR c.used + _units <= v_limit
  RETURNING c.used INTO v_used;
  IF v_used IS NULL OR (v_limit IS NOT NULL AND v_used > v_limit) THEN
    -- First insert can exceed a limit smaller than _units: undo it.
    IF v_used IS NOT NULL THEN
      UPDATE public.usage_counters SET used = used - _units WHERE org_id = _org_id AND feature = _feature AND period_start = v_period;
    END IF;
    RETURN jsonb_build_object('ok', false, 'reason', 'QUOTA_EXCEEDED', 'limit', v_limit,
      'used', (SELECT used FROM public.usage_counters WHERE org_id = _org_id AND feature = _feature AND period_start = v_period));
  END IF;
  RETURN jsonb_build_object('ok', true, 'used', v_used, 'limit', v_limit);
END;
$$;

-- =============================================
-- Super-admin usage report (per org, current IST month and all time)
-- =============================================
CREATE OR REPLACE FUNCTION public.super_org_usage(_org_id UUID DEFAULT NULL)
RETURNS TABLE (
  org_id UUID, org_name TEXT, org_type TEXT, status TEXT, plan_id TEXT, credits_balance NUMERIC,
  credits_used_month NUMERIC, students INTEGER, students_active INTEGER, candidates INTEGER, members INTEGER,
  ai_calls_month INTEGER, ai_cost_inr_month NUMERIC, ai_cost_inr_total NUMERIC, cache_hits_month INTEGER,
  cache_hit_rate_month NUMERIC
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_from TIMESTAMPTZ := (public.b2b_ist_month_start()::timestamp AT TIME ZONE 'Asia/Kolkata');
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
  SELECT o.id, o.name, o.type, o.status, o.plan_id, o.credits_balance,
    COALESCE((SELECT -sum(l.delta) FROM public.org_credit_ledger l
              WHERE l.org_id = o.id AND l.reason IN ('consume', 'refund') AND l.created_at >= v_from), 0),
    (SELECT count(*)::int FROM public.students s WHERE s.org_id = o.id),
    (SELECT count(*)::int FROM public.students s WHERE s.org_id = o.id AND s.status = 'active'),
    (SELECT count(*)::int FROM public.candidates c WHERE c.org_id = o.id),
    (SELECT count(*)::int FROM public.org_memberships m WHERE m.org_id = o.id AND m.role <> 'student'),
    (SELECT count(*)::int FROM public.b2b_usage_log u WHERE u.org_id = o.id AND u.kind = 'llm' AND u.created_at >= v_from),
    COALESCE((SELECT sum(u.cost_inr) FROM public.b2b_usage_log u WHERE u.org_id = o.id AND u.created_at >= v_from), 0),
    COALESCE((SELECT sum(u.cost_inr) FROM public.b2b_usage_log u WHERE u.org_id = o.id), 0),
    (SELECT count(*)::int FROM public.b2b_usage_log u WHERE u.org_id = o.id AND u.cache_hit AND u.created_at >= v_from),
    (SELECT CASE WHEN count(*) = 0 THEN NULL ELSE round(count(*) FILTER (WHERE u.cache_hit)::numeric / count(*), 3) END
       FROM public.b2b_usage_log u WHERE u.org_id = o.id AND u.kind = 'llm' AND u.created_at >= v_from)
  FROM public.organizations o
  WHERE (_org_id IS NULL OR o.id = _org_id) AND NOT o.is_demo
  ORDER BY o.created_at DESC;
END;
$$;

REVOKE EXECUTE ON FUNCTION
  public.b2b_ai_cache_claim(TEXT, TEXT, TEXT, TEXT, UUID, INTEGER), public.b2b_ai_cache_fill(TEXT, UUID, JSONB, INTEGER),
  public.b2b_ai_cache_release(TEXT, UUID), public.b2b_ai_cache_prune(TEXT, TEXT),
  public.b2b_log_ai_usage(UUID, UUID, TEXT, TEXT, INTEGER, INTEGER, INTEGER, INTEGER, BOOLEAN, UUID, TEXT),
  public.b2b_take_quota(UUID, TEXT, INTEGER)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.b2b_ai_cache_claim(TEXT, TEXT, TEXT, TEXT, UUID, INTEGER), public.b2b_ai_cache_fill(TEXT, UUID, JSONB, INTEGER),
  public.b2b_ai_cache_release(TEXT, UUID), public.b2b_ai_cache_prune(TEXT, TEXT),
  public.b2b_log_ai_usage(UUID, UUID, TEXT, TEXT, INTEGER, INTEGER, INTEGER, INTEGER, BOOLEAN, UUID, TEXT),
  public.b2b_take_quota(UUID, TEXT, INTEGER)
TO service_role;
REVOKE EXECUTE ON FUNCTION public.super_org_usage(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.super_org_usage(UUID) TO authenticated;
